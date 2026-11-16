"""
Authentication & Role-Based / Permission-Based Access Control (RBAC) Dependencies (Section 6).
Integrates directly with MP-14's `users`, `roles`, `permissions`, `user_roles`,
`role_permissions`, and `sessions` tables.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi_service.core.config import settings
from fastapi_service.core.exceptions import AuthenticationError, AuthorizationError
from fastapi_service.core.security import sha256_hex
from fastapi_service.database import get_db
from fastapi_service.models.identity import (
    Permission,
    Role,
    RolePermission,
    SessionRecord,
    User,
    UserRole,
)

# Default capability matrix mapped to built-in roles, augmented dynamically by DB `role_permissions`
BUILTIN_ROLE_PERMISSIONS: dict[str, set[str]] = {
    "admin": {"*"},
    "cashier": {
        "clients:read",
        "clients:write",
        "quotations:read",
        "quotations:write",
        "quotations:issue",
        "invoices:read",
        "invoices:write",
        "invoices:issue",
        "payments:read",
        "payments:write",
        "payments:confirm",
        "payments:allocate",
        "receipts:read",
        "receipts:write",
        "receipts:finalize",
        "receipts:print",
        "communications:read",
        "communications:send",
        "taxes:read",
        "company:read",
        "dashboard:read",
    },
    "accountant": {
        "clients:read",
        "clients:write",
        "quotations:read",
        "quotations:write",
        "quotations:issue",
        "invoices:read",
        "invoices:write",
        "invoices:issue",
        "payments:read",
        "payments:write",
        "payments:confirm",
        "payments:allocate",
        "payments:refund",
        "receipts:read",
        "receipts:write",
        "receipts:finalize",
        "receipts:print",
        "reconciliation:read",
        "reconciliation:write",
        "reconciliation:confirm",
        "reports:read",
        "taxes:read",
        "company:read",
        "dashboard:read",
    },
    "auditor": {
        "clients:read",
        "quotations:read",
        "invoices:read",
        "payments:read",
        "receipts:read",
        "reconciliation:read",
        "reports:read",
        "audit:read",
        "taxes:read",
        "company:read",
        "dashboard:read",
    },
}


@dataclass
class AuthenticatedUser:
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    active: bool
    roles: set[str] = field(default_factory=set)
    permissions: set[str] = field(default_factory=set)
    session_id: str | None = None

    def has_permission(self, permission_code: str) -> bool:
        if not self.active:
            return False
        if "*" in self.permissions or self.role == "admin" or "admin" in self.roles:
            return True
        return permission_code in self.permissions


def _load_user_roles_and_permissions(db: Session, user: User) -> tuple[set[str], set[str]]:
    roles: set[str] = {str(user.role)}
    perms: set[str] = set(BUILTIN_ROLE_PERMISSIONS.get(str(user.role), set()))

    stmt = (
        select(Role.code, Permission.code)
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .outerjoin(RolePermission, RolePermission.role_id == Role.id)
        .outerjoin(Permission, Permission.id == RolePermission.permission_id)
        .where(UserRole.user_id == user.id)
    )
    for role_code, perm_code in db.execute(stmt).all():
        if role_code:
            roles.add(role_code)
            perms.update(BUILTIN_ROLE_PERMISSIONS.get(role_code, set()))
        if perm_code:
            perms.add(perm_code)

    return roles, perms


def _extract_raw_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if token:
            return token
    cookie_token = request.cookies.get(settings.session_cookie_name)
    if cookie_token:
        return cookie_token.strip()
    header_token = request.headers.get("x-session-token")
    if header_token:
        return header_token.strip()
    return None


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    """
    Resolves and validates the authenticated user from:
    1. Bearer / Cookie session token (`public.sessions` joined with `public.users`), or
    2. Trusted internal Next.js proxy headers (`x-internal-secret` + `x-user-id`).
    """
    raw_token = _extract_raw_token(request)
    if raw_token:
        session_id = sha256_hex(raw_token)
        now = datetime.now(timezone.utc)
        row = db.execute(
            select(SessionRecord, User)
            .join(User, User.id == SessionRecord.user_id)
            .where(SessionRecord.id == session_id, SessionRecord.expires_at > now)
        ).first()
        if not row:
            raise AuthenticationError("Invalid or expired authentication session")
        session_rec, user = row
        if not user.active:
            raise AuthorizationError("User account is deactivated or awaiting administrator approval")

        roles, perms = _load_user_roles_and_permissions(db, user)
        request.state.user_id = str(user.id)
        return AuthenticatedUser(
            id=user.id,
            email=user.email,
            full_name=user.full_name or user.email,
            role=str(user.role),
            active=bool(user.active),
            roles=roles,
            permissions=perms,
            session_id=session_rec.id,
        )

    # Fallback: trusted Next.js server-to-server internal secret + user context headers
    internal_secret = request.headers.get("x-internal-secret")
    if internal_secret and internal_secret == settings.internal_secret:
        raw_user_id = request.headers.get("x-user-id")
        if raw_user_id:
            try:
                uid = uuid.UUID(raw_user_id)
            except ValueError as exc:
                raise AuthenticationError("Malformed x-user-id header") from exc
            user = db.get(User, uid)
            if not user:
                raise AuthenticationError("Authenticated user record does not exist")
            if not user.active:
                raise AuthorizationError("User account is deactivated")
            roles, perms = _load_user_roles_and_permissions(db, user)
            request.state.user_id = str(user.id)
            return AuthenticatedUser(
                id=user.id,
                email=user.email,
                full_name=user.full_name or user.email,
                role=str(user.role),
                active=bool(user.active),
                roles=roles,
                permissions=perms,
                session_id=None,
            )

    raise AuthenticationError("Authentication credentials were not provided")


def require_active_user(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    if not user.active:
        raise AuthorizationError("Active staff account required")
    return user


def require_admin(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    if not user.active:
        raise AuthorizationError("Active staff account required")
    if user.role != "admin" and "admin" not in user.roles:
        raise AuthorizationError("Administrator privileges are required for this operation")
    return user


def require_permission(permission_code: str) -> Callable[[AuthenticatedUser], AuthenticatedUser]:
    def dependency(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if not user.has_permission(permission_code):
            raise AuthorizationError(
                f"Missing required permission: '{permission_code}'",
                details={"required_permission": permission_code},
            )
        return user

    return dependency
