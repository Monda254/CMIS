"""
Client Relationship Management (CRM) Module (Section 10.3).
Supports individual & corporate clients, multiple contacts, categories, tags,
interactions, documents, transaction history, and authoritative derived ledger summary.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, or_, select
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
from fastapi_service.core.security import record_audit_log
from fastapi_service.database import get_db
from fastapi_service.models.crm import (
    Client,
    ClientCategory,
    ClientContact,
    ClientDocument,
    ClientInteraction,
    ClientTag,
    ClientTagAssignment,
)
from fastapi_service.models.invoicing import Invoice
from fastapi_service.models.payments import Payment
from fastapi_service.models.quotations import Quote
from fastapi_service.models.receipts import Receipt
from fastapi_service.models.settings import FileMetadata
from fastapi_service.services.financial_service import get_client_ledger

router = APIRouter(prefix="/clients", tags=["CRM & Clients"])


class ClientCategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., min_length=2, max_length=40, pattern=r"^[A-Z0-9_-]+$")
    name: str = Field(..., min_length=2, max_length=100)
    description: str = Field(default="", max_length=500)


class ClientCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    description: str
    active: bool
    created_at: datetime


class ClientTagCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=60)
    color_hex: str = Field(default="#5848D6", pattern=r"^#[0-9A-Fa-f]{6}$")


class ClientTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color_hex: str
    created_at: datetime


class ClientContactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(..., min_length=1, max_length=150)
    job_title: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=150)
    phone: str = Field(default="", max_length=50)
    is_primary: bool = False


class ClientContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    full_name: str
    job_title: str
    email: str
    phone: str
    is_primary: bool
    active: bool
    created_at: datetime


class ClientInteractionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contact_id: uuid.UUID | None = None
    interaction_type: Literal["call", "meeting", "email", "follow_up", "requirement", "note", "other"] = "note"
    subject: str = Field(..., min_length=1, max_length=200)
    summary: str = Field(default="", max_length=4000)
    occurred_at: datetime | None = None
    next_follow_up_at: datetime | None = None


class ClientInteractionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    contact_id: uuid.UUID | None
    interaction_type: str
    subject: str
    summary: str
    occurred_at: datetime
    next_follow_up_at: datetime | None
    logged_by: uuid.UUID | None
    created_at: datetime


class ClientDocumentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_id: uuid.UUID
    document_category: Literal["contract", "proposal", "sla", "kyc", "tax_exemption", "other"] = "contract"
    title: str = Field(..., min_length=1, max_length=200)
    notes: str = Field(default="", max_length=1000)


class ClientDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    file_id: uuid.UUID
    document_category: str
    title: str
    notes: str
    uploaded_by: uuid.UUID | None
    created_at: datetime


class ClientCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_code: str | None = Field(default=None, max_length=30)
    client_type: Literal["individual", "corporate"] = "individual"
    name: str = Field(..., min_length=1, max_length=200)
    email: str = Field(default="", max_length=150)
    phone: str = Field(default="", max_length=50)
    address: str = Field(default="", max_length=500)
    billing_address: str = Field(default="", max_length=500)
    industry: str = Field(default="", max_length=100)
    tax_pin: str = Field(default="", max_length=40)
    category_id: uuid.UUID | None = None
    notes: str = Field(default="", max_length=2000)
    tag_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    contacts: list[ClientContactCreate] = Field(default_factory=list, max_length=25)


class ClientUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_type: Literal["individual", "corporate"] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=150)
    phone: str | None = Field(default=None, max_length=50)
    address: str | None = Field(default=None, max_length=500)
    billing_address: str | None = Field(default=None, max_length=500)
    industry: str | None = Field(default=None, max_length=100)
    tax_pin: str | None = Field(default=None, max_length=40)
    category_id: uuid.UUID | None = None
    status: Literal["active", "inactive", "archived"] | None = None
    notes: str | None = Field(default=None, max_length=2000)
    tag_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)


class ClientLedgerSummaryOut(BaseModel):
    total_invoiced: MoneyDecimal
    total_allocated_to_invoices: MoneyDecimal
    outstanding_invoice_balance: MoneyDecimal
    total_confirmed_payments: MoneyDecimal
    total_refunds: MoneyDecimal
    net_collections: MoneyDecimal
    unallocated_client_credit: MoneyDecimal
    total_receipted: MoneyDecimal


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_code: str | None
    client_type: str
    name: str
    email: str
    phone: str
    address: str
    billing_address: str
    industry: str
    tax_pin: str
    category_id: uuid.UUID | None
    status: str
    active: bool
    notes: str
    last_activity_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ClientDetailOut(ClientOut):
    contacts: list[ClientContactOut] = []
    tags: list[ClientTagOut] = []
    ledger_summary: ClientLedgerSummaryOut


@router.get("/categories", response_model=ApiResponse[list[ClientCategoryOut]])
def list_categories(
    _user: AuthenticatedUser = Depends(require_permission("clients:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[list[ClientCategoryOut]]:
    rows = list(db.execute(select(ClientCategory).order_by(ClientCategory.name.asc())).scalars().all())
    return ApiResponse(
        data=[ClientCategoryOut.model_validate(r) for r in rows],
        message="Client categories retrieved successfully",
    )


@router.post("/categories", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ClientCategoryOut])
def create_category(
    payload: ClientCategoryCreate,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientCategoryOut]:
    existing = db.execute(select(ClientCategory).where(ClientCategory.code == payload.code)).scalar_one_or_none()
    if existing:
        raise ConflictError(f"Client category '{payload.code}' already exists", code="DUPLICATE_CATEGORY")

    cat = ClientCategory(code=payload.code, name=payload.name.strip(), description=payload.description.strip())
    db.add(cat)
    db.flush()
    record_audit_log(db, actor_id=user.id, action="client_category.created", resource_type="client_category", resource_id=cat.id)
    db.commit()
    db.refresh(cat)
    return ApiResponse(data=ClientCategoryOut.model_validate(cat), message="Client category created successfully")


@router.get("/tags", response_model=ApiResponse[list[ClientTagOut]])
def list_tags(
    _user: AuthenticatedUser = Depends(require_permission("clients:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[list[ClientTagOut]]:
    rows = list(db.execute(select(ClientTag).order_by(ClientTag.name.asc())).scalars().all())
    return ApiResponse(
        data=[ClientTagOut.model_validate(r) for r in rows],
        message="Client tags retrieved successfully",
    )


@router.post("/tags", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ClientTagOut])
def create_tag(
    payload: ClientTagCreate,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientTagOut]:
    clean_name = payload.name.strip()
    existing = db.execute(select(ClientTag).where(ClientTag.name == clean_name)).scalar_one_or_none()
    if existing:
        raise ConflictError(f"Client tag '{clean_name}' already exists", code="DUPLICATE_TAG")

    tag = ClientTag(name=clean_name, color_hex=payload.color_hex)
    db.add(tag)
    db.flush()
    record_audit_log(db, actor_id=user.id, action="client_tag.created", resource_type="client_tag", resource_id=tag.id)
    db.commit()
    db.refresh(tag)
    return ApiResponse(data=ClientTagOut.model_validate(tag), message="Client tag created successfully")


@router.get("", response_model=PaginatedResponse[ClientOut])
def list_clients(
    pagination: PaginationParams = Depends(),
    search: str | None = None,
    status_filter: str | None = None,
    client_type: str | None = None,
    category_id: uuid.UUID | None = None,
    _user: AuthenticatedUser = Depends(require_permission("clients:read")),
    db: Session = Depends(get_db),
) -> PaginatedResponse[ClientOut]:
    stmt = select(Client)
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Client.name.ilike(q),
                Client.phone.ilike(q),
                Client.email.ilike(q),
                Client.client_code.ilike(q),
                Client.tax_pin.ilike(q),
            )
        )
    if status_filter:
        stmt = stmt.where(Client.status == status_filter)
    if client_type:
        stmt = stmt.where(Client.client_type == client_type)
    if category_id:
        stmt = stmt.where(Client.category_id == category_id)

    rows, meta = paginate_select(
        db,
        stmt,
        pagination,
        allowed_sort_columns={
            "created_at": Client.created_at,
            "updated_at": Client.updated_at,
            "name": Client.name,
            "status": Client.status,
        },
    )
    return PaginatedResponse(
        data=[ClientOut.model_validate(r) for r in rows],
        pagination=meta,
        message="Clients retrieved successfully",
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ClientDetailOut])
def create_client(
    payload: ClientCreateRequest,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientDetailOut]:
    if payload.client_code:
        existing_code = db.execute(select(Client).where(Client.client_code == payload.client_code.strip())).scalar_one_or_none()
        if existing_code:
            raise ConflictError(f"Client code '{payload.client_code}' already exists", code="DUPLICATE_CLIENT_CODE")

    if payload.category_id and not db.get(ClientCategory, payload.category_id):
        raise NotFoundError("ClientCategory", details={"category_id": str(payload.category_id)})

    now = datetime.now(timezone.utc)
    client = Client(
        client_code=payload.client_code.strip() if payload.client_code else f"CL-{uuid.uuid4().hex[:8].upper()}",
        client_type=payload.client_type,
        name=payload.name.strip(),
        email=payload.email.strip(),
        phone=payload.phone.strip(),
        address=payload.address.strip(),
        billing_address=payload.billing_address.strip() or payload.address.strip(),
        industry=payload.industry.strip(),
        tax_pin=payload.tax_pin.strip(),
        category_id=payload.category_id,
        status="active",
        active=True,
        notes=payload.notes.strip(),
        last_activity_at=now,
        created_by=user.id,
    )
    db.add(client)
    db.flush()

    for c_in in payload.contacts:
        db.add(
            ClientContact(
                client_id=client.id,
                full_name=c_in.full_name.strip(),
                job_title=c_in.job_title.strip(),
                email=c_in.email.strip(),
                phone=c_in.phone.strip(),
                is_primary=c_in.is_primary,
            )
        )

    for tid in set(payload.tag_ids):
        if not db.get(ClientTag, tid):
            raise NotFoundError("ClientTag", details={"tag_id": str(tid)})
        db.add(ClientTagAssignment(client_id=client.id, tag_id=tid))

    record_audit_log(
        db,
        actor_id=user.id,
        action="client.created",
        resource_type="client",
        resource_id=client.id,
        after_state={"name": client.name, "client_type": client.client_type, "client_code": client.client_code},
    )
    db.commit()
    return get_client_detail(client.id, user, db)


@router.get("/{client_id}", response_model=ApiResponse[ClientDetailOut])
def get_client_detail(
    client_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("clients:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientDetailOut]:
    stmt = (
        select(Client)
        .options(
            selectinload(Client.contacts),
            selectinload(Client.tag_assignments).selectinload(ClientTagAssignment.tag),
        )
        .where(Client.id == client_id)
    )
    client = db.execute(stmt).scalar_one_or_none()
    if not client:
        raise NotFoundError("Client", details={"client_id": str(client_id)})

    ledger = get_client_ledger(db, client.id)
    tags = [ClientTagOut.model_validate(ta.tag) for ta in client.tag_assignments if ta.tag]

    detail = ClientDetailOut(
        **ClientOut.model_validate(client).model_dump(),
        contacts=[ClientContactOut.model_validate(c) for c in client.contacts],
        tags=tags,
        ledger_summary=ClientLedgerSummaryOut(**ledger),
    )
    return ApiResponse(data=detail, message="Client retrieved successfully")


@router.patch("/{client_id}", response_model=ApiResponse[ClientDetailOut])
@router.put("/{client_id}", response_model=ApiResponse[ClientDetailOut])
def update_client(
    client_id: uuid.UUID,
    payload: ClientUpdateRequest,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientDetailOut]:
    client = db.get(Client, client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(client_id)})

    before = {"name": client.name, "status": client.status, "phone": client.phone, "address": client.address}
    updates = payload.model_dump(exclude_unset=True)
    tag_ids = updates.pop("tag_ids", None)

    for k, val in updates.items():
        if val is not None:
            setattr(client, k, val.strip() if isinstance(val, str) else val)

    if payload.status is not None:
        client.active = payload.status == "active"

    client.updated_at = datetime.now(timezone.utc)

    if tag_ids is not None:
        db.execute(delete(ClientTagAssignment).where(ClientTagAssignment.client_id == client.id))
        for tid in set(tag_ids):
            if not db.get(ClientTag, tid):
                raise NotFoundError("ClientTag", details={"tag_id": str(tid)})
            db.add(ClientTagAssignment(client_id=client.id, tag_id=tid))

    after = {"name": client.name, "status": client.status, "phone": client.phone, "address": client.address}
    record_audit_log(
        db,
        actor_id=user.id,
        action="client.updated",
        resource_type="client",
        resource_id=client.id,
        before_state=before,
        after_state=after,
    )
    db.commit()
    return get_client_detail(client.id, user, db)


@router.post("/{client_id}/contacts", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ClientContactOut])
def add_client_contact(
    client_id: uuid.UUID,
    payload: ClientContactCreate,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientContactOut]:
    client = db.get(Client, client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(client_id)})

    contact = ClientContact(
        client_id=client.id,
        full_name=payload.full_name.strip(),
        job_title=payload.job_title.strip(),
        email=payload.email.strip(),
        phone=payload.phone.strip(),
        is_primary=payload.is_primary,
    )
    db.add(contact)
    client.last_activity_at = datetime.now(timezone.utc)
    db.flush()
    record_audit_log(db, actor_id=user.id, action="client_contact.created", resource_type="client_contact", resource_id=contact.id)
    db.commit()
    db.refresh(contact)
    return ApiResponse(data=ClientContactOut.model_validate(contact), message="Client contact added successfully")


@router.get("/{client_id}/interactions", response_model=ApiResponse[list[ClientInteractionOut]])
def list_client_interactions(
    client_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("clients:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[list[ClientInteractionOut]]:
    if not db.get(Client, client_id):
        raise NotFoundError("Client", details={"client_id": str(client_id)})
    rows = list(
        db.execute(
            select(ClientInteraction)
            .where(ClientInteraction.client_id == client_id)
            .order_by(ClientInteraction.occurred_at.desc())
        ).scalars().all()
    )
    return ApiResponse(
        data=[ClientInteractionOut.model_validate(r) for r in rows],
        message="Client interactions retrieved successfully",
    )


@router.post("/{client_id}/interactions", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ClientInteractionOut])
def create_client_interaction(
    client_id: uuid.UUID,
    payload: ClientInteractionCreate,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientInteractionOut]:
    client = db.get(Client, client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(client_id)})

    now = datetime.now(timezone.utc)
    inter = ClientInteraction(
        client_id=client.id,
        contact_id=payload.contact_id,
        interaction_type=payload.interaction_type,
        subject=payload.subject.strip(),
        summary=payload.summary.strip(),
        occurred_at=payload.occurred_at or now,
        next_follow_up_at=payload.next_follow_up_at,
        logged_by=user.id,
    )
    db.add(inter)
    client.last_activity_at = now
    db.flush()
    record_audit_log(db, actor_id=user.id, action="client_interaction.logged", resource_type="client_interaction", resource_id=inter.id)
    db.commit()
    db.refresh(inter)
    return ApiResponse(data=ClientInteractionOut.model_validate(inter), message="Interaction logged successfully")


@router.post("/{client_id}/documents", status_code=status.HTTP_201_CREATED, response_model=ApiResponse[ClientDocumentOut])
def attach_client_document(
    client_id: uuid.UUID,
    payload: ClientDocumentCreate,
    user: AuthenticatedUser = Depends(require_permission("clients:write")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientDocumentOut]:
    client = db.get(Client, client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(client_id)})
    file_meta = db.get(FileMetadata, payload.file_id)
    if not file_meta:
        raise NotFoundError("FileMetadata", details={"file_id": str(payload.file_id)})

    doc = ClientDocument(
        client_id=client.id,
        file_id=file_meta.id,
        document_category=payload.document_category,
        title=payload.title.strip(),
        notes=payload.notes.strip(),
        uploaded_by=user.id,
    )
    db.add(doc)
    db.flush()
    record_audit_log(db, actor_id=user.id, action="client_document.attached", resource_type="client_document", resource_id=doc.id)
    db.commit()
    db.refresh(doc)
    return ApiResponse(data=ClientDocumentOut.model_validate(doc), message="Client document linked successfully")


@router.get("/{client_id}/ledger", response_model=ApiResponse[ClientLedgerSummaryOut])
def get_client_ledger_endpoint(
    client_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("clients:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[ClientLedgerSummaryOut]:
    if not db.get(Client, client_id):
        raise NotFoundError("Client", details={"client_id": str(client_id)})
    ledger = get_client_ledger(db, client_id)
    return ApiResponse(data=ClientLedgerSummaryOut(**ledger), message="Client ledger summary derived successfully")


@router.get("/{client_id}/transactions", response_model=ApiResponse[dict[str, Any]])
def get_client_transactions(
    client_id: uuid.UUID,
    _user: AuthenticatedUser = Depends(require_permission("clients:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    client = db.get(Client, client_id)
    if not client:
        raise NotFoundError("Client", details={"client_id": str(client_id)})

    quotes = list(db.execute(select(Quote).where(Quote.client_id == client_id).order_by(Quote.created_at.desc()).limit(50)).scalars().all())
    invoices = list(db.execute(select(Invoice).where(Invoice.client_id == client_id).order_by(Invoice.created_at.desc()).limit(50)).scalars().all())
    payments = list(db.execute(select(Payment).where(Payment.client_id == client_id).order_by(Payment.payment_date.desc()).limit(50)).scalars().all())
    receipts = list(db.execute(select(Receipt).where(Receipt.client_id == client_id).order_by(Receipt.created_at.desc()).limit(50)).scalars().all())
    ledger = get_client_ledger(db, client_id)

    return ApiResponse(
        data={
            "client_id": str(client.id),
            "client_name": client.name,
            "ledger_summary": {k: f"{v:.2f}" for k, v in ledger.items()},
            "quotations": [
                {
                    "id": str(q.id),
                    "quote_number": q.quote_number,
                    "status": q.status,
                    "total": f"{Decimal(q.total):.2f}",
                    "issue_date": q.issue_date.isoformat(),
                }
                for q in quotes
            ],
            "invoices": [
                {
                    "id": str(inv.id),
                    "invoice_number": inv.invoice_number,
                    "status": inv.status,
                    "total": f"{Decimal(inv.total):.2f}",
                    "amount_allocated": f"{Decimal(inv.amount_allocated):.2f}",
                    "balance_due": f"{Decimal(inv.balance_due):.2f}",
                    "issue_date": inv.issue_date.isoformat(),
                }
                for inv in invoices
            ],
            "payments": [
                {
                    "id": str(p.id),
                    "payment_reference": p.payment_reference,
                    "status": p.status,
                    "payment_method": p.payment_method,
                    "amount": f"{Decimal(p.amount):.2f}",
                    "amount_allocated": f"{Decimal(p.amount_allocated):.2f}",
                    "unallocated_amount": f"{Decimal(p.unallocated_amount):.2f}",
                    "payment_date": p.payment_date.isoformat(),
                }
                for p in payments
            ],
            "receipts": [
                {
                    "id": str(r.id),
                    "receipt_number": r.receipt_number,
                    "status": str(r.status),
                    "amount_paid": f"{Decimal(r.amount_paid):.2f}",
                    "finalized_at": r.finalized_at.isoformat() if r.finalized_at else None,
                }
                for r in receipts
            ],
        },
        message="Client transaction history retrieved successfully",
    )
