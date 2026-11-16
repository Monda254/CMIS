"""
Communications (Email & SMS Templates and Delivery Logs) Module (Section 10.9).
Honors Rule 18 & Section 10.9: queues outbound notifications and logs provider states
(`queued`, `sent`, `delivered`, `failed`, `bounced`) without falsely claiming delivery on API acceptance.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import ConflictError
from fastapi_service.core.pagination import (
    ApiResponse,
    EmailAddress,
    PaginatedResponse,
    PaginationParams,
    paginate_select,
)
from fastapi_service.core.permissions import AuthenticatedUser, require_permission
from fastapi_service.core.security import record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.communications import (
    EmailLog,
    NotificationTemplate,
    SmsLog,
)

router = APIRouter(prefix="/communications", tags=["Communications"])


class NotificationTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., min_length=2, max_length=50, pattern=r"^[a-z0-9_:-]+$")
    channel: Literal["email", "sms"]
    name: str = Field(..., min_length=2, max_length=100)
    subject_template: str = Field(default="", max_length=250)
    body_template: str = Field(..., min_length=1, max_length=4000)


class NotificationTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    channel: str
    name: str
    subject_template: str
    body_template: str
    active: bool
    created_at: datetime


class SendEmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: uuid.UUID | None = None
    template_id: uuid.UUID | None = None
    recipient: EmailAddress
    subject: str = Field(..., min_length=1, max_length=250)
    message_type: Literal["quotation", "invoice", "receipt", "payment_confirmation", "payment_reminder", "general"] = "general"
    related_document_type: str | None = Field(default=None, max_length=30)
    related_document_id: uuid.UUID | None = None
    body: str = Field(..., min_length=1, max_length=10000)


class SendSmsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: uuid.UUID | None = None
    template_id: uuid.UUID | None = None
    recipient: str = Field(..., min_length=7, max_length=50)
    message_type: Literal["quotation", "invoice", "receipt", "payment_confirmation", "payment_reminder", "general"] = "general"
    related_document_type: str | None = Field(default=None, max_length=30)
    related_document_id: uuid.UUID | None = None
    body: str = Field(..., min_length=1, max_length=1000)


class EmailLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID | None
    template_id: uuid.UUID | None
    recipient: str
    subject: str
    message_type: str
    related_document_type: str | None
    related_document_id: uuid.UUID | None
    provider: str
    provider_message_id: str | None
    status: str
    attempt_count: int
    sent_at: datetime | None
    delivered_at: datetime | None
    failure_reason: str | None
    created_at: datetime


class SmsLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID | None
    template_id: uuid.UUID | None
    recipient: str
    message_type: str
    related_document_type: str | None
    related_document_id: uuid.UUID | None
    provider: str
    provider_message_id: str | None
    status: str
    attempt_count: int
    sent_at: datetime | None
    delivered_at: datetime | None
    failure_reason: str | None
    created_at: datetime


@router.get("/templates", response_model=ApiResponse[list[NotificationTemplateOut]])
def list_templates(
    channel: str | None = None,
    _user: AuthenticatedUser = Depends(require_permission("communications:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[list[NotificationTemplateOut]]:
    stmt = select(NotificationTemplate).where(NotificationTemplate.active.is_(True))
    if channel:
        stmt = stmt.where(NotificationTemplate.channel == channel)
    rows = list(db.execute(stmt.order_by(NotificationTemplate.code.asc())).scalars().all())
    return ApiResponse(
        data=[NotificationTemplateOut.model_validate(r) for r in rows],
        message="Notification templates retrieved successfully",
    )


@router.post("/templates", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[NotificationTemplateOut])
def create_template(
    payload: NotificationTemplateCreate,
    user: AuthenticatedUser = Depends(require_permission("communications:send")),
    db: Session = Depends(get_db),
) -> ApiResponse[NotificationTemplateOut]:
    existing = db.execute(select(NotificationTemplate).where(NotificationTemplate.code == payload.code)).scalar_one_or_none()
    if existing:
        raise ConflictError(f"Notification template '{payload.code}' already exists", code="DUPLICATE_TEMPLATE")

    tpl = NotificationTemplate(
        code=payload.code,
        channel=payload.channel,
        name=payload.name.strip(),
        subject_template=payload.subject_template.strip(),
        body_template=payload.body_template.strip(),
    )
    db.add(tpl)
    db.flush()
    record_audit_log(db, actor_id=user.id, action="notification_template.created", resource_type="notification_template", resource_id=tpl.id)
    db.commit()
    db.refresh(tpl)
    return ApiResponse(data=NotificationTemplateOut.model_validate(tpl), message="Notification template created successfully")


@router.post("/email", status_code=status.HTTP_202_ACCEPTED, response_model=ApiResponse[EmailLogOut])
def queue_email_notification(
    payload: SendEmailRequest,
    user: AuthenticatedUser = Depends(require_permission("communications:send")),
    db: Session = Depends(get_db),
) -> ApiResponse[EmailLogOut]:
    log_row = EmailLog(
        client_id=payload.client_id,
        template_id=payload.template_id,
        recipient=payload.recipient.strip().lower(),
        subject=payload.subject.strip(),
        message_type=payload.message_type,
        related_document_type=payload.related_document_type,
        related_document_id=payload.related_document_id,
        provider="smtp_Configurable",
        status="queued",
        attempt_count=0,
        metadata_json={"body_length": len(payload.body)},
        triggered_by=user.id,
    )
    db.add(log_row)
    db.flush()
    record_audit_log(
        db,
        actor_id=user.id,
        action="communication.email_queued",
        resource_type="email_log",
        resource_id=log_row.id,
        after_state={"recipient": log_row.recipient, "status": "queued", "message_type": log_row.message_type},
    )
    db.commit()
    db.refresh(log_row)
    return ApiResponse(
        data=EmailLogOut.model_validate(log_row),
        message="Email notification queued for dispatch (delivery pending provider confirmation)",
    )


@router.post("/sms", status_code=status.HTTP_202_ACCEPTED, response_model=ApiResponse[SmsLogOut])
def queue_sms_notification(
    payload: SendSmsRequest,
    user: AuthenticatedUser = Depends(require_permission("communications:send")),
    db: Session = Depends(get_db),
) -> ApiResponse[SmsLogOut]:
    log_row = SmsLog(
        client_id=payload.client_id,
        template_id=payload.template_id,
        recipient=payload.recipient.strip(),
        message_type=payload.message_type,
        related_document_type=payload.related_document_type,
        related_document_id=payload.related_document_id,
        provider="sms_configurable",
        status="queued",
        attempt_count=0,
        metadata_json={"body_length": len(payload.body)},
        triggered_by=user.id,
    )
    db.add(log_row)
    db.flush()
    record_audit_log(
        db,
        actor_id=user.id,
        action="communication.sms_queued",
        resource_type="sms_log",
        resource_id=log_row.id,
        after_state={"recipient": log_row.recipient, "status": "queued", "message_type": log_row.message_type},
    )
    db.commit()
    db.refresh(log_row)
    return ApiResponse(
        data=SmsLogOut.model_validate(log_row),
        message="SMS notification queued for dispatch (delivery pending provider confirmation)",
    )


@router.get("/email-logs", response_model=PaginatedResponse[EmailLogOut])
def list_email_logs(
    pagination: PaginationParams = Depends(),
    client_id: uuid.UUID | None = None,
    status_filter: str | None = None,
    _user: AuthenticatedUser = Depends(require_permission("communications:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[EmailLogOut]:
    stmt = select(EmailLog)
    if client_id:
        stmt = stmt.where(EmailLog.client_id == client_id)
    if status_filter:
        stmt = stmt.where(EmailLog.status == status_filter)
    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={"created_at": EmailLog.created_at, "status": EmailLog.status},
    )
    return PaginatedResponse(
        data=[EmailLogOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Email delivery logs retrieved successfully",
    )


@router.get("/sms-logs", response_model=PaginatedResponse[SmsLogOut])
def list_sms_logs(
    pagination: PaginationParams = Depends(),
    client_id: uuid.UUID | None = None,
    status_filter: str | None = None,
    _user: AuthenticatedUser = Depends(require_permission("communications:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[SmsLogOut]:
    stmt = select(SmsLog)
    if client_id:
        stmt = stmt.where(SmsLog.client_id == client_id)
    if status_filter:
        stmt = stmt.where(SmsLog.status == status_filter)
    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={"created_at": SmsLog.created_at, "status": SmsLog.status},
    )
    return PaginatedResponse(
        data=[SmsLogOut.model_validate(r) for r in rows],
        pagination=meta,
        message="SMS delivery logs retrieved successfully",
    )
