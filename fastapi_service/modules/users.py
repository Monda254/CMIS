"""
Users, Roles & Permissions Management Module (Section 10.1).
Strictly protected by administrator authorization (`require_admin`).
Never exposes password hashes or session secrets.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import BadRequestError, ConflictError, NotFoundError
from fastapi_service.core.pagination import (
    ApiResponse,
    EmailAddress,
    PaginatedResponse,
    PaginationParams,
    paginate_select,
)
from fastapi_service.core.permissions import AuthenticatedUser, require_admin
from fastapi_service.core.security import hash_password, record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.identity import (
    Permission,
    Role,
    RolePermission,
    SessionRecord,
    User,
    UserRole,
)

router = APIRouter(prefix="/users", tags=["Users & RBAC"])


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    role: str
    active: bool
    assigned_roles: list[str] = []
    created_at: datetime
    updated_at: datetime


class UserCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailAddress
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=150)
    role: Literal["admin", "cashier"] = "cashier"
    active: bool = True
    role_codes: list[str] = Field(default_factory=list, max_length=10)


class UserUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=1, max_length=150)
    role: Literal["admin", "cashier"] | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class RoleCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., min_length=2, max_length=50, pattern=r"^[a-z0-9_:-]+$")
    name: str = Field(..., min_length=2, max_length=100)
    description: str = Field(default="", max_length=500)
    permission_codes: list[str] = Field(default_factory=list, max_length=50)


class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    description: str
    is_system: bool
    permissions: list[str] = []
    created_at: datetime


class AssignRolesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_codes: list[str] = Field(..., max_length=15)


def _serialize_user(db: Session, u: User) -> UserOut:
    role_codes = list(
        db.execute(
            select(Role.code)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == u.id)
        ).scalars().all()
    )
    return UserOut(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        role=str(u.role),
        active=bool(u.active),
        assigned_roles=sorted(set(role_codes)),
        created_at=u.created_at,
        updated_at=u.updated_at,
    )


@router.get("", response_model=PaginatedResponse[UserOut])
def list_users(
    pagination: PaginationParams = Depends(),
    search: str | None = None,
    active: bool | None = None,
    _admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PaginatedResponse[UserOut]:
    stmt = select(User)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where((User.email.ilike(q)) | (User.full_name.ilike(q)))
    if active is not None:
        stmt = stmt.where(User.active == active)

    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={
            "created_at": User.created_at,
            "email": User.email,
            "full_name": User.full_name,
        },
    )
    return PaginatedResponse(
        data=[_serialize_user(db, u) for u in rows],
        pagination=meta,
        message="Users retrieved successfully",
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[UserOut])
def create_user(
    payload: UserCreateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[UserOut]:
    normalized_email = payload.email.strip().lower()
    existing = db.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
    if existing:
        raise ConflictError(f"User with email '{normalized_email}' already exists", code="DUPLICATE_USER_EMAIL")

    user = User(
        email=normalized_email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=payload.role,
        active=payload.active,
    )
    db.add(user)
    db.flush()

    for code in set(payload.role_codes):
        role_row = db.execute(select(Role).where(Role.code == code.strip())).scalar_one_or_none()
        if role_row:
            db.add(UserRole(user_id=user.id, role_id=role_row.id, assigned_by=admin.id))

    record_audit_log(
        db,
        actor_id=admin.id,
        action="user.created",
        resource_type="user",
        resource_id=user.id,
        after_state={"email": user.email, "role": user.role, "active": user.active},
    )
    db.commit()
    db.refresh(user)
    return ApiResponse(data=_serialize_user(db, user), message="User created successfully")


@router.get("/roles", response_model=ApiResponse[list[RoleOut]])
def list_roles(
    _admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[list[RoleOut]]:
    roles = list(db.execute(select(Role).order_by(Role.code.asc())).scalars().all())
    out: list[RoleOut] = []
    for r in roles:
        perms = [rp.permission.code for rp in r.role_permissions if rp.permission]
        out.append(
            RoleOut(
                id=r.id,
                code=r.code,
                name=r.name,
                description=r.description,
                is_system=r.is_system,
                permissions=sorted(perms),
                created_at=r.created_at,
            )
        )
    return ApiResponse(data=out, message="Roles retrieved successfully")


@router.post("/roles", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[RoleOut])
def create_role(
    payload: RoleCreateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[RoleOut]:
    existing = db.execute(select(Role).where(Role.code == payload.code)).scalar_one_or_none()
    if existing:
        raise ConflictError(f"Role '{payload.code}' already exists", code="DUPLICATE_ROLE")

    role = Role(
        code=payload.code,
        name=payload.name.strip(),
        description=payload.description.strip(),
        is_system=False,
    )
    db.add(role)
    db.flush()

    granted_codes: list[str] = []
    for pcode in set(payload.permission_codes):
        clean_code = pcode.strip()
        if not clean_code:
            continue
        perm = db.execute(select(Permission).where(Permission.code == clean_code)).scalar_one_or_none()
        if not perm:
            module_part = clean_code.split(":")[0] if ":" in clean_code else "general"
            perm = Permission(code=clean_code, module=module_part, description=clean_code)
            db.add(perm)
            db.flush()
        db.add(RolePermission(role_id=role.id, permission_id=perm.id))
        granted_codes.append(clean_code)

    record_audit_log(
        db,
        actor_id=admin.id,
        action="role.created",
        resource_type="role",
        resource_id=role.id,
        after_state={"code": role.code, "permissions": granted_codes},
    )
    db.commit()
    db.refresh(role)
    return ApiResponse(
        data=RoleOut(
            id=role.id,
            code=role.code,
            name=role.name,
            description=role.description,
            is_system=role.is_system,
            permissions=sorted(granted_codes),
            created_at=role.created_at,
        ),
        message="Role created successfully",
    )


@router.get("/{user_id}", response_model=ApiResponse[UserOut])
def get_user(
    user_id: uuid.UUID,
    _admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[UserOut]:
    user = db.get(User, user_id)
    if not user:
        raise NotFoundError("User", details={"user_id": str(user_id)})
    return ApiResponse(data=_serialize_user(db, user), message="User retrieved successfully")


@router.patch("/{user_id}", response_model=ApiResponse[UserOut])
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[UserOut]:
    user = db.get(User, user_id)
    if not user:
        raise NotFoundError("User", details={"user_id": str(user_id)})

    if user.id == admin.id and payload.active is False:
        raise BadRequestError("Administrators cannot deactivate their own active account")

    before = {"full_name": user.full_name, "role": str(user.role), "active": bool(user.active)}

    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.role is not None:
        user.role = payload.role
    if payload.active is not None:
        user.active = payload.active
        if not payload.active:
            # Immediately invalidate all active sessions when a user is deactivated
            db.execute(delete(SessionRecord).where(SessionRecord.user_id == user.id))
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)

    after = {"full_name": user.full_name, "role": str(user.role), "active": bool(user.active)}
    record_audit_log(
        db,
        actor_id=admin.id,
        action="user.updated",
        resource_type="user",
        resource_id=user.id,
        before_state=before,
        after_state=after,
    )
    db.commit()
    db.refresh(user)
    return ApiResponse(data=_serialize_user(db, user), message="User updated successfully")


@router.post("/{user_id}/deactivate", response_model=ApiResponse[UserOut])
def deactivate_user(
    user_id: uuid.UUID,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[UserOut]:
    user = db.get(User, user_id)
    if not user:
        raise NotFoundError("User", details={"user_id": str(user_id)})
    if user.id == admin.id:
        raise BadRequestError("Administrators cannot deactivate their own account")

    user.active = False
    db.execute(delete(SessionRecord).where(SessionRecord.user_id == user.id))
    record_audit_log(
        db,
        actor_id=admin.id,
        action="user.deactivated",
        resource_type="user",
        resource_id=user.id,
    )
    db.commit()
    db.refresh(user)
    return ApiResponse(data=_serialize_user(db, user), message="User deactivated and active sessions revoked")


@router.put("/{user_id}/roles", response_model=ApiResponse[UserOut])
def assign_user_roles(
    user_id: uuid.UUID,
    payload: AssignRolesRequest,
    admin: AuthenticatedUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApiResponse[UserOut]:
    user = db.get(User, user_id)
    if not user:
        raise NotFoundError("User", details={"user_id": str(user_id)})

    db.execute(delete(UserRole).where(UserRole.user_id == user.id))
    for code in set(payload.role_codes):
        role_row = db.execute(select(Role).where(Role.code == code.strip())).scalar_one_or_none()
        if not role_row:
            raise NotFoundError(f"Role '{code}'")
        db.add(UserRole(user_id=user.id, role_id=role_row.id, assigned_by=admin.id))

    record_audit_log(
        db,
        actor_id=admin.id,
        action="user.roles_updated",
        resource_type="user",
        resource_id=user.id,
        after_state={"role_codes": payload.role_codes},
    )
    db.commit()
    db.refresh(user)
    return ApiResponse(data=_serialize_user(db, user), message="User roles updated successfully")
