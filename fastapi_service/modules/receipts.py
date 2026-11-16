"""
Receipts Generation, Finalization, Reprinting & PDF Module (Sections 9.1 & 10.7).
Enforces:
- Never generating a receipt for an unconfirmed payment.
- Idempotent receipt generation from confirmed payments via `payment_receipt_allocations`.
- Prevention of double-receipting at both service and PostgreSQL trigger levels.
- Immutable finalized receipts & duplicate copy banner on reprints (`print_count > 1`).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from fastapi_service.core.config import settings
from fastapi_service.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
)
from fastapi_service.core.pagination import (
    ApiResponse,
    MoneyDecimal,
    PaginatedResponse,
    PaginationParams,
    QuantityDecimal,
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
from fastapi_service.models.invoicing import Invoice
from fastapi_service.models.payments import Payment
from fastapi_service.models.receipts import (
    PaymentReceiptAllocation,
    Receipt,
    ReceiptItem,
)
from fastapi_service.services.financial_service import (
    allocate_document_number,
    allocate_unique_verification_code,
    build_client_snapshot,
    build_company_snapshot,
    compute_authoritative_document_totals,
    ensure_company_settings,
    quantize_money,
)

router = APIRouter(prefix="/receipts", tags=["Receipts"])


class ReceiptLineItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(..., min_length=1, max_length=500)
    quantity: QuantityDecimal
    unit_price: MoneyDecimal


class ReceiptFromPaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payment_id: uuid.UUID
    invoice_id: uuid.UUID | None = None
    amount_acknowledged: MoneyDecimal | None = None
    notes: str = Field(default="", max_length=2000)


class ReceiptDraftCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: uuid.UUID | None = None
    customer_name: str = Field(..., min_length=1, max_length=200)
    customer_phone: str = Field(default="", max_length=50)
    customer_address: str = Field(default="", max_length=500)
    payment_method: str = Field(default="M-Pesa", max_length=60)
    payment_status: str = Field(default="paid", max_length=30)
    notes: str = Field(default="", max_length=2000)
    items: list[ReceiptLineItemInput] = Field(..., min_length=1, max_length=200)


class ReceiptCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=3, max_length=500)


class ReceiptItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    receipt_id: uuid.UUID
    position: int
    description: str
    quantity: QuantityDecimal
    unit_price: MoneyDecimal
    line_total: MoneyDecimal


class ReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    receipt_number: str | None
    verification_code: str | None
    client_id: uuid.UUID
    primary_payment_id: uuid.UUID | None
    invoice_id: uuid.UUID | None
    customer_name: str
    customer_phone: str
    customer_address: str
    notes: str
    currency: str
    total: MoneyDecimal
    payment_status: str
    amount_paid: MoneyDecimal
    balance_due: MoneyDecimal
    payment_method: str
    company_snapshot: dict[str, Any] | None
    created_by: uuid.UUID
    issued_by: uuid.UUID | None
    issued_by_name: str | None
    finalized_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    print_count: int
    created_at: datetime
    updated_at: datetime
    items: list[ReceiptItemOut] = []


def _load_receipt_or_404(db: Session, receipt_id: uuid.UUID, for_update: bool = False) -> Receipt:
    stmt = select(Receipt).options(selectinload(Receipt.items)).where(Receipt.id == receipt_id)
    if for_update:
        stmt = stmt.with_for_update()
    rcp = db.execute(stmt).scalar_one_or_none()
    if not rcp:
        raise NotFoundError("Receipt", details={"receipt_id": str(receipt_id)})
    return rcp


@router.get("", response_model=PaginatedResponse[ReceiptOut])
def list_receipts(
    pagination: PaginationParams = Depends(),
    search: str | None = None,
    status: str | None = None,
    client_id: uuid.UUID | None = None,
    client: uuid.UUID | None = None,
    _user: AuthenticatedUser = Depends(require_permission("receipts:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[ReceiptOut]:
    stmt = select(Receipt).options(selectinload(Receipt.items))
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Receipt.receipt_number.ilike(q),
                Receipt.verification_code.ilike(q),
                Receipt.customer_name.ilike(q),
            )
        )
    if status in ("draft", "finalized", "cancelled"):
        stmt = stmt.where(Receipt.status == status)
    effective_client = client_id or client
    if effective_client:
        stmt = stmt.where(Receipt.client_id == effective_client)

    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={
            "created_at": Receipt.created_at,
            "finalized_at": Receipt.finalized_at,
            "total": Receipt.total,
            "status": Receipt.status,
        },
    )
    return PaginatedResponse(
        data=[ReceiptOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Receipts retrieved successfully",
    )


@router.post("/from-payment", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ReceiptOut])
def generate_receipt_from_payment(
    payload: ReceiptFromPaymentRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("receipts:finalize")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReceiptOut]:
    """
    Generates an official finalized receipt acknowledging a confirmed payment (or portion thereof).
    - Idempotent: if the exact full payment has already been receipted and `amount_acknowledged` is omitted,
      or if `Idempotency-Key` matches, protects against duplicate receipt creation.
    - Enforces at both service and PostgreSQL trigger levels that unconfirmed payments can never be receipted
      and no payment amount can be acknowledged more than once.
    """
    body_dict = payload.model_dump(mode="json")
    cached = idempotency_registry.get_or_verify(str(user.id), "receipt.from_payment", idempotency_key, body_dict)
    if cached:
        return ApiResponse.model_validate(cached)

    payment = db.execute(select(Payment).where(Payment.id == payload.payment_id).with_for_update()).scalar_one_or_none()
    if not payment:
        raise NotFoundError("Payment", details={"payment_id": str(payload.payment_id)})

    if payment.status not in ("confirmed", "partially_refunded"):
        raise ConflictError(
            f"Cannot generate a receipt for an unconfirmed payment (status='{payment.status}')",
            code="UNCONFIRMED_PAYMENT_RECEIPT_FORBIDDEN",
        )

    net_available_to_receipt = quantize_money(
        Decimal(payment.amount) - Decimal(payment.amount_refunded) - Decimal(payment.amount_receipted)
    )
    ack_amount = payload.amount_acknowledged if payload.amount_acknowledged is not None else net_available_to_receipt

    if ack_amount <= Decimal("0.00") or ack_amount > net_available_to_receipt:
        raise ConflictError(
            f"Double-receipting prevented: requested receipt amount ({ack_amount:.2f}) exceeds unreceipted payment balance ({net_available_to_receipt:.2f})",
            code="DOUBLE_RECEIPTING_PREVENTED",
        )

    client = db.get(Client, payment.client_id)
    if not client:
        raise NotFoundError("Client")

    invoice: Invoice | None = None
    if payload.invoice_id:
        invoice = db.get(Invoice, payload.invoice_id)
        if not invoice:
            raise NotFoundError("Invoice", details={"invoice_id": str(payload.invoice_id)})

    settings_row = ensure_company_settings(db)
    now = datetime.now(timezone.utc)
    rcp_number = allocate_document_number(
        db, "receipt", settings_row.number_prefix or "RCP", scope_year=now.year
    )
    v_code = allocate_unique_verification_code(db)

    inv_balance = Decimal(invoice.balance_due) if invoice else Decimal("0.00")
    desc = (
        f"Payment acknowledgment ({payment.payment_reference}) for Invoice {invoice.invoice_number}"
        if invoice and invoice.invoice_number
        else f"Payment acknowledgment ({payment.payment_reference})"
    )

    rcp = Receipt(
        status="finalized",
        receipt_number=rcp_number,
        verification_code=v_code,
        client_id=client.id,
        primary_payment_id=payment.id,
        invoice_id=invoice.id if invoice else None,
        customer_name=client.name,
        customer_phone=client.phone,
        customer_address=client.address,
        notes=payload.notes.strip(),
        currency=payment.currency,
        total=ack_amount,
        payment_status="paid" if inv_balance == Decimal("0.00") else "half_paid",
        amount_paid=ack_amount,
        balance_due=inv_balance,
        payment_method=payment.payment_method,
        company_snapshot=build_company_snapshot(settings_row),
        created_by=user.id,
        issued_by=user.id,
        issued_by_name=user.full_name,
        finalized_at=now,
    )
    db.add(rcp)
    db.flush()

    db.add(
        ReceiptItem(
            receipt_id=rcp.id,
            position=1,
            description=desc,
            quantity=Decimal("1.000"),
            unit_price=ack_amount,
            line_total=ack_amount,
        )
    )
    db.add(
        PaymentReceiptAllocation(
            payment_id=payment.id,
            receipt_id=rcp.id,
            amount_acknowledged=ack_amount,
            status="active",
        )
    )
    db.flush()

    record_audit_log(
        db,
        actor_id=user.id,
        action="receipt.generated_from_payment",
        resource_type="receipt",
        resource_id=rcp.id,
        after_state={
            "receipt_number": rcp.receipt_number,
            "payment_id": str(payment.id),
            "amount_acknowledged": f"{ack_amount:.2f}",
        },
    )
    db.commit()
    loaded = _load_receipt_or_404(db, rcp.id)
    resp = ApiResponse(
        data=ReceiptOut.model_validate(loaded),
        message="Receipt generated from confirmed payment successfully",
    )
    idempotency_registry.store(str(user.id), "receipt.from_payment", idempotency_key, body_dict, resp.model_dump(mode="json"), 201)
    return resp


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ReceiptOut])
def create_receipt_draft(
    payload: ReceiptDraftCreateRequest,
    user: AuthenticatedUser = Depends(require_permission("receipts:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReceiptOut]:
    settings_row = ensure_company_settings(db)
    computed = compute_authoritative_document_totals(
        db, [it.model_dump() for it in payload.items]
    )

    if payload.client_id:
        client = db.get(Client, payload.client_id)
        if not client:
            raise NotFoundError("Client", details={"client_id": str(payload.client_id)})
    else:
        client = Client(
            client_code=f"CL-{uuid.uuid4().hex[:8].upper()}",
            name=payload.customer_name.strip(),
            phone=payload.customer_phone.strip(),
            address=payload.customer_address.strip(),
            created_by=user.id,
        )
        db.add(client)
        db.flush()

    rcp = Receipt(
        status="draft",
        client_id=client.id,
        customer_name=payload.customer_name.strip(),
        customer_phone=payload.customer_phone.strip(),
        customer_address=payload.customer_address.strip(),
        notes=payload.notes.strip(),
        currency=settings_row.currency,
        total=computed.total,
        payment_status=payload.payment_status,
        amount_paid=computed.total if payload.payment_status == "paid" else Decimal("0.00"),
        balance_due=Decimal("0.00") if payload.payment_status == "paid" else computed.total,
        payment_method=payload.payment_method.strip(),
        created_by=user.id,
    )
    db.add(rcp)
    db.flush()

    for line in computed.items:
        db.add(
            ReceiptItem(
                receipt_id=rcp.id,
                position=line.position,
                description=line.description,
                quantity=line.quantity,
                unit_price=line.unit_price,
                line_total=line.line_total,
            )
        )

    record_audit_log(db, actor_id=user.id, action="receipt.draft_created", resource_type="receipt", resource_id=rcp.id)
    db.commit()
    loaded = _load_receipt_or_404(db, rcp.id)
    return ApiResponse(data=ReceiptOut.model_validate(loaded), message="Receipt draft created successfully")


@router.get("/{receipt_id}", response_model=ApiResponse[ReceiptOut])
def get_receipt(
    receipt_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("receipts:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReceiptOut]:
    rcp = _load_receipt_or_404(db, receipt_id)
    return ApiResponse(data=ReceiptOut.model_validate(rcp), message="Receipt retrieved successfully")


@router.put("/{receipt_id}", response_model=ApiResponse[ReceiptOut])
@router.patch("/{receipt_id}", response_model=ApiResponse[ReceiptOut])
def update_receipt_draft(
    receipt_id: uuid.UUID,
    payload: ReceiptDraftCreateRequest,
    user: AuthenticatedUser = Depends(require_permission("receipts:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReceiptOut]:
    rcp = _load_receipt_or_404(db, receipt_id, for_update=True)
    if str(rcp.status) != "draft":
        raise ConflictError(
            "Finalized or cancelled receipts are immutable and cannot be modified",
            code="IMMUTABLE_RECEIPT",
        )

    computed = compute_authoritative_document_totals(
        db, [it.model_dump() for it in payload.items]
    )
    rcp.customer_name = payload.customer_name.strip()
    rcp.customer_phone = payload.customer_phone.strip()
    rcp.customer_address = payload.customer_address.strip()
    rcp.notes = payload.notes.strip()
    rcp.payment_method = payload.payment_method.strip()
    rcp.payment_status = payload.payment_status
    rcp.total = computed.total
    rcp.amount_paid = computed.total if payload.payment_status == "paid" else Decimal("0.00")
    rcp.balance_due = Decimal("0.00") if payload.payment_status == "paid" else computed.total
    rcp.updated_at = datetime.now(timezone.utc)

    db.execute(delete(ReceiptItem).where(ReceiptItem.receipt_id == rcp.id))
    for line in computed.items:
        db.add(
            ReceiptItem(
                receipt_id=rcp.id,
                position=line.position,
                description=line.description,
                quantity=line.quantity,
                unit_price=line.unit_price,
                line_total=line.line_total,
            )
        )

    record_audit_log(db, actor_id=user.id, action="receipt.draft_updated", resource_type="receipt", resource_id=rcp.id)
    db.commit()
    db.expire_all()
    loaded = _load_receipt_or_404(db, rcp.id)
    return ApiResponse(data=ReceiptOut.model_validate(loaded), message="Receipt draft updated successfully")


@router.post("/{receipt_id}/finalize", response_model=ApiResponse[ReceiptOut])
def finalize_receipt_endpoint(
    receipt_id: uuid.UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("receipts:finalize")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReceiptOut]:
    cached = idempotency_registry.get_or_verify(str(user.id), f"receipt.finalize:{receipt_id}", idempotency_key, {})
    if cached:
        return ApiResponse.model_validate(cached)

    rcp = _load_receipt_or_404(db, receipt_id, for_update=True)
    if str(rcp.status) == "finalized" and rcp.receipt_number:
        resp = ApiResponse(data=ReceiptOut.model_validate(rcp), message="Receipt is already finalized")
        idempotency_registry.store(str(user.id), f"receipt.finalize:{receipt_id}", idempotency_key, {}, resp.model_dump(mode="json"))
        return resp
    if str(rcp.status) != "draft":
        raise ConflictError(f"Cannot finalize receipt in status '{rcp.status}'", code="INVALID_RECEIPT_TRANSITION")
    if not rcp.items:
        raise BadRequestError("Cannot finalize a receipt with no line items")

    settings_row = ensure_company_settings(db)
    now = datetime.now(timezone.utc)
    rcp.status = "finalized"
    rcp.receipt_number = allocate_document_number(
        db, "receipt", settings_row.number_prefix or "RCP", scope_year=now.year
    )
    rcp.verification_code = allocate_unique_verification_code(db)
    rcp.company_snapshot = build_company_snapshot(settings_row)
    rcp.issued_by = user.id
    rcp.issued_by_name = user.full_name
    rcp.finalized_at = now
    rcp.updated_at = now

    record_audit_log(
        db,
        actor_id=user.id,
        action="receipt.finalized",
        resource_type="receipt",
        resource_id=rcp.id,
        after_state={"receipt_number": rcp.receipt_number, "verification_code": rcp.verification_code},
    )
    db.commit()
    db.refresh(rcp)
    resp = ApiResponse(data=ReceiptOut.model_validate(rcp), message="Receipt finalized successfully")
    idempotency_registry.store(str(user.id), f"receipt.finalize:{receipt_id}", idempotency_key, {}, resp.model_dump(mode="json"))
    return resp


@router.post("/{receipt_id}/cancel", response_model=ApiResponse[ReceiptOut])
def cancel_receipt_endpoint(
    receipt_id: uuid.UUID,
    payload: ReceiptCancelRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[ReceiptOut]:
    rcp = _load_receipt_or_404(db, receipt_id, for_update=True)
    if str(rcp.status) == "cancelled":
        return ApiResponse(data=ReceiptOut.model_validate(rcp), message="Receipt is already cancelled")
    if str(rcp.status) != "finalized":
        raise ConflictError("Only finalized receipts can be cancelled", code="INVALID_RECEIPT_CANCELLATION")

    now = datetime.now(timezone.utc)
    rcp.status = "cancelled"
    rcp.cancelled_by = admin.id
    rcp.cancelled_at = now
    rcp.cancel_reason = payload.reason.strip()
    rcp.updated_at = now

    # Release any active payment_receipt_allocations so the underlying payment is no longer locked to a cancelled receipt
    pra_rows = list(
        db.execute(
            select(PaymentReceiptAllocation).where(
                PaymentReceiptAllocation.receipt_id == rcp.id,
                PaymentReceiptAllocation.status == "active",
            )
        ).scalars().all()
    )
    for pra in pra_rows:
        pra.status = "cancelled"

    record_audit_log(
        db,
        actor_id=admin.id,
        action="receipt.cancelled",
        resource_type="receipt",
        resource_id=rcp.id,
        after_state={"status": "cancelled", "cancel_reason": rcp.cancel_reason},
    )
    db.commit()
    db.refresh(rcp)
    return ApiResponse(data=ReceiptOut.model_validate(rcp), message="Receipt cancelled successfully")


@router.post("/{receipt_id}/print", response_model=ApiResponse[dict[str, Any]])
def record_receipt_print(
    receipt_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("receipts:print")),
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """
    Increments `print_count` without creating another payment or receipt record.
    Marks `is_duplicate_copy = True` when `print_count > 1`.
    """
    rcp = _load_receipt_or_404(db, receipt_id, for_update=True)
    if str(rcp.status) == "draft":
        raise ConflictError("Draft receipts cannot be printed as official copies; finalize the receipt first")

    rcp.print_count = int(rcp.print_count or 0) + 1
    copy_num = rcp.print_count
    record_audit_log(
        db,
        actor_id=user.id,
        action="receipt.reprinted" if copy_num > 1 else "receipt.printed",
        resource_type="receipt",
        resource_id=rcp.id,
        after_state={"print_count": copy_num, "is_duplicate_copy": copy_num > 1},
    )
    db.commit()
    return ApiResponse(
        data={
            "receipt_id": str(rcp.id),
            "receipt_number": rcp.receipt_number,
            "print_count": copy_num,
            "is_duplicate_copy": copy_num > 1,
            "banner": f"DUPLICATE COPY #{copy_num}" if copy_num > 1 else "ORIGINAL COPY",
        },
        message="Receipt print recorded successfully",
    )


@router.get("/{receipt_id}/pdf")
def download_receipt_pdf(
    receipt_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("receipts:read")),
    db: Session = Depends(get_db),
) -> Response:
    rcp = _load_receipt_or_404(db, receipt_id, for_update=True)
    if str(rcp.status) != "draft":
        rcp.print_count = int(rcp.print_count or 0) + 1

    verify_url = (
        f"{settings.public_app_origin}/verify/{rcp.verification_code}"
        if rcp.verification_code
        else None
    )

    pdf_bytes = render_commercial_document_pdf(
        doc_title="Official Receipt",
        doc_number=rcp.receipt_number or "DRAFT",
        status=str(rcp.status),
        issue_date=(rcp.finalized_at or rcp.created_at).date().isoformat(),
        secondary_date_label="Verification Code" if rcp.verification_code else None,
        secondary_date_value=rcp.verification_code,
        currency=rcp.currency,
        company_snapshot=rcp.company_snapshot or {},
        client_snapshot={
            "name": rcp.customer_name,
            "phone": rcp.customer_phone,
            "address": rcp.customer_address,
        },
        items=[
            {
                "description": it.description,
                "quantity": it.quantity,
                "unit_price": it.unit_price,
                "line_total": it.line_total,
            }
            for it in rcp.items
        ],
        subtotal=Decimal(rcp.total),
        discount_total=Decimal("0.00"),
        tax_total=Decimal("0.00"),
        total=Decimal(rcp.total),
        amount_paid_or_allocated=Decimal(rcp.amount_paid),
        balance_due=Decimal(rcp.balance_due),
        notes=rcp.notes,
        verification_url=verify_url,
        print_count=rcp.print_count,
    )

    record_audit_log(
        db,
        actor_id=user.id,
        action="receipt.pdf_downloaded",
        resource_type="receipt",
        resource_id=rcp.id,
        metadata={"print_count": rcp.print_count},
    )
    db.commit()

    filename = f"{rcp.receipt_number or rcp.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "X-Print-Count": str(rcp.print_count),
        },
    )
