"""
Invoicing & Accounts Receivable Module (Section 10.5).
Enforces authoritative backend monetary calculations, atomic sequence numbering,
historical document snapshots (`company_snapshot`, `client_snapshot`),
immutability of issued invoices, and admin-controlled cancellation/voiding.
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
from fastapi_service.core.permissions import (
    AuthenticatedUser,
    require_admin,
    require_permission,
)
from fastapi_service.core.security import idempotency_registry, record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.crm import Client
from fastapi_service.models.invoicing import Invoice, InvoiceItem
from fastapi_service.services.financial_service import (
    allocate_document_number,
    build_client_snapshot,
    build_company_snapshot,
    compute_authoritative_document_totals,
    ensure_company_settings,
)

router = APIRouter(prefix="/invoices", tags=["Invoices & Receivables"])


class InvoiceLineItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(..., min_length=1, max_length=500)
    quantity: QuantityDecimal
    unit_price: MoneyDecimal
    discount_amount: MoneyDecimal = Decimal("0.00")
    tax_config_id: uuid.UUID | None = None
    tax_rate: TaxRateDecimal = Decimal("0.0000")


class InvoiceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: uuid.UUID
    quote_id: uuid.UUID | None = None
    issue_date: date | None = None
    due_date: date | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    terms: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=2000)
    issue_immediately: bool = False
    items: list[InvoiceLineItemInput] = Field(..., min_length=1, max_length=200)


class InvoiceUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_date: date | None = None
    due_date: date | None = None
    terms: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)
    items: list[InvoiceLineItemInput] | None = Field(default=None, min_length=1, max_length=200)


class InvoiceCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=3, max_length=500)


class InvoiceItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    invoice_id: uuid.UUID
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


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    invoice_number: str | None
    client_id: uuid.UUID
    quote_id: uuid.UUID | None
    status: str
    issue_date: date
    due_date: date | None
    currency: str
    subtotal: MoneyDecimal
    discount_total: MoneyDecimal
    tax_total: MoneyDecimal
    total: MoneyDecimal
    amount_allocated: MoneyDecimal
    balance_due: MoneyDecimal
    terms: str
    notes: str
    company_snapshot: dict[str, Any] | None
    client_snapshot: dict[str, Any] | None
    created_by: uuid.UUID
    issued_by: uuid.UUID | None
    finalized_at: datetime | None
    cancelled_by: uuid.UUID | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    created_at: datetime
    updated_at: datetime
    items: list[InvoiceItemOut] = []


def _load_invoice_or_404(db: Session, invoice_id: uuid.UUID, for_update: bool = False) -> Invoice:
    stmt = select(Invoice).options(selectinload(Invoice.items)).where(Invoice.id == invoice_id)
    if for_update:
        stmt = stmt.with_for_update()
    inv = db.execute(stmt).scalar_one_or_none()
    if not inv:
        raise NotFoundError("Invoice", details={"invoice_id": str(invoice_id)})
    return inv


@router.get("", response_model=PaginatedResponse[InvoiceOut])
def list_invoices(
    pagination: PaginationParams = Depends(),
    search: str | None = None,
    status: str | None = None,
    client_id: uuid.UUID | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    _user: AuthenticatedUser = Depends(require_permission("invoices:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[InvoiceOut]:
    stmt = select(Invoice).options(selectinload(Invoice.items))
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(or_(Invoice.invoice_number.ilike(q), Invoice.notes.ilike(q)))
    if status:
        stmt = stmt.where(Invoice.status == status)
    if client_id:
        stmt = stmt.where(Invoice.client_id == client_id)
    if from_date:
        stmt = stmt.where(Invoice.issue_date >= from_date)
    if to_date:
        stmt = stmt.where(Invoice.issue_date <= to_date)

    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={
            "created_at": Invoice.created_at,
            "issue_date": Invoice.issue_date,
            "due_date": Invoice.due_date,
            "total": Invoice.total,
            "balance_due": Invoice.balance_due,
            "status": Invoice.status,
        },
    )
    return PaginatedResponse(
        data=[InvoiceOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Invoices retrieved successfully",
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[InvoiceOut])
def create_invoice(
    payload: InvoiceCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("invoices:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceOut]:
    body_dict = payload.model_dump(mode="json")
    cached = idempotency_registry.get_or_verify(str(user.id), "invoice.create", idempotency_key, body_dict)
    if cached:
        return ApiResponse.model_validate(cached)

    client = db.get(Client, payload.client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(payload.client_id)})

    settings_row = ensure_company_settings(db)
    computed = compute_authoritative_document_totals(
        db, [it.model_dump() for it in payload.items]
    )

    now = datetime.now(timezone.utc)
    issue_dt = payload.issue_date or now.date()
    inv_number = None
    company_snap = None
    client_snap = None
    inv_status = "draft"

    if payload.issue_immediately:
        inv_number = allocate_document_number(
            db, "invoice", settings_row.invoice_prefix or "INV", scope_year=issue_dt.year
        )
        company_snap = build_company_snapshot(settings_row)
        client_snap = build_client_snapshot(client)
        inv_status = "issued"

    inv = Invoice(
        invoice_number=inv_number,
        client_id=client.id,
        quote_id=payload.quote_id,
        status=inv_status,
        issue_date=issue_dt,
        due_date=payload.due_date,
        currency=payload.currency or settings_row.currency,
        subtotal=computed.subtotal,
        discount_total=computed.discount_total,
        tax_total=computed.tax_total,
        total=computed.total,
        amount_allocated=Decimal("0.00"),
        balance_due=computed.total,
        terms=payload.terms.strip(),
        notes=payload.notes.strip(),
        company_snapshot=company_snap,
        client_snapshot=client_snap,
        created_by=user.id,
        issued_by=user.id if payload.issue_immediately else None,
        finalized_at=now if payload.issue_immediately else None,
    )
    db.add(inv)
    db.flush()

    for line in computed.items:
        db.add(
            InvoiceItem(
                invoice_id=inv.id,
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
        action="invoice.issued" if payload.issue_immediately else "invoice.created",
        resource_type="invoice",
        resource_id=inv.id,
        after_state={
            "invoice_number": inv.invoice_number,
            "status": inv.status,
            "total": f"{computed.total:.2f}",
        },
    )
    db.commit()
    loaded = _load_invoice_or_404(db, inv.id)
    resp = ApiResponse(
        data=InvoiceOut.model_validate(loaded),
        message="Invoice created and issued successfully" if payload.issue_immediately else "Invoice draft created successfully",
    )
    idempotency_registry.store(str(user.id), "invoice.create", idempotency_key, body_dict, resp.model_dump(mode="json"), 201)
    return resp


@router.get("/{invoice_id}", response_model=ApiResponse[InvoiceOut])
def get_invoice(
    invoice_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("invoices:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceOut]:
    inv = _load_invoice_or_404(db, invoice_id)
    return ApiResponse(data=InvoiceOut.model_validate(inv), message="Invoice retrieved successfully")


@router.put("/{invoice_id}", response_model=ApiResponse[InvoiceOut])
@router.patch("/{invoice_id}", response_model=ApiResponse[InvoiceOut])
def update_invoice_draft(
    invoice_id: uuid.UUID,
    payload: InvoiceUpdateRequest,
    user: AuthenticatedUser = Depends(require_permission("invoices:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceOut]:
    inv = _load_invoice_or_404(db, invoice_id, for_update=True)
    if inv.status != "draft":
        raise ConflictError(
            "Issued or finalized invoices are immutable and cannot be edited; use cancellation or adjustment workflows",
            code="IMMUTABLE_INVOICE",
        )

    if payload.issue_date is not None:
        inv.issue_date = payload.issue_date
    if payload.due_date is not None:
        inv.due_date = payload.due_date
    if payload.terms is not None:
        inv.terms = payload.terms.strip()
    if payload.notes is not None:
        inv.notes = payload.notes.strip()

    if payload.items is not None:
        computed = compute_authoritative_document_totals(
            db, [it.model_dump() for it in payload.items]
        )
        db.execute(delete(InvoiceItem).where(InvoiceItem.invoice_id == inv.id))
        for line in computed.items:
            db.add(
                InvoiceItem(
                    invoice_id=inv.id,
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
        inv.subtotal = computed.subtotal
        inv.discount_total = computed.discount_total
        inv.tax_total = computed.tax_total
        inv.total = computed.total
        inv.balance_due = computed.total

    inv.updated_at = datetime.now(timezone.utc)
    record_audit_log(db, actor_id=user.id, action="invoice.draft_updated", resource_type="invoice", resource_id=inv.id)
    db.commit()
    db.expire_all()
    loaded = _load_invoice_or_404(db, inv.id)
    return ApiResponse(data=InvoiceOut.model_validate(loaded), message="Invoice draft updated successfully")


@router.post("/{invoice_id}/issue", response_model=ApiResponse[InvoiceOut])
def issue_invoice(
    invoice_id: uuid.UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("invoices:issue")),
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceOut]:
    cached = idempotency_registry.get_or_verify(str(user.id), f"invoice.issue:{invoice_id}", idempotency_key, {})
    if cached:
        return ApiResponse.model_validate(cached)

    inv = _load_invoice_or_404(db, invoice_id, for_update=True)
    if inv.status in ("issued", "partially_paid", "paid") and inv.invoice_number:
        resp = ApiResponse(data=InvoiceOut.model_validate(inv), message="Invoice already issued")
        idempotency_registry.store(str(user.id), f"invoice.issue:{invoice_id}", idempotency_key, {}, resp.model_dump(mode="json"))
        return resp

    if inv.status != "draft":
        raise ConflictError(f"Cannot issue invoice from status '{inv.status}'", code="INVALID_INVOICE_TRANSITION")
    if not inv.items:
        raise ConflictError("Cannot issue an invoice with zero line items", code="EMPTY_INVOICE")

    settings_row = ensure_company_settings(db)
    client = db.get(Client, inv.client_id)
    if not client:
        raise NotFoundError("Client")

    now = datetime.now(timezone.utc)
    if not inv.invoice_number:
        inv.invoice_number = allocate_document_number(
            db, "invoice", settings_row.invoice_prefix or "INV", scope_year=inv.issue_date.year
        )

    inv.status = "issued"
    inv.company_snapshot = build_company_snapshot(settings_row)
    inv.client_snapshot = build_client_snapshot(client)
    inv.issued_by = user.id
    inv.finalized_at = now
    inv.updated_at = now

    record_audit_log(
        db,
        actor_id=user.id,
        action="invoice.issued",
        resource_type="invoice",
        resource_id=inv.id,
        after_state={
            "invoice_number": inv.invoice_number,
            "total": f"{inv.total:.2f}",
            "balance_due": f"{inv.balance_due:.2f}",
        },
    )
    db.commit()
    db.refresh(inv)
    resp = ApiResponse(data=InvoiceOut.model_validate(inv), message="Invoice issued successfully")
    idempotency_registry.store(str(user.id), f"invoice.issue:{invoice_id}", idempotency_key, {}, resp.model_dump(mode="json"))
    return resp


@router.post("/{invoice_id}/cancel", response_model=ApiResponse[InvoiceOut])
def cancel_invoice(
    invoice_id: uuid.UUID,
    payload: InvoiceCancelRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceOut]:
    inv = _load_invoice_or_404(db, invoice_id, for_update=True)
    if inv.status == "cancelled":
        return ApiResponse(data=InvoiceOut.model_validate(inv), message="Invoice is already cancelled")

    if Decimal(inv.amount_allocated) > Decimal("0.00"):
        raise ConflictError(
            "Cannot cancel an invoice that has active payment allocations; reverse the payment allocations first",
            code="INVOICE_HAS_ACTIVE_ALLOCATIONS",
        )

    before_status = inv.status
    now = datetime.now(timezone.utc)
    inv.status = "cancelled"
    inv.cancelled_by = admin.id
    inv.cancelled_at = now
    inv.cancel_reason = payload.reason.strip()
    inv.updated_at = now

    record_audit_log(
        db,
        actor_id=admin.id,
        action="invoice.cancelled",
        resource_type="invoice",
        resource_id=inv.id,
        before_state={"status": before_status},
        after_state={"status": "cancelled", "cancel_reason": inv.cancel_reason},
    )
    db.commit()
    db.refresh(inv)
    return ApiResponse(data=InvoiceOut.model_validate(inv), message="Invoice cancelled successfully")


@router.get("/{invoice_id}/pdf")
def download_invoice_pdf(
    invoice_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("invoices:read")),
    db: Session = Depends(get_db),
) -> Response:
    inv = _load_invoice_or_404(db, invoice_id)
    settings_row = ensure_company_settings(db)
    client = db.get(Client, inv.client_id)

    pdf_bytes = render_commercial_document_pdf(
        doc_title="Tax Invoice",
        doc_number=inv.invoice_number or "DRAFT",
        status=inv.status,
        issue_date=inv.issue_date.isoformat(),
        secondary_date_label="Due Date" if inv.due_date else None,
        secondary_date_value=inv.due_date.isoformat() if inv.due_date else None,
        currency=inv.currency,
        company_snapshot=inv.company_snapshot or build_company_snapshot(settings_row),
        client_snapshot=inv.client_snapshot or (build_client_snapshot(client) if client else {}),
        items=[
            {
                "description": it.description,
                "quantity": it.quantity,
                "unit_price": it.unit_price,
                "line_total": it.line_total,
            }
            for it in inv.items
        ],
        subtotal=Decimal(inv.subtotal),
        discount_total=Decimal(inv.discount_total),
        tax_total=Decimal(inv.tax_total),
        total=Decimal(inv.total),
        amount_paid_or_allocated=Decimal(inv.amount_allocated),
        balance_due=Decimal(inv.balance_due),
        notes=inv.notes,
        terms=inv.terms,
    )

    record_audit_log(db, actor_id=user.id, action="invoice.pdf_generated", resource_type="invoice", resource_id=inv.id)
    db.commit()

    filename = f"{inv.invoice_number or inv.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
