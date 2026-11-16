"""
Transaction Reconciliation Module (Section 10.10).
Supports statement batch import, external transaction listing, matching suggestions,
manual match creation, match confirmation (preventing duplicate confirmed matches),
and match rejection. Never automatically converts uncertain imported records into confirmed payments.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from fastapi_service.core.exceptions import ConflictError, NotFoundError
from fastapi_service.core.pagination import (
    ApiResponse,
    MoneyDecimal,
    PaginatedResponse,
    PaginationParams,
    paginate_select,
)
from fastapi_service.core.permissions import AuthenticatedUser, require_permission
from fastapi_service.core.security import idempotency_registry, record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.invoicing import Invoice
from fastapi_service.models.payments import Payment
from fastapi_service.models.reconciliation import (
    ReconciliationBatch,
    ReconciliationMatch,
    ReconciliationRecord,
)
from fastapi_service.services.financial_service import allocate_document_number

router = APIRouter(prefix="/reconciliation", tags=["Reconciliation"])


class ReconciliationRecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    external_tx_id: str = Field(..., min_length=1, max_length=100)
    payment_method: str = Field(default="mpesa", max_length=30)
    transaction_date: datetime
    amount: MoneyDecimal
    currency: str = Field(default="KES", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    payer_name: str = Field(default="", max_length=200)
    payer_phone: str = Field(default="", max_length=50)
    description: str = Field(default="", max_length=500)


class ReconciliationBatchImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: Literal["mpesa_statement", "bank_statement", "card_settlement", "manual_import"]
    account_identifier: str = Field(default="", max_length=100)
    period_start: date | None = None
    period_end: date | None = None
    records: list[ReconciliationRecordInput] = Field(..., min_length=1, max_length=500)


class ReconciliationMatchCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reconciliation_record_id: uuid.UUID
    payment_id: uuid.UUID | None = None
    invoice_id: uuid.UUID | None = None
    matched_amount: MoneyDecimal
    confidence_score: Decimal = Field(default=Decimal("100.00"), ge=Decimal("0.00"), le=Decimal("100.00"))
    notes: str = Field(default="", max_length=500)
    confirm_immediately: bool = False


class ReconciliationMatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reconciliation_record_id: uuid.UUID
    payment_id: uuid.UUID | None
    invoice_id: uuid.UUID | None
    matched_amount: MoneyDecimal
    confidence_score: Decimal
    match_state: str
    notes: str
    matched_by: uuid.UUID | None
    matched_at: datetime


class ReconciliationRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_id: uuid.UUID
    external_tx_id: str
    payment_method: str
    transaction_date: datetime
    amount: MoneyDecimal
    currency: str
    payer_name: str
    payer_phone: str
    description: str
    match_status: str
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    created_at: datetime
    matches: list[ReconciliationMatchOut] = []


class ReconciliationBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_number: str
    source_type: str
    account_identifier: str
    period_start: date | None
    period_end: date | None
    status: str
    total_records: int
    matched_records: int
    unmatched_records: int
    imported_by: uuid.UUID
    created_at: datetime
    completed_at: datetime | None
    records: list[ReconciliationRecordOut] = []


def _recalculate_batch_counts(db: Session, batch: ReconciliationBatch) -> None:
    recs = list(db.execute(select(ReconciliationRecord).where(ReconciliationRecord.batch_id == batch.id)).scalars().all())
    total = len(recs)
    matched = sum(1 for r in recs if r.match_status == "matched")
    unmatched = total - matched
    batch.total_records = total
    batch.matched_records = matched
    batch.unmatched_records = unmatched
    if total > 0 and matched == total:
        batch.status = "completed"
        batch.completed_at = datetime.now(timezone.utc)
    elif matched > 0:
        batch.status = "in_review"


@router.get("/batches", response_model=PaginatedResponse[ReconciliationBatchOut])
def list_batches(
    pagination: PaginationParams = Depends(),
    status_filter: str | None = None,
    _user: AuthenticatedUser = Depends(require_permission("reconciliation:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[ReconciliationBatchOut]:
    stmt = select(ReconciliationBatch).options(
        selectinload(ReconciliationBatch.records).selectinload(ReconciliationRecord.matches)
    )
    if status_filter:
        stmt = stmt.where(ReconciliationBatch.status == status_filter)
    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={"created_at": ReconciliationBatch.created_at, "status": ReconciliationBatch.status},
    )
    return PaginatedResponse(
        data=[ReconciliationBatchOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Reconciliation batches retrieved successfully",
    )


@router.post("/batches", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ReconciliationBatchOut])
def import_reconciliation_batch(
    payload: ReconciliationBatchImportRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("reconciliation:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReconciliationBatchOut]:
    body_dict = payload.model_dump(mode="json")
    cached = idempotency_registry.get_or_verify(str(user.id), "reconciliation.import", idempotency_key, body_dict)
    if cached:
        return ApiResponse.model_validate(cached)

    now = datetime.now(timezone.utc)
    batch_num = allocate_document_number(db, "reconciliation", "RCN", scope_year=now.year)
    batch = ReconciliationBatch(
        batch_number=batch_num,
        source_type=payload.source_type,
        account_identifier=payload.account_identifier.strip(),
        period_start=payload.period_start,
        period_end=payload.period_end,
        status="open",
        total_records=len(payload.records),
        matched_records=0,
        unmatched_records=len(payload.records),
        imported_by=user.id,
    )
    db.add(batch)
    db.flush()

    for rec_in in payload.records:
        # Check for duplicate external transaction
        dup = db.execute(
            select(ReconciliationRecord).where(
                ReconciliationRecord.payment_method == rec_in.payment_method,
                ReconciliationRecord.external_tx_id == rec_in.external_tx_id.strip(),
            )
        ).scalar_one_or_none()
        if dup:
            raise ConflictError(
                f"External transaction '{rec_in.external_tx_id}' ({rec_in.payment_method}) has already been imported",
                code="DUPLICATE_EXTERNAL_TRANSACTION",
            )

        rec = ReconciliationRecord(
            batch_id=batch.id,
            external_tx_id=rec_in.external_tx_id.strip(),
            payment_method=rec_in.payment_method.strip(),
            transaction_date=rec_in.transaction_date,
            amount=rec_in.amount,
            currency=rec_in.currency,
            payer_name=rec_in.payer_name.strip(),
            payer_phone=rec_in.payer_phone.strip(),
            description=rec_in.description.strip(),
            match_status="unmatched",
        )
        db.add(rec)
        db.flush()

        # Check if an existing internal payment shares the exact external_reference & amount -> create a SUGGESTED match (never auto-confirm!)
        candidate_payment = db.execute(
            select(Payment).where(
                Payment.external_reference == rec.external_tx_id,
                Payment.amount == rec.amount,
            )
        ).scalar_one_or_none()
        if candidate_payment:
            rec.match_status = "suggested"
            db.add(
                ReconciliationMatch(
                    reconciliation_record_id=rec.id,
                    payment_id=candidate_payment.id,
                    matched_amount=rec.amount,
                    confidence_score=Decimal("95.00"),
                    match_state="suggested",
                    notes="Auto-suggested by exact external reference & amount match",
                )
            )

    db.flush()
    record_audit_log(
        db,
        actor_id=user.id,
        action="reconciliation.batch_imported",
        resource_type="reconciliation_batch",
        resource_id=batch.id,
        after_state={"batch_number": batch.batch_number, "total_records": batch.total_records},
    )
    db.commit()

    loaded = db.execute(
        select(ReconciliationBatch)
        .options(selectinload(ReconciliationBatch.records).selectinload(ReconciliationRecord.matches))
        .where(ReconciliationBatch.id == batch.id)
    ).scalar_one()
    resp = ApiResponse(data=ReconciliationBatchOut.model_validate(loaded), message="Reconciliation statement batch imported successfully")
    idempotency_registry.store(str(user.id), "reconciliation.import", idempotency_key, body_dict, resp.model_dump(mode="json"), 201)
    return resp


@router.post("/matches", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ReconciliationMatchOut])
def create_match(
    payload: ReconciliationMatchCreateRequest,
    user: AuthenticatedUser = Depends(require_permission("reconciliation:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReconciliationMatchOut]:
    rec = db.execute(
        select(ReconciliationRecord).where(ReconciliationRecord.id == payload.reconciliation_record_id).with_for_update()
    ).scalar_one_or_none()
    if not rec:
        raise NotFoundError("ReconciliationRecord", details={"reconciliation_record_id": str(payload.reconciliation_record_id)})

    if not payload.payment_id and not payload.invoice_id:
        raise ConflictError("A reconciliation match must reference a payment_id or invoice_id")

    if payload.payment_id and not db.get(Payment, payload.payment_id):
        raise NotFoundError("Payment", details={"payment_id": str(payload.payment_id)})
    if payload.invoice_id and not db.get(Invoice, payload.invoice_id):
        raise NotFoundError("Invoice", details={"invoice_id": str(payload.invoice_id)})

    existing_confirmed = db.execute(
        select(ReconciliationMatch).where(
            ReconciliationMatch.reconciliation_record_id == rec.id,
            ReconciliationMatch.match_state == "confirmed",
        )
    ).scalar_one_or_none()
    if existing_confirmed:
        raise ConflictError(
            "This external transaction record already has a confirmed match",
            code="ALREADY_RECONCILED",
        )

    is_confirmed = bool(payload.confirm_immediately and user.has_permission("reconciliation:confirm"))
    match = ReconciliationMatch(
        reconciliation_record_id=rec.id,
        payment_id=payload.payment_id,
        invoice_id=payload.invoice_id,
        matched_amount=payload.matched_amount,
        confidence_score=payload.confidence_score,
        match_state="confirmed" if is_confirmed else "suggested",
        notes=payload.notes.strip(),
        matched_by=user.id,
    )
    db.add(match)

    if is_confirmed:
        rec.match_status = "matched"
        rec.reviewed_by = user.id
        rec.reviewed_at = datetime.now(timezone.utc)
        batch = db.get(ReconciliationBatch, rec.batch_id)
        if batch:
            db.flush()
            _recalculate_batch_counts(db, batch)
    else:
        rec.match_status = "suggested"

    db.flush()
    record_audit_log(
        db,
        actor_id=user.id,
        action="reconciliation.match_confirmed" if is_confirmed else "reconciliation.match_suggested",
        resource_type="reconciliation_match",
        resource_id=match.id,
    )
    db.commit()
    db.refresh(match)
    return ApiResponse(data=ReconciliationMatchOut.model_validate(match), message="Reconciliation match recorded successfully")


@router.post("/matches/{match_id}/confirm", response_model=ApiResponse[ReconciliationMatchOut])
def confirm_match(
    match_id: uuid.UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: AuthenticatedUser = Depends(require_permission("reconciliation:confirm")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReconciliationMatchOut]:
    cached = idempotency_registry.get_or_verify(str(user.id), f"reconciliation.confirm:{match_id}", idempotency_key, {})
    if cached:
        return ApiResponse.model_validate(cached)

    match = db.execute(select(ReconciliationMatch).where(ReconciliationMatch.id == match_id).with_for_update()).scalar_one_or_none()
    if not match:
        raise NotFoundError("ReconciliationMatch", details={"match_id": str(match_id)})

    if match.match_state == "confirmed":
        resp = ApiResponse(data=ReconciliationMatchOut.model_validate(match), message="Match is already confirmed")
        idempotency_registry.store(str(user.id), f"reconciliation.confirm:{match_id}", idempotency_key, {}, resp.model_dump(mode="json"))
        return resp

    rec = db.execute(
        select(ReconciliationRecord).where(ReconciliationRecord.id == match.reconciliation_record_id).with_for_update()
    ).scalar_one()

    now = datetime.now(timezone.utc)
    match.match_state = "confirmed"
    match.matched_by = user.id
    match.matched_at = now
    rec.match_status = "matched"
    rec.reviewed_by = user.id
    rec.reviewed_at = now
    db.flush()

    batch = db.get(ReconciliationBatch, rec.batch_id)
    if batch:
        _recalculate_batch_counts(db, batch)

    record_audit_log(
        db,
        actor_id=user.id,
        action="reconciliation.match_confirmed",
        resource_type="reconciliation_match",
        resource_id=match.id,
    )
    db.commit()
    db.refresh(match)
    resp = ApiResponse(data=ReconciliationMatchOut.model_validate(match), message="Reconciliation match confirmed")
    idempotency_registry.store(str(user.id), f"reconciliation.confirm:{match_id}", idempotency_key, {}, resp.model_dump(mode="json"))
    return resp


@router.post("/matches/{match_id}/reject", response_model=ApiResponse[ReconciliationMatchOut])
def reject_match(
    match_id: uuid.UUID,
    user: AuthenticatedUser = Depends(require_permission("reconciliation:confirm")),
    db: Session = Depends(get_db),
) -> ApiResponse[ReconciliationMatchOut]:
    match = db.execute(select(ReconciliationMatch).where(ReconciliationMatch.id == match_id).with_for_update()).scalar_one_or_none()
    if not match:
        raise NotFoundError("ReconciliationMatch", details={"match_id": str(match_id)})

    match.match_state = "rejected"
    rec = db.get(ReconciliationRecord, match.reconciliation_record_id)
    if rec:
        rec.match_status = "rejected"
        rec.reviewed_by = user.id
        rec.reviewed_at = datetime.now(timezone.utc)
        batch = db.get(ReconciliationBatch, rec.batch_id)
        if batch:
            db.flush()
            _recalculate_batch_counts(db, batch)

    record_audit_log(db, actor_id=user.id, action="reconciliation.match_rejected", resource_type="reconciliation_match", resource_id=match.id)
    db.commit()
    db.refresh(match)
    return ApiResponse(data=ReconciliationMatchOut.model_validate(match), message="Reconciliation match rejected")
