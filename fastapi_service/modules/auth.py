"""
Authentication & Session Management Module (Section 6 & 10.1).
Endpoints:
- POST /api/v1/auth/login
- POST /api/v1/auth/logout
- GET  /api/v1/auth/me
- POST /api/v1/auth/forgot-password
- POST /api/v1/auth/reset-password
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from fastapi_service.core.config import settings
from fastapi_service.core.exceptions import (
    AuthenticationError,
    AuthorizationError,
    BadRequestError,
)
from fastapi_service.core.pagination import ApiResponse, EmailAddress
from fastapi_service.core.permissions import (
    AuthenticatedUser,
    _extract_raw_token,
    _load_user_roles_and_permissions,
    get_current_user,
)
from fastapi_service.core.security import (
    check_db_auth_rate_limit,
    extract_client_ip,
    generate_session_token,
    hash_password,
    rate_limiter,
    record_audit_log,
    sha256_hex,
    verify_password,
)
from fastapi_service.database import get_db
from fastapi_service.models.identity import SessionRecord, User

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailAddress
    password: str = Field(..., min_length=1, max_length=200)


class CurrentUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    active: bool
    roles: list[str]
    permissions: list[str]


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: CurrentUserResponse


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailAddress


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(..., min_length=16, max_length=256)
    new_password: str = Field(..., min_length=8, max_length=128)


@router.post("/login", response_model=ApiResponse[LoginResponse])
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> ApiResponse[LoginResponse]:
    client_ip = extract_client_ip(request)
    ip_hash = sha256_hex(f"ip:{client_ip}")
    rate_limiter.check_and_record(f"login:{client_ip}", max_attempts=20, window_seconds=300)
    check_db_auth_rate_limit(db, action="auth.login_failed", ip_hash=ip_hash, max_attempts=15, window_minutes=5)

    normalized_email = payload.email.strip().lower()
    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        record_audit_log(
            db,
            actor_id=user.id if user else None,
            action="auth.login_failed",
            resource_type="user",
            resource_id=user.id if user else normalized_email,
            outcome="failure",
            metadata={"ip_hash": sha256_hex(f"ip:{client_ip}")},
        )
        db.commit()
        raise AuthenticationError("Invalid email or password")

    if not user.active:
        record_audit_log(
            db,
            actor_id=user.id,
            action="auth.login_denied_inactive",
            resource_type="user",
            resource_id=user.id,
            outcome="denied",
        )
        db.commit()
        raise AuthorizationError("Your account is deactivated or awaiting administrator approval")

    raw_token, session_id = generate_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.session_ttl_days)

    session_rec = SessionRecord(
        id=session_id,
        user_id=user.id,
        expires_at=expires_at,
        ip_hash=sha256_hex(f"ip:{client_ip}"),
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
    )
    db.add(session_rec)

    roles, perms = _load_user_roles_and_permissions(db, user)
    record_audit_log(
        db,
        actor_id=user.id,
        action="auth.login_succeeded",
        resource_type="session",
        resource_id=session_id[:16],
        outcome="success",
    )
    db.commit()

    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        httponly=True,
        samesite="lax",
        secure=settings.environment == "production",
        expires=int(expires_at.timestamp()),
        path="/",
    )

    return ApiResponse(
        data=LoginResponse(
            access_token=raw_token,
            expires_at=expires_at,
            user=CurrentUserResponse(
                id=user.id,
                email=user.email,
                full_name=user.full_name or user.email,
                role=str(user.role),
                active=bool(user.active),
                roles=sorted(roles),
                permissions=sorted(perms),
            ),
        ),
        message="Signed in successfully",
    )


@router.post("/logout", response_model=ApiResponse[dict[str, bool]])
def logout(
    request: Request,
    response: Response,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, bool]]:
    raw_token = _extract_raw_token(request)
    if raw_token:
        sid = sha256_hex(raw_token)
        db.execute(delete(SessionRecord).where(SessionRecord.id == sid))
    elif user.session_id:
        db.execute(delete(SessionRecord).where(SessionRecord.id == user.session_id))

    record_audit_log(
        db,
        actor_id=user.id,
        action="auth.logout",
        resource_type="user",
        resource_id=user.id,
        outcome="success",
    )
    db.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")
    return ApiResponse(data={"logged_out": True}, message="Signed out successfully")


@router.get("/me", response_model=ApiResponse[CurrentUserResponse])
def get_me(
    user: AuthenticatedUser = Depends(get_current_user),
) -> ApiResponse[CurrentUserResponse]:
    return ApiResponse(
        data=CurrentUserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            active=user.active,
            roles=sorted(user.roles),
            permissions=sorted(user.permissions),
        ),
        message="Current user retrieved successfully",
    )


@router.post("/forgot-password", response_model=ApiResponse[dict[str, str]])
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, str]]:
    client_ip = extract_client_ip(request)
    rate_limiter.check_and_record(f"forgot_pw:{client_ip}", max_attempts=10, window_seconds=600)

    normalized_email = payload.email.strip().lower()
    user = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if user and user.active:
        raw_reset_token = secrets.token_urlsafe(32)
        user.reset_token_hash = sha256_hex(raw_reset_token)
        user.reset_token_expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
        record_audit_log(
            db,
            actor_id=user.id,
            action="auth.password_reset_requested",
            resource_type="user",
            resource_id=user.id,
        )
        db.commit()

    # Always return a uniform response to prevent account enumeration
    return ApiResponse(
        data={"status": "accepted"},
        message="If an active account matches that email, password reset instructions have been issued",
    )


@router.post("/reset-password", response_model=ApiResponse[dict[str, bool]])
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, bool]]:
    token_hash = sha256_hex(payload.token.strip())
    now = datetime.now(timezone.utc)
    user = db.execute(
        select(User).where(
            User.reset_token_hash == token_hash,
            User.reset_token_expires_at.is_not(None),
            User.reset_token_expires_at > now,
        )
    ).scalar_one_or_none()

    if not user:
        raise BadRequestError("Invalid or expired password reset token", code="INVALID_RESET_TOKEN")

    user.password_hash = hash_password(payload.new_password)
    user.reset_token_hash = None
    user.reset_token_expires_at = None

    # Invalidate all existing sessions on password reset
    db.execute(delete(SessionRecord).where(SessionRecord.user_id == user.id))

    record_audit_log(
        db,
        actor_id=user.id,
        action="auth.password_reset_completed",
        resource_type="user",
        resource_id=user.id,
    )
    db.commit()
    return ApiResponse(data={"reset": True}, message="Password has been reset successfully")
