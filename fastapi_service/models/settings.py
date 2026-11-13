"""
Business Settings, File Metadata, Document Templates, Numbering Sequences, and Tax Configurations.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from fastapi_service.database import Base


class CompanySettings(Base):
    __tablename__ = "company_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="chk_company_settings_singleton"),
        {"schema": "public"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1, server_default=text("1"))
    name: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    registration_number: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    tax_pin: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    address: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    phone: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    email: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    website: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    footer: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="KES", server_default=text("'KES'"))
    number_prefix: Mapped[str] = mapped_column(Text, nullable=False, default="RCP", server_default=text("'RCP'"))
    invoice_prefix: Mapped[str] = mapped_column(Text, nullable=False, default="INV", server_default=text("'INV'"))
    quote_prefix: Mapped[str] = mapped_column(Text, nullable=False, default="QTN", server_default=text("'QTN'"))
    payment_prefix: Mapped[str] = mapped_column(Text, nullable=False, default="PAY", server_default=text("'PAY'"))
    logo_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stamp_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    signature_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )


class FileMetadata(Base):
    __tablename__ = "file_metadata"
    __table_args__ = (
        CheckConstraint("file_size_bytes >= 0", name="chk_file_metadata_size"),
        CheckConstraint(
            "access_classification IN ('public_branding', 'authenticated', 'confidential_client', 'immutable_financial_pdf')",
            name="chk_file_metadata_classification",
        ),
        Index("idx_file_metadata_entity", "entity_type", "entity_id"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    original_filename: Mapped[str] = mapped_column(Text, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))
    checksum_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    access_classification: Mapped[str] = mapped_column(
        String(30), nullable=False, default="authenticated", server_default=text("'authenticated'")
    )
    entity_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    uploaded_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DocumentTemplate(Base):
    __tablename__ = "document_templates"
    __table_args__ = (
        CheckConstraint(
            "document_type IN ('quote', 'invoice', 'receipt')",
            name="chk_document_templates_type",
        ),
        Index("idx_document_templates_type", "document_type", "active"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    document_type: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    header_notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    default_terms: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    footer_notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    config_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
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


class NumberingSequence(Base):
    __tablename__ = "numbering_sequences"
    __table_args__ = (
        CheckConstraint(
            "document_type IN ('quote', 'invoice', 'payment', 'receipt', 'refund', 'reconciliation')",
            name="chk_numbering_sequences_doc_type",
        ),
        CheckConstraint("scope_year >= 2000 AND scope_year <= 2100", name="chk_numbering_sequences_year"),
        CheckConstraint("last_value >= 0", name="chk_numbering_sequences_last_value"),
        CheckConstraint("padding_length >= 3 AND padding_length <= 12", name="chk_numbering_sequences_padding"),
        {"schema": "public"},
    )

    document_type: Mapped[str] = mapped_column(String(30), primary_key=True)
    prefix: Mapped[str] = mapped_column(String(20), primary_key=True)
    scope_year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))
    padding_length: Mapped[int] = mapped_column(Integer, nullable=False, default=6, server_default=text("6"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ReceiptSequence(Base):
    """Preserved existing sequence table for direct backward compatibility."""

    __tablename__ = "receipt_sequences"
    __table_args__ = ({"schema": "public"},)

    prefix: Mapped[str] = mapped_column(Text, primary_key=True)
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))


class TaxConfiguration(Base):
    __tablename__ = "tax_configurations"
    __table_args__ = (
        CheckConstraint("rate >= 0 AND rate <= 100", name="chk_tax_config_rate"),
        CheckConstraint(
            "tax_type IN ('vat', 'withholding', 'excise', 'levy', 'exempt')",
            name="chk_tax_config_type",
        ),
        CheckConstraint(
            "applicable_to IN ('all', 'quote', 'invoice', 'receipt')",
            name="chk_tax_config_applicable",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="chk_tax_config_dates",
        ),
        Index("idx_tax_configurations_active", "active", "tax_type"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    rate: Mapped[Decimal] = mapped_column(
        Numeric(6, 4), nullable=False, default=Decimal("0.0000"), server_default=text("0.0000")
    )
    tax_type: Mapped[str] = mapped_column(
        String(30), nullable=False, default="vat", server_default=text("'vat'")
    )
    is_inclusive: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    applicable_to: Mapped[str] = mapped_column(
        String(30), nullable=False, default="all", server_default=text("'all'")
    )
    effective_from: Mapped[date] = mapped_column(
        Date, nullable=False, server_default=text("CURRENT_DATE")
    )
    effective_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
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
