"""
Transaction Reconciliation SQLAlchemy 2.x Models:
- ReconciliationBatch
- ReconciliationRecord
- ReconciliationMatch
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from fastapi_service.database import Base


class ReconciliationBatch(Base):
    __tablename__ = "reconciliation_batches"
    __table_args__ = (
        CheckConstraint(
            "source_type IN ('mpesa_statement', 'bank_statement', 'card_settlement', 'manual_import')",
            name="chk_recon_batches_source",
        ),
        CheckConstraint(
            "status IN ('open', 'in_review', 'completed', 'archived')",
            name="chk_recon_batches_status",
        ),
        CheckConstraint(
            "total_records >= 0 AND matched_records >= 0 AND unmatched_records >= 0",
            name="chk_recon_batches_counts",
        ),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    batch_number: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)
    account_identifier: Mapped[str] = mapped_column(
        String(100), nullable=False, default="", server_default=text("''")
    )
    period_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    period_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="open", server_default=text("'open'")
    )
    total_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    matched_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    unmatched_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    imported_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    records: Mapped[list["ReconciliationRecord"]] = relationship(
        "ReconciliationRecord", back_populates="batch", cascade="all, delete-orphan"
    )


class ReconciliationRecord(Base):
    __tablename__ = "reconciliation_records"
    __table_args__ = (
        UniqueConstraint("payment_method", "external_tx_id", name="uq_recon_external_source"),
        CheckConstraint("amount > 0", name="chk_recon_records_amount_positive"),
        CheckConstraint(
            "match_status IN ('unmatched', 'suggested', 'matched', 'rejected', 'ignored')",
            name="chk_recon_records_match_status",
        ),
        Index("idx_recon_records_batch_status", "batch_id", "match_status"),
        Index("idx_recon_records_tx_date", "transaction_date"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.reconciliation_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    external_tx_id: Mapped[str] = mapped_column(String(100), nullable=False)
    payment_method: Mapped[str] = mapped_column(
        String(30), nullable=False, default="mpesa", server_default=text("'mpesa'")
    )
    transaction_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="KES", server_default=text("'KES'")
    )
    payer_name: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    payer_phone: Mapped[str] = mapped_column(String(50), nullable=False, default="", server_default=text("''"))
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    match_status: Mapped[str] = mapped_column(
        String(25), nullable=False, default="unmatched", server_default=text("'unmatched'")
    )
    raw_payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    batch: Mapped["ReconciliationBatch"] = relationship("ReconciliationBatch", back_populates="records")
    matches: Mapped[list["ReconciliationMatch"]] = relationship(
        "ReconciliationMatch", back_populates="record", cascade="all, delete-orphan"
    )


class ReconciliationMatch(Base):
    __tablename__ = "reconciliation_matches"
    __table_args__ = (
        CheckConstraint("matched_amount > 0", name="chk_recon_matches_amount_positive"),
        CheckConstraint(
            "confidence_score >= 0 AND confidence_score <= 100",
            name="chk_recon_matches_confidence",
        ),
        CheckConstraint(
            "match_state IN ('suggested', 'confirmed', 'rejected', 'unmatched')",
            name="chk_recon_matches_state",
        ),
        Index(
            "uq_recon_record_confirmed",
            "reconciliation_record_id",
            unique=True,
            postgresql_where=text("match_state = 'confirmed'"),
        ),
        Index("idx_recon_matches_payment", "payment_id"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    reconciliation_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.reconciliation_records.id", ondelete="CASCADE"),
        nullable=False,
    )
    payment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.payments.id", ondelete="RESTRICT"),
        nullable=True,
    )
    invoice_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.invoices.id", ondelete="RESTRICT"),
        nullable=True,
    )
    matched_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    confidence_score: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("100.00"), server_default=text("100.00")
    )
    match_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="suggested", server_default=text("'suggested'")
    )
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    matched_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    matched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    record: Mapped["ReconciliationRecord"] = relationship("ReconciliationRecord", back_populates="matches")
