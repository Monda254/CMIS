"""
Payments, Allocations, Reversals & Refunds Module (Sections 9.1 & 10.6).
Enforces controlled payment confirmation, atomic invoice allocation, over-allocation rejection,
and historical payment preservation during reversals and refunds.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

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
    paginate_select,
)
from fastapi_service.core.permissions import (
    AuthenticatedUser,
    require_admin,
    require_permission,
)
from fastapi_service.core.security import idempotency_registry, record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.crm import Client
from fastapi_service.models.invoicing import Invoice
from fastapi_service.models.payments import Payment, PaymentAllocation, PaymentRefund
from fastapi_service.models.receipts import PaymentReceiptAllocation, Receipt
from fastapi_service.services.financial_service import (
    allocate_document_number,
    ensure_company_settings,
    quantize_money,
)

router = APIRouter(prefix="/payments", tags=["Payments & Allocations"])

PAN_OR_CVV_PATTERN = re.compile(r"\b(?:\d[ -]*?){13,19}\b")


class PaymentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: uuid.UUID
    amount: MoneyDecimal
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    payment_method: Literal["cash", "mpesa", "bank_transfer", "card", "cheque", "other"] = "mpesa"
    external_reference: str | None = Field(default=None, max_length=100)
    payment_date: datetime | None = None
    notes: str = Field(default="", max_length=2000)
    confirm_immediately: bool = False

    @field_validator("external_reference", "notes")
    @classmethod
    def reject_card_pan(cls, val: str | None) -> str | None:
        if val and PAN_OR_CVV_PATTERN.search(val):
            raise ValueError("Full payment card numbers (PAN) must never be submitted or stored")
        return val


class PaymentAllocationItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    invoice_id: uuid.UUID
    amount: MoneyDecimal
    notes: str = Field(default="", max_length=500)


class PaymentAllocateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allocations: list[PaymentAllocationItemInput] = Field(..., min_length=1, max_length=50)


class PaymentReverseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=3, max_length=500)


class PaymentRefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: MoneyDecimal
    reason: str = Field(..., min_length=3, max_length=500)
    external_reference: str | None = Field(default=None, max_length=100)
    deallocate_invoices_if_needed: bool = True


class PaymentAllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    payment_id: uuid.UUID
    invoice_id: uuid.UUID
    amount: MoneyDecimal
    status: str
    notes: str
    allocated_by: uuid.UUID
    allocated_at: datetime
    reversed_by: uuid.UUID | None
    reversed_at: datetime | None
    reversal_reason: str | None


class PaymentRefundOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    refund_reference: str
    payment_id: uuid.UUID
    amount: MoneyDecimal
    reason: str
    status: str
    external_reference: str | None
    processed_by: uuid.UUID
    refunded_at: datetime
    created_at: datetime


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    payment_reference: str
    client_id: uuid.UUID
    status: str
    payment_method: str
    external_reference: str | None
    payment_date: datetime
    currency: str
    amount: MoneyDecimal
    amount_allocated: MoneyDecimal
    amount_refunded: MoneyDecimal
    amount_receipted: MoneyDecimal
    unallocated_amount: MoneyDecimal
    notes: str
    recorded_by: uuid.UUID
    confirmed_by: uuid.UUID | None
    confirmed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    allocations: list[PaymentAllocationOut] = []
    refunds: list[PaymentRefundOut] = []


def _load_payment_or_404(db: Session, payment_id: uuid.UUID, for_update: bool = False) -> Payment:
    stmt = (
        select(Payment)
        .options(selectinload(Payment.allocations), selectinload(Payment.refunds))
        .where(Payment.id == payment_id)
    )
    if for_update:
        stmt = stmt.with_for_update()
    pay = db.execute(stmt).scalar_one_or_none()
    if not pay:
        raise NotFoundError("Payment", details={"payment_id": str(payment_id)})
    return pay


@router.get("", response_model=PaginatedResponse[PaymentOut])
def list_payments(
    pagination: PaginationParams = Depends(),
    search: str | None = None,
    status: str | None = None,
    payment_method: str | None = None,
    client_id: uuid.UUID | None = None,
    min_amount: Decimal | None = None,
    max_amount: Decimal | None = None,
    _user: AuthenticatedUser = Depends(require_permission("payments:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[PaymentOut]:
    stmt = select(Payment).options(selectinload(Payment.allocations), selectinload(Payment.refunds))
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Payment.payment_reference.ilike(q),
                Payment.external_reference.ilike(q),
                Payment.notes.ilike(q),
            )
        )
    if status:
        stmt = stmt.where(Payment.status == status)
    if payment_method:
        stmt = stmt.where(Payment.payment_method == payment_method)
    if client_id:
        stmt = stmt.where(Payment.client_id == client_id)
    if min_amount is not None:
        stmt = stmt.where(Payment.amount >= min_amount)
    if max_amount is not None:
        stmt = stmt.where(Payment.amount <= max_amount)

    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={
            "created_at": Payment.created_at,
            "payment_date": Payment.payment_date,
            "amount": Payment.amount,
            "status": Payment.status,
        },
    )
    return PaginatedResponse(
        data=[PaymentOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Payments retrieved successfully",
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[PaymentOut])
def create_payment(
    payload: PaymentCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("payments:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[PaymentOut]:
    body_dict = payload.model_dump(mode="json")
    cached = idempotency_registry.get_or_verify(str(user.id), "payment.create", idempotency_key, body_dict)
    if cached:
        return ApiResponse.model_validate(cached)

    if payload.amount <= Decimal("0.00"):
        raise BadRequestError("Payment amount must be strictly positive")

    client = db.get(Client, payload.client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(payload.client_id)})

    settings_row = ensure_company_settings(db)
    now = datetime.now(timezone.utc)
    pay_dt = payload.payment_date or now
    pay_ref = allocate_document_number(
        db, "payment", settings_row.payment_prefix or "PAY", scope_year=pay_dt.year
    )

    is_confirmed = bool(payload.confirm_immediately and user.has_permission("payments:confirm"))

    payment = Payment(
        payment_reference=pay_ref,
        client_id=client.id,
        status="confirmed" if is_confirmed else "pending",
        payment_method=payload.payment_method,
        external_reference=payload.external_reference.strip() if payload.external_reference else None,
        payment_date=pay_dt,
        currency=payload.currency or settings_row.currency,
        amount=payload.amount,
        amount_allocated=Decimal("0.00"),
        amount_refunded=Decimal("0.00"),
        amount_receipted=Decimal("0.00"),
        unallocated_amount=payload.amount,
        notes=payload.notes.strip(),
        recorded_by=user.id,
        confirmed_by=user.id if is_confirmed else None,
        confirmed_at=now if is_confirmed else None,
    )
    db.add(payment)
    db.flush()

    record_audit_log(
        db,
        actor_id=user.id,
        action="payment.confirmed" if is_confirmed else "payment.recorded",
        resource_type="payment",
        resource_id=payment.id,
        after_state={
            "payment_reference": payment.payment_reference,
            "status": payment.status,
            "amount": f"{payment.amount:.2f}",
            "payment_method": payment.payment_method,
        },
    )
    db.commit()
    loaded = _load_payment_or_404(db, payment.id)
    resp = ApiResponse(
        data=PaymentOut.model_validate(loaded),
        message="Payment recorded and confirmed" if is_confirmed else "Payment recorded in pending status",
    )
    idempotency_registry.store(str(user.id), "payment.create", idempotency_key, body_dict, resp.model_dump(mode="json"), 201)
    return resp


@router.get("/{payment_id}", response_model=ApiResponse[PaymentOut])
def get_payment(
    payment_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("payments:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[PaymentOut]:
    pay = _load_payment_or_404(db, payment_id)
    return ApiResponse(data=PaymentOut.model_validate(pay), message="Payment retrieved successfully")


@router.post("/{payment_id}/confirm", response_model=ApiResponse[PaymentOut])
def confirm_payment(
    payment_id: uuid.UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("payments:confirm")),
    db: Session = Depends(get_db),
) -> ApiResponse[PaymentOut]:
    cached = idempotency_registry.get_or_verify(str(user.id), f"payment.confirm:{payment_id}", idempotency_key, {})
    if cached:
        return ApiResponse.model_validate(cached)

    pay = _load_payment_or_404(db, payment_id, for_update=True)
    if pay.status == "confirmed":
        resp = ApiResponse(data=PaymentOut.model_validate(pay), message="Payment is already confirmed")
        idempotency_registry.store(str(user.id), f"payment.confirm:{payment_id}", idempotency_key, {}, resp.model_dump(mode="json"))
        return resp

    if pay.status != "pending":
        raise ConflictError(
            f"Cannot confirm payment from status '{pay.status}'",
            code="INVALID_PAYMENT_STATE_TRANSITION",
        )

    now = datetime.now(timezone.utc)
    pay.status = "confirmed"
    pay.confirmed_by = user.id
    pay.confirmed_at = now
    pay.updated_at = now

    record_audit_log(
        db,
        actor_id=user.id,
        action="payment.confirmed",
        resource_type="payment",
        resource_id=pay.id,
        before_state={"status": "pending"},
        after_state={"status": "confirmed", "amount": f"{pay.amount:.2f}"},
    )
    db.commit()
    db.refresh(pay)
    resp = ApiResponse(data=PaymentOut.model_validate(pay), message="Payment confirmed successfully")
    idempotency_registry.store(str(user.id), f"payment.confirm:{payment_id}", idempotency_key, {}, resp.model_dump(mode="json"))
    return resp


@router.post("/{payment_id}/fail", response_model=ApiResponse[PaymentOut])
def mark_payment_failed(
    payment_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("payments:confirm")),
    db: Session = Depends(get_db),
) -> ApiResponse[PaymentOut]:
    pay = _load_payment_or_404(db, payment_id, for_update=True)
    if pay.status != "pending":
        raise ConflictError(f"Only pending payments can be marked as failed (current: '{pay.status}')")

    pay.status = "failed"
    pay.updated_at = datetime.now(timezone.utc)
    record_audit_log(db, actor_id=user.id, action="payment.failed", resource_type="payment", resource_id=pay.id)
    db.commit()
    db.refresh(pay)
    return ApiResponse(data=PaymentOut.model_validate(pay), message="Payment marked as failed")


@router.post("/{payment_id}/allocate", response_model=ApiResponse[PaymentOut])
def allocate_payment(
    payment_id: uuid.UUID,
    payload: PaymentAllocateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("payments:allocate")),
    db: Session = Depends(get_db),
) -> ApiResponse[PaymentOut]:
    body_dict = payload.model_dump(mode="json")
    cached = idempotency_registry.get_or_verify(str(user.id), f"payment.allocate:{payment_id}", idempotency_key, body_dict)
    if cached:
        return ApiResponse.model_validate(cached)

    pay = _load_payment_or_404(db, payment_id, for_update=True)
    if pay.status not in ("confirmed", "partially_refunded"):
        raise ConflictError(
            f"Cannot allocate unconfirmed or reversed payment (current status: '{pay.status}')",
            code="UNCONFIRMED_PAYMENT_ALLOCATION",
        )

    requested_sum = Decimal("0.00")
    for item in payload.allocations:
        if item.amount <= Decimal("0.00"):
            raise BadRequestError("Allocation amount must be strictly positive")
        requested_sum = quantize_money(requested_sum + item.amount)

    if requested_sum > Decimal(pay.unallocated_amount):
        raise ConflictError(
            f"Requested allocation total ({requested_sum:.2f}) exceeds unallocated payment balance ({pay.unallocated_amount:.2f})",
            code="PAYMENT_OVER_ALLOCATION",
        )

    for item in payload.allocations:
        inv = db.execute(select(Invoice).where(Invoice.id == item.invoice_id).with_for_update()).scalar_one_or_none()
        if not inv:
            raise NotFoundError("Invoice", details={"invoice_id": str(item.invoice_id)})
        if inv.client_id != pay.client_id:
            raise ConflictError(
                "Payment and target invoice belong to different clients",
                code="CLIENT_MISMATCH",
            )
        if inv.status in ("draft", "cancelled", "void"):
            raise ConflictError(
                f"Cannot allocate payment to invoice in status '{inv.status}'",
                code="INVALID_INVOICE_STATUS_FOR_ALLOCATION",
            )
        if item.amount > Decimal(inv.balance_due):
            raise ConflictError(
                f"Allocation amount ({item.amount:.2f}) exceeds invoice outstanding balance ({inv.balance_due:.2f})",
                code="INVOICE_OVER_ALLOCATION",
            )

        alloc = PaymentAllocation(
            payment_id=pay.id,
            invoice_id=inv.id,
            amount=item.amount,
            status="active",
            notes=item.notes.strip(),
            allocated_by=user.id,
        )
        db.add(alloc)
        db.flush()

        record_audit_log(
            db,
            actor_id=user.id,
            action="payment.allocated",
            resource_type="payment_allocation",
            resource_id=alloc.id,
            after_state={
                "payment_id": str(pay.id),
                "invoice_id": str(inv.id),
                "amount": f"{item.amount:.2f}",
            },
        )

    db.commit()
    db.expire_all()
    loaded = _load_payment_or_404(db, payment_id)
    resp = ApiResponse(data=PaymentOut.model_validate(loaded), message="Payment allocated to invoice(s) successfully")
    idempotency_registry.store(str(user.id), f"payment.allocate:{payment_id}", idempotency_key, body_dict, resp.model_dump(mode="json"))
    return resp


@router.post("/{payment_id}/reverse", response_model=ApiResponse[PaymentOut])
def reverse_payment(
    payment_id: uuid.UUID,
    payload: PaymentReverseRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[PaymentOut]:
    """
    Controlled payment reversal (Sections 6.3 & 10.6):
    Preserves the original payment row, reverses active invoice allocations,
    cancels active receipt allocations (and marks linked finalized receipts as cancelled/refunded),
    and transitions the payment to `'reversed'`.
    """
    pay = _load_payment_or_404(db, payment_id, for_update=True)
    if pay.status == "reversed":
        return ApiResponse(data=PaymentOut.model_validate(pay), message="Payment is already reversed")
    if pay.status not in ("confirmed", "pending"):
        raise ConflictError(f"Cannot reverse payment from status '{pay.status}'", code="INVALID_REVERSAL_STATE")

    now = datetime.now(timezone.utc)
    reason = payload.reason.strip()

    # 1. Reverse any active invoice allocations (trigger automatically restores invoice.balance_due!)
    for alloc in pay.allocations:
        if alloc.status == "active":
            alloc.status = "reversed"
            alloc.reversed_by = admin.id
            alloc.reversed_at = now
            alloc.reversal_reason = reason
    db.flush()

    # 2. Cancel any active receipt allocations and mark linked finalized receipts cancelled
    pra_rows = list(
        db.execute(
            select(PaymentReceiptAllocation).where(
                PaymentReceiptAllocation.payment_id == pay.id,
                PaymentReceiptAllocation.status == "active",
            )
        ).scalars().all()
    )
    for pra in pra_rows:
        pra.status = "cancelled"
        rcp = db.get(Receipt, pra.receipt_id)
        if rcp and str(rcp.status) == "finalized":
            rcp.status = "cancelled"
            rcp.payment_status = "refunded"
            rcp.cancelled_by = admin.id
            rcp.cancelled_at = now
            rcp.cancel_reason = f"Reversed payment {pay.payment_reference}: {reason}"
    db.flush()

    db.refresh(pay)
    pay.status = "reversed"
    pay.notes = f"{pay.notes}\n[Reversed: {reason}]".strip()
    pay.updated_at = now

    record_audit_log(
        db,
        actor_id=admin.id,
        action="payment.reversed",
        resource_type="payment",
        resource_id=pay.id,
        after_state={"status": "reversed", "reason": reason, "preserved_amount": f"{pay.amount:.2f}"},
    )
    db.commit()
    db.expire_all()
    loaded = _load_payment_or_404(db, payment_id)
    return ApiResponse(data=PaymentOut.model_validate(loaded), message="Payment reversed while preserving historical audit trail")


@router.post("/{payment_id}/refund", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[PaymentOut])
def refund_payment(
    payment_id: uuid.UUID,
    payload: PaymentRefundRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("payments:refund")),
    db: Session = Depends(get_db),
) -> ApiResponse[PaymentOut]:
    body_dict = payload.model_dump(mode="json")
    cached = idempotency_registry.get_or_verify(str(user.id), f"payment.refund:{payment_id}", idempotency_key, body_dict)
    if cached:
        return ApiResponse.model_validate(cached)

    pay = _load_payment_or_404(db, payment_id, for_update=True)
    if pay.status not in ("confirmed", "partially_refunded"):
        raise ConflictError(f"Only confirmed payments can be refunded (current status: '{pay.status}')")

    if payload.amount <= Decimal("0.00"):
        raise BadRequestError("Refund amount must be strictly positive")

    refundable_net = quantize_money(Decimal(pay.amount) - Decimal(pay.amount_refunded))
    if payload.amount > refundable_net:
        raise ConflictError(
            f"Refund amount ({payload.amount:.2f}) exceeds remaining refundable payment amount ({refundable_net:.2f})",
            code="REFUND_EXCEEDS_PAYMENT",
        )

    now = datetime.now(timezone.utc)

    # If refund exceeds unallocated_amount and deallocate_invoices_if_needed is True, reverse allocations
    if payload.amount > Decimal(pay.unallocated_amount) and payload.deallocate_invoices_if_needed:
        for alloc in sorted(pay.allocations, key=lambda a: a.allocated_at, reverse=True):
            if alloc.status == "active":
                alloc.status = "reversed"
                alloc.reversed_by = user.id
                alloc.reversed_at = now
                alloc.reversal_reason = f"Reversed for refund: {payload.reason.strip()}"
        db.flush()

        # Also reduce/cancel active receipt coverage if net payment drops below receipted amount
        pra_rows = list(
            db.execute(
                select(PaymentReceiptAllocation).where(
                    PaymentReceiptAllocation.payment_id == pay.id,
                    PaymentReceiptAllocation.status == "active",
                )
            ).scalars().all()
        )
        for pra in pra_rows:
            pra.status = "cancelled"
            rcp = db.get(Receipt, pra.receipt_id)
            if rcp and str(rcp.status) == "finalized":
                rcp.payment_status = "refunded"
        db.flush()
        db.refresh(pay)

    ref_number = allocate_document_number(db, "refund", "REF", scope_year=now.year)
    refund = PaymentRefund(
        refund_reference=ref_number,
        payment_id=pay.id,
        amount=payload.amount,
        reason=payload.reason.strip(),
        status="completed",
        external_reference=payload.external_reference.strip() if payload.external_reference else None,
        processed_by=user.id,
        refunded_at=now,
    )
    db.add(refund)
    db.flush()

    record_audit_log(
        db,
        actor_id=user.id,
        action="payment.refunded",
        resource_type="payment_refund",
        resource_id=refund.id,
        after_state={
            "payment_id": str(pay.id),
            "refund_reference": ref_number,
            "refund_amount": f"{payload.amount:.2f}",
            "original_payment_amount": f"{pay.amount:.2f}",
        },
    )
    db.commit()
    db.expire_all()
    loaded = _load_payment_or_404(db, payment_id)
    resp = ApiResponse(
        data=PaymentOut.model_validate(loaded),
        message="Payment refund processed while preserving original payment history",
    )
    idempotency_registry.store(str(user.id), f"payment.refund:{payment_id}", idempotency_key, body_dict, resp.model_dump(mode="json"), 201)
    return resp
