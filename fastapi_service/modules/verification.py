"""
Public Receipt Verification Module (Section 10.8).
Dedicated public endpoints:
- GET  /api/v1/verification/{verification_code}
- POST /api/v1/verification

Security guarantees:
- Hashes caller IP with SHA-256 (`verify_attempts`).
- Enforces DB-backed rate limits (30/hr per visitor IP hash, 10/10min per identifier).
- Masks customer names (`J*** D**`).
- Never exposes internal client notes, phone numbers, physical addresses, staff IDs, or private records.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import RateLimitError
from fastapi_service.core.pagination import ApiResponse
from fastapi_service.core.security import extract_client_ip, sha256_hex
from fastapi_service.database import get_db
from fastapi_service.models.receipts import Receipt, VerifyAttempt

router = APIRouter(prefix="/verification", tags=["Public Verification"])

VALID_IDENTIFIER_RE = re.compile(r"^[A-Z0-9-]+$")


class PublicVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    identifier: str = Field(..., min_length=1, max_length=64)


class PublicVerificationOut(BaseModel):
    result: str
    receipt_number: str | None = None
    code_hint: str | None = None
    customer: str | None = None
    issued_at: str | None = None
    total: str | None = None
    amount_paid: str | None = None
    balance_due: str | None = None
    payment_status: str | None = None
    payment_method: str | None = None
    currency: str | None = None
    company: str | None = None
    cancelled_at: str | None = None
    cancel_reason: str | None = None


def _mask_customer_name(full_name: str) -> str:
    words = full_name.strip().split()
    masked = []
    for w in words:
        if len(w) <= 1:
            masked.append(w)
        else:
            masked.append(w[0] + "*" * (len(w) - 1))
    return " ".join(masked)


def verify_receipt_public(
    db: Session,
    raw_identifier: str,
    client_ip: str,
) -> PublicVerificationOut:
    idf = (raw_identifier or "").strip().upper()
    if len(idf) < 6 or len(idf) > 40 or not VALID_IDENTIFIER_RE.match(idf):
        return PublicVerificationOut(result="invalid")

    client_key = sha256_hex(f"verify:{client_ip}")
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)
    ten_min_ago = now - timedelta(minutes=10)

    visitor_count = int(
        db.execute(
            select(func.count())
            .select_from(VerifyAttempt)
            .where(VerifyAttempt.client_key == client_key, VerifyAttempt.created_at >= one_hour_ago)
        ).scalar_one()
        or 0
    )
    if visitor_count >= 30:
        raise RateLimitError("Too many verification attempts from this IP address (limit: 30 per hour)")

    id_count = int(
        db.execute(
            select(func.count())
            .select_from(VerifyAttempt)
            .where(VerifyAttempt.identifier == idf, VerifyAttempt.created_at >= ten_min_ago)
        ).scalar_one()
        or 0
    )
    if id_count >= 10:
        raise RateLimitError("Too many verification attempts for this code (limit: 10 per 10 minutes)")

    r = db.execute(
        select(Receipt).where(
            or_(Receipt.verification_code == idf, Receipt.receipt_number == idf)
        )
    ).scalar_one_or_none()

    if not r or str(r.status) == "draft":
        out = PublicVerificationOut(result="not_found")
    else:
        code = r.verification_code or ""
        code_hint = f"{code[:3]}****{code[-3:]}" if len(code) >= 6 else code
        snap: dict[str, Any] = r.company_snapshot or {}
        out = PublicVerificationOut(
            result="cancelled" if str(r.status) == "cancelled" else "valid",
            receipt_number=r.receipt_number,
            code_hint=code_hint,
            customer=_mask_customer_name(r.customer_name),
            issued_at=r.finalized_at.isoformat() if r.finalized_at else None,
            total=f"{Decimal(r.total):.2f}",
            amount_paid=f"{Decimal(r.amount_paid):.2f}",
            balance_due=f"{Decimal(r.balance_due):.2f}",
            payment_status=r.payment_status,
            payment_method=r.payment_method,
            currency=r.currency,
            company=str(snap.get("name") or ""),
            cancelled_at=r.cancelled_at.isoformat() if r.cancelled_at else None,
            cancel_reason=r.cancel_reason,
        )

    db.add(
        VerifyAttempt(
            client_key=client_key,
            identifier=idf,
            result=out.result,
        )
    )
    db.commit()
    return out


@router.get("/{verification_code}", response_model=ApiResponse[PublicVerificationOut])
def get_public_verification(
    verification_code: str,
    request: Request,
    db: Session = Depends(get_db),
) -> ApiResponse[PublicVerificationOut]:
    client_ip = extract_client_ip(request)
    res = verify_receipt_public(db, verification_code, client_ip)
    return ApiResponse(data=res, message="Verification check completed")


@router.post("", response_model=ApiResponse[PublicVerificationOut])
def post_public_verification(
    payload: PublicVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ApiResponse[PublicVerificationOut]:
    client_ip = extract_client_ip(request)
    res = verify_receipt_public(db, payload.identifier, client_ip)
    return ApiResponse(data=res, message="Verification check completed")
