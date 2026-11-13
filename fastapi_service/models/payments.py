"""
Payments, Payment Allocations, and Payment Refunds SQLAlchemy 2.x Models.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from fastapi_service.database import Base

if TYPE_CHECKING:
    from fastapi_service.models.crm import Client
    from fastapi_service.models.invoicing import Invoice
    from fastapi_service.models.receipts import PaymentReceiptAllocation


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'confirmed', 'failed', 'refunded', 'partially_refunded', 'reversed')",
            name="chk_payments_status",
        ),
        CheckConstraint(
            "payment_method IN ('cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other')",
            name="chk_payments_method",
        ),
        CheckConstraint("amount > 0", name="chk_payments_amount_positive"),
        CheckConstraint(
            "amount_allocated >= 0 AND amount_refunded >= 0 AND amount_receipted >= 0 AND unallocated_amount >= 0",
            name="chk_payments_subamounts_non_negative",
        ),
        CheckConstraint(
            "amount_allocated + amount_refunded <= amount",
            name="chk_payments_allocation_bounds",
        ),
        CheckConstraint(
            "amount_receipted <= amount - amount_refunded",
            name="chk_payments_receipt_bounds",
        ),
        CheckConstraint(
            "unallocated_amount = amount - amount_allocated - amount_refunded",
            name="chk_payments_unallocated_sync",
        ),
        Index("idx_payments_client_status_date", "client_id", "status", "payment_date"),
        Index("idx_payments_external_ref", "payment_method", "external_reference"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    payment_reference: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.clients.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(25), nullable=False, default="pending", server_default=text("'pending'")
    )
    payment_method: Mapped[str] = mapped_column(
        String(30), nullable=False, default="mpesa", server_default=text("'mpesa'")
    )
    external_reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    payment_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="KES", server_default=text("'KES'")
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    amount_allocated: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default=text("0.00")
    )
    amount_refunded: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default=text("0.00")
    )
    amount_receipted: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default=text("0.00")
    )
    unallocated_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default=text("0.00")
    )
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    recorded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    confirmed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    client: Mapped["Client"] = relationship("Client", back_populates="payments")
    allocations: Mapped[list["PaymentAllocation"]] = relationship(
        "PaymentAllocation", back_populates="payment"
    )
    refunds: Mapped[list["PaymentRefund"]] = relationship(
        "PaymentRefund", back_populates="payment"
    )
    receipt_allocations: Mapped[list["PaymentReceiptAllocation"]] = relationship(
        "PaymentReceiptAllocation", back_populates="payment"
    )


class PaymentAllocation(Base):
    __tablename__ = "payment_allocations"
    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_payment_allocations_amount_positive"),
        CheckConstraint("status IN ('active', 'reversed')", name="chk_payment_allocations_status"),
        Index("idx_payment_alloc_invoice", "invoice_id", "status"),
        Index("idx_payment_alloc_payment", "payment_id", "status"),
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
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.invoices.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default=text("'active'")
    )
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default=text("''"))
    allocated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    allocated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    reversed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reversed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reversal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    payment: Mapped["Payment"] = relationship("Payment", back_populates="allocations")
    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="payment_allocations")


class PaymentRefund(Base):
    __tablename__ = "payment_refunds"
    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_payment_refunds_amount_positive"),
        CheckConstraint("status IN ('pending', 'completed', 'failed')", name="chk_payment_refunds_status"),
        Index("idx_payment_refunds_payment", "payment_id", "status"),
        {"schema": "public"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    refund_reference: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    payment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.payments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="completed", server_default=text("'completed'")
    )
    external_reference: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    processed_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public.users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    refunded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    payment: Mapped["Payment"] = relationship("Payment", back_populates="refunds")
