"""
Security & Financial Audit Log Inspection Module (Section 15).
Read-only access restricted to users with `audit:read` / administrator privileges.
Audit records cannot be modified or deleted through any API endpoint.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi_service.core.pagination import (
    PaginatedResponse,
    PaginationParams,
    paginate_select,
)
from fastapi_service.core.permissions import AuthenticatedUser, require_permission
from fastapi_service.database import get_db
from fastapi_service.models.identity import AuditLog

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: uuid.UUID | None
    action: str
    resource_type: str | None
    resource_id: str | None
    outcome: str
    before_state: dict[str, Any] | None
    after_state: dict[str, Any] | None
    metadata_json: dict[str, Any]
    created_at: datetime


@router.get("/logs", response_model=PaginatedResponse[AuditLogOut])
def list_audit_logs(
    pagination: PaginationParams = Depends(),
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    actor_id: uuid.UUID | None = None,
    outcome: str | None = None,
    _user: AuthenticatedUser = Depends(require_permission("audit:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[AuditLogOut]:
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AuditLog.resource_id == resource_id)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if outcome:
        stmt = stmt.where(AuditLog.outcome == outcome)

    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={
            "created_at": AuditLog.created_at,
            "id": AuditLog.id,
            "action": AuditLog.action,
        },
    )
    return PaginatedResponse(
        data=[AuditLogOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Audit logs retrieved successfully",
    )
