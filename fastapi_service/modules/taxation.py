"""
Tax Configuration Module (Section 10.11).
Supports configurable tax codes, rates, effective dates, inclusion rules,
and applicable document types without hardcoding VAT assumptions.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import ConflictError, NotFoundError
from fastapi_service.core.pagination import ApiResponse, TaxRateDecimal
from fastapi_service.core.permissions import (
    AuthenticatedUser,
    require_admin,
    require_permission,
)
from fastapi_service.core.security import record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.settings import TaxConfiguration

router = APIRouter(prefix="/taxes", tags=["Tax Configuration"])


class TaxConfigCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., min_length=2, max_length=30, pattern=r"^[A-Z0-9_-]+$")
    name: str = Field(..., min_length=2, max_length=100)
    rate: TaxRateDecimal
    tax_type: Literal["vat", "withholding", "excise", "levy", "exempt"] = "vat"
    is_inclusive: bool = False
    applicable_to: Literal["all", "quote", "invoice", "receipt"] = "all"
    effective_from: date | None = None
    effective_to: date | None = None
    active: bool = True


class TaxConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=2, max_length=100)
    effective_to: date | None = None
    active: bool | None = None


class TaxConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    rate: TaxRateDecimal
    tax_type: str
    is_inclusive: bool
    applicable_to: str
    effective_from: date
    effective_to: date | None
    active: bool
    created_at: datetime
    updated_at: datetime


@router.get("", response_model=ApiResponse[list[TaxConfigOut]])
def list_taxes(
    active_only: bool = False,
    _user: AuthenticatedUser = Depends(require_permission("taxes:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[list[TaxConfigOut]]:
    stmt = select(TaxConfiguration)
    if active_only:
        stmt = stmt.where(TaxConfiguration.active.is_(True))
    rows = list(db.execute(stmt.order_by(TaxConfiguration.code.asc())).scalars().all())
    return ApiResponse(
        data=[TaxConfigOut.model_validate(r) for r in rows],
        message="Tax configurations retrieved successfully",
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[TaxConfigOut])
def create_tax_configuration(
    payload: TaxConfigCreateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[TaxConfigOut]:
    existing = db.execute(select(TaxConfiguration).where(TaxConfiguration.code == payload.code)).scalar_one_or_none()
    if existing:
        raise ConflictError(f"Tax configuration code '{payload.code}' already exists", code="DUPLICATE_TAX_CODE")

    tax = TaxConfiguration(
        code=payload.code,
        name=payload.name.strip(),
        rate=payload.rate,
        tax_type=payload.tax_type,
        is_inclusive=payload.is_inclusive,
        applicable_to=payload.applicable_to,
        effective_from=payload.effective_from or date.today(),
        effective_to=payload.effective_to,
        active=payload.active,
        created_by=admin.id,
    )
    db.add(tax)
    db.flush()
    record_audit_log(
        db,
        actor_id=admin.id,
        action="tax_configuration.created",
        resource_type="tax_configuration",
        resource_id=tax.id,
        after_state={"code": tax.code, "rate": f"{Decimal(tax.rate):.4f}"},
    )
    db.commit()
    db.refresh(tax)
    return ApiResponse(data=TaxConfigOut.model_validate(tax), message="Tax configuration created successfully")


@router.patch("/{tax_id}", response_model=ApiResponse[TaxConfigOut])
def update_tax_configuration(
    tax_id: uuid.UUID,
    payload: TaxConfigUpdateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[TaxConfigOut]:
    tax = db.get(TaxConfiguration, tax_id)
    if not tax:
        raise NotFoundError("TaxConfiguration", details={"tax_id": str(tax_id)})

    if payload.name is not None:
        tax.name = payload.name.strip()
    if payload.effective_to is not None:
        tax.effective_to = payload.effective_to
    if payload.active is not None:
        tax.active = payload.active

    record_audit_log(db, actor_id=admin.id, action="tax_configuration.updated", resource_type="tax_configuration", resource_id=tax.id)
    db.commit()
    db.refresh(tax)
    return ApiResponse(data=TaxConfigOut.model_validate(tax), message="Tax configuration updated successfully")
