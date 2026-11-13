"""
Receipts, Receipt Items, Payment-Receipt Allocations, and Verification Logs SQLAlchemy 2.x Models.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from fastapi_service.database import Base

if TYPE_CHECKING:
    from fastapi_service.models.crm import Client
    from fastapi_service.models.payments import Payment

receipt_status_enum = SAEnum(
    "draft", "finalized", "cancelled", name="receipt_status", schema="public", create_type=False
)


class Receipt(Base):
    __tablename__ = "receipts"
    __table_args__ = (
        CheckConstraint(
            "payment_status IN ('paid', 'half_paid', 'unpaid', 'in_progress', 'failed', 'overdue', 'refunded', 'disputed')",
            name="chk_receipts_payment_status",
        ),
        CheckConstraint(
            "total >= 0 AND amount_paid >= 0 AND balance_due >= 0",
            name="chk_receipts_amounts_non_negative",
        ),
        Index("receipts_status_finalized_idx", "status", "finalized_at"),
        Index("receipts_client_id_idx", "client_id"),
        Index("receipts_created_at_idx", "created_at"),
        Index("idx_receipts_primary_payment", "primary_payment_id"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    status: Mapped[str] = mapped_column(
        receipt_status_enum, nullable=False, default="draft", server_default=text("'draft'::receipt_status")
    )
    receipt_number: Mapped[Optional[str]] = mapped_column(Text, unique=True, nullable=True)
    verification_code: Mapped[Optional[str]] = mapped_column(Text, unique=True, nullable=True)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.clients.id"),
        nullable=False,
    )
    primary_payment_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.payments.id", ondelete="SET NULL"),
        nullable=True,
    )
    invoice_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.invoices.id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_name: Mapped[str] = mapped_column(Text, nullable=False)
    customer_phone: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    customer_address: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    currency: Mapped[str] = mapped_column(Text, nullable=False, default="KES", server_default=text("'KES'"))
    total: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default=text("0.00")
    )
    payment_status: Mapped[str] = mapped_column(
        Text, nullable=False, default="paid", server_default=text("'paid'")
    )
    amount_paid: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default=text("0.00")
    )
    balance_due: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default=text("0.00")
    )
    payment_method: Mapped[str] = mapped_column(
        Text, nullable=False, default="M-Pesa", server_default=text("'M-Pesa'")
    )
    company_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id"),
        nullable=False,
    )
    issued_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id"),
        nullable=True,
    )
    issued_by_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finalized_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id"),
        nullable=True,
    )
    cancel_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    print_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))

    client: Mapped["Client"] = relationship("Client", back_populates="receipts")
    items: Mapped[list["ReceiptItem"]] = relationship(
        "ReceiptItem", back_populates="receipt", cascade="all, delete-orphan", order_by="ReceiptItem.position"
    )
    payment_allocations: Mapped[list["PaymentReceiptAllocation"]] = relationship(
        "PaymentReceiptAllocation", back_populates="receipt", cascade="all, delete-orphan"
    )


class ReceiptItem(Base):
    __tablename__ = "receipt_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="chk_receipt_items_qty_positive"),
        CheckConstraint("unit_price >= 0 AND line_total >= 0", name="chk_receipt_items_prices_non_negative"),
        Index("receipt_items_receipt_pos_idx", "receipt_id", "position"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    receipt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.receipts.id", ondelete="CASCADE"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    receipt: Mapped["Receipt"] = relationship("Receipt", back_populates="items")


class PaymentReceiptAllocation(Base):
    """
    Explicit M:N link tracking how much of a confirmed payment is acknowledged
    by a finalized receipt, preventing double-receipting of the same payment funds.
    """

    __tablename__ = "payment_receipt_allocations"
    __table_args__ = (
        CheckConstraint("amount_acknowledged > 0", name="chk_pra_amount_positive"),
        CheckConstraint("status IN ('active', 'cancelled')", name="chk_pra_status"),
        Index(
            "uq_payment_receipt_active",
            "payment_id",
            "receipt_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index("idx_pra_receipt_id", "receipt_id"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.payments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    receipt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.receipts.id", ondelete="CASCADE"),
        nullable=False,
    )
    amount_acknowledged: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default=text("'active'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    payment: Mapped["Payment"] = relationship("Payment", back_populates="receipt_allocations")
    receipt: Mapped["Receipt"] = relationship("Receipt", back_populates="payment_allocations")


class VerifyAttempt(Base):
    """Public receipt verification log and rate-limiting ledger (receipt_verification_logs)."""

    __tablename__ = "verify_attempts"
    __table_args__ = (
        Index("verify_attempts_client_key_idx", "client_key", "created_at"),
        Index("verify_attempts_identifier_idx", "identifier", "created_at"),
        {"schema": "public"},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    client_key: Mapped[str] = mapped_column(Text, nullable=False)
    identifier: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
