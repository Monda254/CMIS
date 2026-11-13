"""
Client Relationship Management (CRM) SQLAlchemy 2.x Models:
- ClientCategory
- Client
- ClientContact
- ClientTag
- ClientTagAssignment
- ClientInteraction
- ClientDocument
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from fastapi_service.database import Base

if TYPE_CHECKING:
    from fastapi_service.models.invoicing import Invoice
    from fastapi_service.models.payments import Payment
    from fastapi_service.models.quotations import Quote
    from fastapi_service.models.receipts import Receipt


class ClientCategory(Base):
    __tablename__ = "client_categories"
    __table_args__ = ({"schema": "public"},)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    clients: Mapped[list["Client"]] = relationship("Client", back_populates="category")


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (
        CheckConstraint("client_type IN ('individual', 'corporate')", name="chk_clients_type"),
        CheckConstraint("status IN ('active', 'inactive', 'archived')", name="chk_clients_status"),
        Index("clients_name_idx", "name"),
        Index("clients_phone_idx", "phone"),
        Index("idx_clients_email", "email"),
        Index("idx_clients_category", "category_id"),
        Index("idx_clients_status", "status"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    client_code: Mapped[Optional[str]] = mapped_column(String(30), unique=True, nullable=True)
    client_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="individual", server_default=text("'individual'")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    phone: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    address: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    billing_address: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    industry: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    tax_pin: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default=text("''"))
    category_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.client_categories.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default=text("'active'")
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    last_activity_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    category: Mapped[Optional["ClientCategory"]] = relationship("ClientCategory", back_populates="clients")
    contacts: Mapped[list["ClientContact"]] = relationship(
        "ClientContact", back_populates="client", cascade="all, delete-orphan"
    )
    tag_assignments: Mapped[list["ClientTagAssignment"]] = relationship(
        "ClientTagAssignment", back_populates="client", cascade="all, delete-orphan"
    )
    interactions: Mapped[list["ClientInteraction"]] = relationship(
        "ClientInteraction", back_populates="client", cascade="all, delete-orphan"
    )
    documents: Mapped[list["ClientDocument"]] = relationship(
        "ClientDocument", back_populates="client", cascade="all, delete-orphan"
    )
    quotes: Mapped[list["Quote"]] = relationship("Quote", back_populates="client")
    invoices: Mapped[list["Invoice"]] = relationship("Invoice", back_populates="client")
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="client")
    receipts: Mapped[list["Receipt"]] = relationship("Receipt", back_populates="client")


class ClientContact(Base):
    __tablename__ = "client_contacts"
    __table_args__ = (
        Index("idx_client_contacts_client", "client_id"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.clients.id", ondelete="CASCADE"),
        nullable=False,
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    job_title: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default=text("''"))
    email: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    phone: Mapped[str] = mapped_column(String(50), nullable=False, default="", server_default=text("''"))
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    client: Mapped["Client"] = relationship("Client", back_populates="contacts")


class ClientTag(Base):
    __tablename__ = "client_tags"
    __table_args__ = ({"schema": "public"},)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    color_hex: Mapped[str] = mapped_column(
        String(7), nullable=False, default="#5848D6", server_default=text("'#5848D6'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    assignments: Mapped[list["ClientTagAssignment"]] = relationship(
        "ClientTagAssignment", back_populates="tag", cascade="all, delete-orphan"
    )


class ClientTagAssignment(Base):
    __tablename__ = "client_tag_assignments"
    __table_args__ = (
        Index("idx_client_tag_assignments_tag", "tag_id"),
        {"schema": "public"},
    )

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.clients.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.client_tags.id", ondelete="CASCADE"),
        primary_key=True,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    client: Mapped["Client"] = relationship("Client", back_populates="tag_assignments")
    tag: Mapped["ClientTag"] = relationship("ClientTag", back_populates="assignments")


class ClientInteraction(Base):
    __tablename__ = "client_interactions"
    __table_args__ = (
        CheckConstraint(
            "interaction_type IN ('call', 'meeting', 'email', 'follow_up', 'requirement', 'note', 'other')",
            name="chk_client_interactions_type",
        ),
        Index("idx_client_interactions_client_date", "client_id", "occurred_at"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.clients.id", ondelete="CASCADE"),
        nullable=False,
    )
    contact_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.client_contacts.id", ondelete="SET NULL"),
        nullable=True,
    )
    interaction_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="note", server_default=text("'note'")
    )
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    next_follow_up_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    logged_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    client: Mapped["Client"] = relationship("Client", back_populates="interactions")


class ClientDocument(Base):
    __tablename__ = "client_documents"
    __table_args__ = (
        CheckConstraint(
            "document_category IN ('contract', 'proposal', 'sla', 'kyc', 'tax_exemption', 'other')",
            name="chk_client_documents_category",
        ),
        Index("idx_client_documents_client", "client_id"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.clients.id", ondelete="CASCADE"),
        nullable=False,
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.file_metadata.id", ondelete="RESTRICT"),
        nullable=False,
    )
    document_category: Mapped[str] = mapped_column(
        String(50), nullable=False, default="contract", server_default=text("'contract'")
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    uploaded_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    client: Mapped["Client"] = relationship("Client", back_populates="documents")
