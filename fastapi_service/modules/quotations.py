"""
Quotations & Proposals Module (Section 10.4).
Supports creating, editing drafts, issuing, accepting, rejecting, expiring,
converting accepted quotations to invoices (preserving the original quotation),
and generating A4 Quotation PDFs.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from fastapi_service.core.exceptions import ConflictError, NotFoundError
from fastapi_service.core.pagination import (
    ApiResponse,
    MoneyDecimal,
    PaginatedResponse,
    PaginationParams,
    QuantityDecimal,
    TaxRateDecimal,
    paginate_select,
)
from fastapi_service.core.pdf_generator import render_commercial_document_pdf
from fastapi_service.core.permissions import AuthenticatedUser, require_permission
from fastapi_service.core.security import idempotency_registry, record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.crm import Client
from fastapi_service.models.invoicing import Invoice, InvoiceItem
from fastapi_service.models.quotations import Quote, QuoteItem
from fastapi_service.services.financial_service import (
    allocate_document_number,
    build_client_snapshot,
    build_company_snapshot,
    compute_authoritative_document_totals,
    ensure_company_settings,
)

router = APIRouter(prefix="/quotations", tags=["Quotations"])


class QuoteLineItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(..., min_length=1, max_length=500)
    quantity: QuantityDecimal
    unit_price: MoneyDecimal
    discount_amount: MoneyDecimal = Decimal("0.00")
    tax_config_id: uuid.UUID | None = None
    tax_rate: TaxRateDecimal = Decimal("0.0000")


class QuoteCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: uuid.UUID
    issue_date: date | None = None
    expiry_date: date | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    terms: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=2000)
    items: list[QuoteLineItemInput] = Field(..., min_length=1, max_length=200)


class QuoteUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_date: date | None = None
    expiry_date: date | None = None
    terms: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)
    items: list[QuoteLineItemInput] | None = Field(default=None, min_length=1, max_length=200)


class QuoteConversionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    due_date: date | None = None
    issue_immediately: bool = False
    notes: str | None = Field(default=None, max_length=2000)


class QuoteItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    quote_id: uuid.UUID
    position: int
    description: str
    quantity: QuantityDecimal
    unit_price: MoneyDecimal
    discount_amount: MoneyDecimal
    tax_config_id: uuid.UUID | None
    tax_rate: TaxRateDecimal
    tax_amount: MoneyDecimal
    line_subtotal: MoneyDecimal
    line_total: MoneyDecimal


class QuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    quote_number: str | None
    client_id: uuid.UUID
    status: str
    issue_date: date
    expiry_date: date | None
    currency: str
    subtotal: MoneyDecimal
    discount_total: MoneyDecimal
    tax_total: MoneyDecimal
    total: MoneyDecimal
    terms: str
    notes: str
    company_snapshot: dict[str, Any] | None
    client_snapshot: dict[str, Any] | None
    created_by: uuid.UUID
    finalized_by: uuid.UUID | None
    finalized_at: datetime | None
    converted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    items: list[QuoteItemOut] = []


def _load_quote_or_404(db: Session, quotation_id: uuid.UUID, for_update: bool = False) -> Quote:
    stmt = select(Quote).options(selectinload(Quote.items)).where(Quote.id == quotation_id)
    if for_update:
        stmt = stmt.with_for_update()
    quote = db.execute(stmt).scalar_one_or_none()
    if not quote:
        raise NotFoundError("Quotation", details={"quotation_id": str(quotation_id)})
    return quote


@router.get("", response_model=PaginatedResponse[QuoteOut])
def list_quotations(
    pagination: PaginationParams = Depends(),
    search: str | None = None,
    status_filter: str | None = None,
    client_id: uuid.UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    _user: AuthenticatedUser = Depends(require_permission("quotations:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[QuoteOut]:
    stmt = select(Quote).options(selectinload(Quote.items))
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(or_(Quote.quote_number.ilike(q), Quote.notes.ilike(q)))
    if status_filter:
        stmt = stmt.where(Quote.status == status_filter)
    if client_id:
        stmt = stmt.where(Quote.client_id == client_id)
    if from_date:
        stmt = stmt.where(Quote.issue_date >= from_date)
    if to_date:
        stmt = stmt.where(Quote.issue_date <= to_date)

    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={
            "created_at": Quote.created_at,
            "issue_date": Quote.issue_date,
            "total": Quote.total,
            "status": Quote.status,
        },
    )
    return PaginatedResponse(
        data=[QuoteOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Quotations retrieved successfully",
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[QuoteOut])
def create_quotation(
    payload: QuoteCreateRequest,
    user: AuthenticatedUser = Depends(require_permission("quotations:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[QuoteOut]:
    client = db.get(Client, payload.client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(payload.client_id)})

    settings_row = ensure_company_settings(db)
    computed = compute_authoritative_document_totals(
        db, [it.model_dump() for it in payload.items]
    )

    quote = Quote(
        client_id=client.id,
        status="draft",
        issue_date=payload.issue_date or date.today(),
        expiry_date=payload.expiry_date,
        currency=payload.currency or settings_row.currency,
        subtotal=computed.subtotal,
        discount_total=computed.discount_total,
        tax_total=computed.tax_total,
        total=computed.total,
        terms=payload.terms.strip(),
        notes=payload.notes.strip(),
        created_by=user.id,
    )
    db.add(quote)
    db.flush()

    for line in computed.items:
        db.add(
            QuoteItem(
                quote_id=quote.id,
                position=line.position,
                description=line.description,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount_amount=line.discount_amount,
                tax_config_id=line.tax_config_id,
                tax_rate=line.tax_rate,
                tax_amount=line.tax_amount,
                line_subtotal=line.line_subtotal,
                line_total=line.line_total,
            )
        )

    record_audit_log(
        db,
        actor_id=user.id,
        action="quote.created",
        resource_type="quote",
        resource_id=quote.id,
        after_state={"client_id": str(client.id), "total": f"{computed.total:.2f}"},
    )
    db.commit()
    loaded = _load_quote_or_404(db, quote.id)
    return ApiResponse(data=QuoteOut.model_validate(loaded), message="Quotation draft created successfully")


@router.get("/{quotation_id}", response_model=ApiResponse[QuoteOut])
def get_quotation(
    quotation_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("quotations:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[QuoteOut]:
    quote = _load_quote_or_404(db, quotation_id)
    return ApiResponse(data=QuoteOut.model_validate(quote), message="Quotation retrieved successfully")


@router.put("/{quotation_id}", response_model=ApiResponse[QuoteOut])
@router.patch("/{quotation_id}", response_model=ApiResponse[QuoteOut])
def update_quotation_draft(
    quotation_id: uuid.UUID,
    payload: QuoteUpdateRequest,
    user: AuthenticatedUser = Depends(require_permission("quotations:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[QuoteOut]:
    quote = _load_quote_or_404(db, quotation_id, for_update=True)
    if quote.status != "draft":
        raise ConflictError("Only draft quotations can be modified", code="IMMUTABLE_QUOTATION_STATE")

    if payload.issue_date is not None:
        quote.issue_date = payload.issue_date
    if payload.expiry_date is not None:
        quote.expiry_date = payload.expiry_date
    if payload.terms is not None:
        quote.terms = payload.terms.strip()
    if payload.notes is not None:
        quote.notes = payload.notes.strip()

    if payload.items is not None:
        computed = compute_authoritative_document_totals(
            db, [it.model_dump() for it in payload.items]
        )
        db.execute(delete(QuoteItem).where(QuoteItem.quote_id == quote.id))
        for line in computed.items:
            db.add(
                QuoteItem(
                    quote_id=quote.id,
                    position=line.position,
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount_amount=line.discount_amount,
                    tax_config_id=line.tax_config_id,
                    tax_rate=line.tax_rate,
                    tax_amount=line.tax_amount,
                    line_subtotal=line.line_subtotal,
                    line_total=line.line_total,
                )
            )
        quote.subtotal = computed.subtotal
        quote.discount_total = computed.discount_total
        quote.tax_total = computed.tax_total
        quote.total = computed.total

    quote.updated_at = datetime.now(timezone.utc)
    record_audit_log(db, actor_id=user.id, action="quote.draft_updated", resource_type="quote", resource_id=quote.id)
    db.commit()
    db.expire_all()
    loaded = _load_quote_or_404(db, quote.id)
    return ApiResponse(data=QuoteOut.model_validate(loaded), message="Quotation draft updated successfully")


@router.post("/{quotation_id}/issue", response_model=ApiResponse[QuoteOut])
def issue_quotation(
    quotation_id: uuid.UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("quotations:issue")),
    db: Session = Depends(get_db),
) -> ApiResponse[QuoteOut]:
    cached = idempotency_registry.get_or_verify(str(user.id), f"quote.issue:{quotation_id}", idempotency_key, {})
    if cached:
        return ApiResponse.model_validate(cached)

    quote = _load_quote_or_404(db, quotation_id, for_update=True)
    if quote.status == "sent" and quote.quote_number:
        resp = ApiResponse(data=QuoteOut.model_validate(quote), message="Quotation already issued")
        idempotency_registry.store(str(user.id), f"quote.issue:{quotation_id}", idempotency_key, {}, resp.model_dump(mode="json"))
        return resp
    if quote.status != "draft":
        raise ConflictError(f"Cannot issue quotation from status '{quote.status}'", code="INVALID_QUOTATION_TRANSITION")

    settings_row = ensure_company_settings(db)
    client = db.get(Client, quote.client_id)
    if not client:
        raise NotFoundError("Client")

    now = datetime.now(timezone.utc)
    if not quote.quote_number:
        quote.quote_number = allocate_document_number(
            db, "quote", settings_row.quote_prefix or "QTN", scope_year=quote.issue_date.year
        )

    quote.status = "sent"
    quote.company_snapshot = build_company_snapshot(settings_row)
    quote.client_snapshot = build_client_snapshot(client)
    quote.finalized_by = user.id
    quote.finalized_at = now
    quote.updated_at = now

    record_audit_log(
        db,
        actor_id=user.id,
        action="quote.issued",
        resource_type="quote",
        resource_id=quote.id,
        after_state={"quote_number": quote.quote_number, "status": quote.status, "total": f"{quote.total:.2f}"},
    )
    db.commit()
    db.refresh(quote)
    resp = ApiResponse(data=QuoteOut.model_validate(quote), message="Quotation issued successfully")
    idempotency_registry.store(str(user.id), f"quote.issue:{quotation_id}", idempotency_key, {}, resp.model_dump(mode="json"))
    return resp


@router.post("/{quotation_id}/accept", response_model=ApiResponse[QuoteOut])
def accept_quotation(
    quotation_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("quotations:issue")),
    db: Session = Depends(get_db),
) -> ApiResponse[QuoteOut]:
    quote = _load_quote_or_404(db, quotation_id, for_update=True)
    if quote.status == "approved":
        return ApiResponse(data=QuoteOut.model_validate(quote), message="Quotation already accepted")
    if quote.status != "sent":
        raise ConflictError(f"Only issued ('sent') quotations can be accepted (current: '{quote.status}')")

    quote.status = "approved"
    quote.updated_at = datetime.now(timezone.utc)
    record_audit_log(db, actor_id=user.id, action="quote.accepted", resource_type="quote", resource_id=quote.id)
    db.commit()
    db.refresh(quote)
    return ApiResponse(data=QuoteOut.model_validate(quote), message="Quotation accepted successfully")


@router.post("/{quotation_id}/reject", response_model=ApiResponse[QuoteOut])
def reject_quotation(
    quotation_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("quotations:issue")),
    db: Session = Depends(get_db),
) -> ApiResponse[QuoteOut]:
    quote = _load_quote_or_404(db, quotation_id, for_update=True)
    if quote.status not in ("sent", "draft"):
        raise ConflictError(f"Cannot reject quotation in status '{quote.status}'")
    quote.status = "rejected"
    quote.updated_at = datetime.now(timezone.utc)
    record_audit_log(db, actor_id=user.id, action="quote.rejected", resource_type="quote", resource_id=quote.id)
    db.commit()
    db.refresh(quote)
    return ApiResponse(data=QuoteOut.model_validate(quote), message="Quotation marked as rejected")


@router.post("/{quotation_id}/expire", response_model=ApiResponse[QuoteOut])
def expire_quotation(
    quotation_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("quotations:issue")),
    db: Session = Depends(get_db),
) -> ApiResponse[QuoteOut]:
    quote = _load_quote_or_404(db, quotation_id, for_update=True)
    if quote.status != "sent":
        raise ConflictError(f"Only issued ('sent') quotations can expire (current: '{quote.status}')")
    quote.status = "expired"
    quote.updated_at = datetime.now(timezone.utc)
    record_audit_log(db, actor_id=user.id, action="quote.expired", resource_type="quote", resource_id=quote.id)
    db.commit()
    db.refresh(quote)
    return ApiResponse(data=QuoteOut.model_validate(quote), message="Quotation marked as expired")


@router.post("/{quotation_id}/convert-to-invoice", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[dict[str, Any]])
def convert_quotation_to_invoice(
    quotation_id: uuid.UUID,
    payload: QuoteConversionRequest | None = None,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("invoices:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    body_dict = payload.model_dump(mode="json") if payload else {}
    cached = idempotency_registry.get_or_verify(str(user.id), f"quote.convert:{quotation_id}", idempotency_key, body_dict)
    if cached:
        return ApiResponse.model_validate(cached)

    quote = _load_quote_or_404(db, quotation_id, for_update=True)
    if quote.status == "converted":
        existing_inv = db.execute(select(Invoice).where(Invoice.quote_id == quote.id)).scalar_one_or_none()
        if existing_inv:
            resp = ApiResponse(
                data={
                    "quotation_id": str(quote.id),
                    "quote_number": quote.quote_number,
                    "quote_status": quote.status,
                    "invoice_id": str(existing_inv.id),
                    "invoice_number": existing_inv.invoice_number,
                    "invoice_status": existing_inv.status,
                    "total": f"{Decimal(existing_inv.total):.2f}",
                },
                message="Quotation already converted to invoice",
            )
            idempotency_registry.store(str(user.id), f"quote.convert:{quotation_id}", idempotency_key, body_dict, resp.model_dump(mode="json"), 201)
            return resp

    if quote.status != "approved":
        raise ConflictError(
            f"Only accepted ('approved') quotations can be converted to an invoice (current status: '{quote.status}')",
            code="QUOTATION_NOT_APPROVED",
        )

    settings_row = ensure_company_settings(db)
    client = db.get(Client, quote.client_id)
    if not client:
        raise NotFoundError("Client")

    now = datetime.now(timezone.utc)
    issue_now = bool(payload and payload.issue_immediately)
    inv_number = (
        allocate_document_number(db, "invoice", settings_row.invoice_prefix or "INV", scope_year=now.year)
        if issue_now
        else None
    )

    invoice = Invoice(
        invoice_number=inv_number,
        client_id=quote.client_id,
        quote_id=quote.id,
        status="issued" if issue_now else "draft",
        issue_date=now.date(),
        due_date=payload.due_date if payload else None,
        currency=quote.currency,
        subtotal=quote.subtotal,
        discount_total=quote.discount_total,
        tax_total=quote.tax_total,
        total=quote.total,
        amount_allocated=Decimal("0.00"),
        balance_due=quote.total,
        terms=quote.terms,
        notes=(payload.notes.strip() if payload and payload.notes else quote.notes),
        company_snapshot=quote.company_snapshot or build_company_snapshot(settings_row),
        client_snapshot=quote.client_snapshot or build_client_snapshot(client),
        created_by=user.id,
        issued_by=user.id if issue_now else None,
        finalized_at=now if issue_now else None,
    )
    db.add(invoice)
    db.flush()

    for q_item in quote.items:
        db.add(
            InvoiceItem(
                invoice_id=invoice.id,
                position=q_item.position,
                description=q_item.description,
                quantity=q_item.quantity,
                unit_price=q_item.unit_price,
                discount_amount=q_item.discount_amount,
                tax_config_id=q_item.tax_config_id,
                tax_rate=q_item.tax_rate,
                tax_amount=q_item.tax_amount,
                line_subtotal=q_item.line_subtotal,
                line_total=q_item.line_total,
            )
        )

    # Preserve original quotation record and mark conversion lineage
    quote.status = "converted"
    quote.converted_at = now
    quote.updated_at = now

    record_audit_log(
        db,
        actor_id=user.id,
        action="quote.converted_to_invoice",
        resource_type="quote",
        resource_id=quote.id,
        after_state={"invoice_id": str(invoice.id), "invoice_number": invoice.invoice_number},
    )
    db.commit()

    resp = ApiResponse(
        data={
            "quotation_id": str(quote.id),
            "quote_number": quote.quote_number,
            "quote_status": quote.status,
            "invoice_id": str(invoice.id),
            "invoice_number": invoice.invoice_number,
            "invoice_status": invoice.status,
            "total": f"{Decimal(invoice.total):.2f}",
        },
        message="Quotation converted to invoice successfully while preserving original quotation",
    )
    idempotency_registry.store(str(user.id), f"quote.convert:{quotation_id}", idempotency_key, body_dict, resp.model_dump(mode="json"), 201)
    return resp


@router.get("/{quotation_id}/pdf")
def download_quotation_pdf(
    quotation_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("quotations:read")),
    db: Session = Depends(get_db),
) -> Response:
    quote = _load_quote_or_404(db, quotation_id)
    settings_row = ensure_company_settings(db)
    client = db.get(Client, quote.client_id)

    pdf_bytes = render_commercial_document_pdf(
        doc_title="Quotation",
        doc_number=quote.quote_number or "DRAFT",
        status=quote.status,
        issue_date=quote.issue_date.isoformat(),
        secondary_date_label="Valid Until" if quote.expiry_date else None,
        secondary_date_value=quote.expiry_date.isoformat() if quote.expiry_date else None,
        currency=quote.currency,
        company_snapshot=quote.company_snapshot or build_company_snapshot(settings_row),
        client_snapshot=quote.client_snapshot or (build_client_snapshot(client) if client else {}),
        items=[
            {
                "description": it.description,
                "quantity": it.quantity,
                "unit_price": it.unit_price,
                "line_total": it.line_total,
            }
            for it in quote.items
        ],
        subtotal=Decimal(quote.subtotal),
        discount_total=Decimal(quote.discount_total),
        tax_total=Decimal(quote.tax_total),
        total=Decimal(quote.total),
        notes=quote.notes,
        terms=quote.terms,
    )

    record_audit_log(db, actor_id=user.id, action="quote.pdf_generated", resource_type="quote", resource_id=quote.id)
    db.commit()

    filename = f"{quote.quote_number or quote.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
