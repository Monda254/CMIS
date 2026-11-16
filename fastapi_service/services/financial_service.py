"""
Authoritative Financial, Line-Item Calculation, Snapshot & Concurrency-Safe Numbering Service (SQLAlchemy 2.x).
Strictly enforces Decimal arithmetic (never binary float) and database-level concurrency safety.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import BadRequestError, NotFoundError
from fastapi_service.models.crm import Client
from fastapi_service.models.settings import CompanySettings, TaxConfiguration

VERIFY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
TWO_PLACES = Decimal("0.01")
THREE_PLACES = Decimal("0.001")
FOUR_PLACES = Decimal("0.0001")


def quantize_money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def quantize_qty(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(THREE_PLACES, rounding=ROUND_HALF_UP)


def quantize_rate(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)


def generate_verification_code(length: int = 10) -> str:
    return "".join(secrets.choice(VERIFY_ALPHABET) for _ in range(length))


def ensure_company_settings(session: Session) -> CompanySettings:
    settings_row = session.get(CompanySettings, 1)
    if settings_row:
        return settings_row
    settings_row = CompanySettings(
        id=1,
        name="Ledgerly Commercial Solutions Ltd",
        currency="KES",
        number_prefix="RCP",
        invoice_prefix="INV",
        quote_prefix="QTN",
        payment_prefix="PAY",
    )
    session.add(settings_row)
    session.flush()
    return settings_row


def build_company_snapshot(settings_row: CompanySettings) -> dict[str, Any]:
    return {
        "name": settings_row.name,
        "registration_number": settings_row.registration_number,
        "tax_pin": settings_row.tax_pin,
        "address": settings_row.address,
        "phone": settings_row.phone,
        "email": settings_row.email,
        "website": settings_row.website,
        "footer": settings_row.footer,
        "currency": settings_row.currency,
        "logo_url": settings_row.logo_url,
        "stamp_url": settings_row.stamp_url,
        "signature_url": settings_row.signature_url,
    }


def build_client_snapshot(client: Client) -> dict[str, Any]:
    return {
        "id": str(client.id),
        "client_code": client.client_code,
        "client_type": client.client_type,
        "name": client.name,
        "email": client.email,
        "phone": client.phone,
        "address": client.address,
        "billing_address": client.billing_address,
        "tax_pin": client.tax_pin,
    }


@dataclass
class ComputedLineItem:
    position: int
    description: str
    quantity: Decimal
    unit_price: Decimal
    discount_amount: Decimal
    tax_config_id: uuid.UUID | None
    tax_rate: Decimal
    tax_amount: Decimal
    line_subtotal: Decimal
    line_total: Decimal


@dataclass
class ComputedDocumentTotals:
    items: list[ComputedLineItem]
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal


def compute_authoritative_document_totals(
    session: Session,
    raw_items: list[dict[str, Any]],
) -> ComputedDocumentTotals:
    """
    Calculates authoritative line subtotals, discounts, tax amounts, line totals, and document totals
    exclusively on the backend using Python Decimal (ROUND_HALF_UP).
    Never trusts totals supplied by the client/frontend.
    """
    if not raw_items:
        raise BadRequestError("At least one line item is required")
    if len(raw_items) > 200:
        raise BadRequestError("Maximum 200 line items allowed per document")

    computed_items: list[ComputedLineItem] = []
    doc_subtotal = Decimal("0.00")
    doc_discount = Decimal("0.00")
    doc_tax = Decimal("0.00")
    doc_total = Decimal("0.00")

    for idx, item in enumerate(raw_items):
        description = str(item.get("description") or "").strip()
        if not description or len(description) > 500:
            raise BadRequestError(f"Line item {idx + 1}: description must be between 1 and 500 characters")

        qty = quantize_qty(item["quantity"])
        unit_price = quantize_money(item["unit_price"])
        discount_amount = quantize_money(item.get("discount_amount", Decimal("0.00")))

        if qty <= Decimal("0.000"):
            raise BadRequestError(f"Line item {idx + 1}: quantity must be greater than zero")
        if unit_price < Decimal("0.00"):
            raise BadRequestError(f"Line item {idx + 1}: unit_price cannot be negative")
        if discount_amount < Decimal("0.00"):
            raise BadRequestError(f"Line item {idx + 1}: discount_amount cannot be negative")

        gross_line = quantize_money(qty * unit_price)
        if discount_amount > gross_line:
            raise BadRequestError(f"Line item {idx + 1}: discount_amount ({discount_amount}) cannot exceed gross line amount ({gross_line})")

        net_before_tax = quantize_money(gross_line - discount_amount)

        tax_config_id: uuid.UUID | None = item.get("tax_config_id")
        tax_rate = quantize_rate(item.get("tax_rate", Decimal("0.0000")))
        is_inclusive = False

        if tax_config_id is not None:
            tax_cfg = session.get(TaxConfiguration, tax_config_id)
            if not tax_cfg or not tax_cfg.active:
                raise NotFoundError("Active TaxConfiguration", details={"tax_config_id": str(tax_config_id)})
            tax_rate = quantize_rate(tax_cfg.rate)
            is_inclusive = bool(tax_cfg.is_inclusive)

        if tax_rate < Decimal("0.0000") or tax_rate > Decimal("100.0000"):
            raise BadRequestError(f"Line item {idx + 1}: tax_rate must be between 0 and 100")

        if tax_rate == Decimal("0.0000"):
            line_subtotal = net_before_tax
            tax_amount = Decimal("0.00")
            line_total = net_before_tax
        elif is_inclusive:
            divisor = Decimal("1.0000") + (tax_rate / Decimal("100.0000"))
            line_subtotal = quantize_money(net_before_tax / divisor)
            tax_amount = quantize_money(net_before_tax - line_subtotal)
            line_total = net_before_tax
        else:
            line_subtotal = net_before_tax
            tax_amount = quantize_money(line_subtotal * (tax_rate / Decimal("100.0000")))
            line_total = quantize_money(line_subtotal + tax_amount)

        computed_items.append(
            ComputedLineItem(
                position=idx + 1,
                description=description,
                quantity=qty,
                unit_price=unit_price,
                discount_amount=discount_amount,
                tax_config_id=tax_config_id,
                tax_rate=tax_rate,
                tax_amount=tax_amount,
                line_subtotal=line_subtotal,
                line_total=line_total,
            )
        )
        doc_subtotal = quantize_money(doc_subtotal + line_subtotal)
        doc_discount = quantize_money(doc_discount + discount_amount)
        doc_tax = quantize_money(doc_tax + tax_amount)
        doc_total = quantize_money(doc_total + line_total)

    return ComputedDocumentTotals(
        items=computed_items,
        subtotal=doc_subtotal,
        discount_total=doc_discount,
        tax_total=doc_tax,
        total=doc_total,
    )


def allocate_document_number(
    session: Session,
    document_type: str,
    prefix: str,
    scope_year: int | None = None,
    padding_length: int = 6,
) -> str:
    """
    Atomically allocates the next sequential document number within the active transaction.
    Uses PostgreSQL row-level locking on public.numbering_sequences and stays synchronized
    with legacy public.receipt_sequences and existing document tables.
    """
    year = scope_year or datetime.now(timezone.utc).year
    clean_prefix = prefix.strip().upper()

    if document_type == "receipt":
        session.execute(
            text(
                """
                INSERT INTO public.numbering_sequences (document_type, prefix, scope_year, last_value, padding_length, updated_at)
                VALUES (
                    'receipt',
                    :prefix,
                    :year,
                    COALESCE((SELECT last_value FROM public.receipt_sequences WHERE prefix = :prefix AND year = :year), 0),
                    :pad,
                    now()
                )
                ON CONFLICT (document_type, prefix, scope_year)
                DO UPDATE SET
                    last_value = GREATEST(
                        public.numbering_sequences.last_value,
                        COALESCE((SELECT last_value FROM public.receipt_sequences WHERE prefix = :prefix AND year = :year), 0)
                    )
                """
            ),
            {"prefix": clean_prefix, "year": year, "pad": padding_length},
        )

    table_col_map = {
        "quote": ("quotes", "quote_number"),
        "invoice": ("invoices", "invoice_number"),
        "payment": ("payments", "payment_reference"),
        "receipt": ("receipts", "receipt_number"),
        "refund": ("payment_refunds", "refund_reference"),
        "reconciliation": ("reconciliation_batches", "batch_number"),
    }

    for _ in range(50):
        row = session.execute(
            text(
                """
                INSERT INTO public.numbering_sequences (document_type, prefix, scope_year, last_value, padding_length, updated_at)
                VALUES (:doc_type, :prefix, :year, 1, :pad, now())
                ON CONFLICT (document_type, prefix, scope_year)
                DO UPDATE SET
                    last_value = public.numbering_sequences.last_value + 1,
                    updated_at = now()
                RETURNING last_value, padding_length
                """
            ),
            {
                "doc_type": document_type,
                "prefix": clean_prefix,
                "year": year,
                "pad": padding_length,
            },
        ).fetchone()

        seq_val = int(row[0])
        pad = int(row[1])
        candidate = f"{clean_prefix}-{year}-{str(seq_val).zfill(pad)}"

        if document_type == "receipt":
            session.execute(
                text(
                    """
                    INSERT INTO public.receipt_sequences (prefix, year, last_value)
                    VALUES (:prefix, :year, :val)
                    ON CONFLICT (prefix, year)
                    DO UPDATE SET last_value = GREATEST(public.receipt_sequences.last_value, :val)
                    """
                ),
                {"prefix": clean_prefix, "year": year, "val": seq_val},
            )

        if document_type in table_col_map:
            tbl, col = table_col_map[document_type]
            collision = session.execute(
                text(f"SELECT 1 FROM public.{tbl} WHERE {col} = :num LIMIT 1"),
                {"num": candidate},
            ).fetchone()
            if collision:
                continue

        return candidate

    raise RuntimeError(f"Unable to allocate unique document number for {document_type}")


def allocate_unique_verification_code(session: Session) -> str:
    for _ in range(25):
        candidate = generate_verification_code(10)
        exists = session.execute(
            text("SELECT 1 FROM public.receipts WHERE verification_code = :c LIMIT 1"),
            {"c": candidate},
        ).fetchone()
        if not exists:
            return candidate
    raise RuntimeError("Unable to allocate unique receipt verification code")


def get_client_ledger(session: Session, client_id: uuid.UUID) -> dict[str, Decimal]:
    """
    Queries the authoritative derived client ledger summary view (v_client_ledger_summary).
    """
    row = session.execute(
        text(
            """
            SELECT
                total_invoiced,
                total_allocated_to_invoices,
                outstanding_invoice_balance,
                total_confirmed_payments,
                total_refunds,
                net_collections,
                unallocated_client_credit,
                total_receipted
            FROM public.v_client_ledger_summary
            WHERE client_id = :client_id
            """
        ),
        {"client_id": client_id},
    ).mappings().fetchone()

    if not row:
        zero = Decimal("0.00")
        return {
            "total_invoiced": zero,
            "total_allocated_to_invoices": zero,
            "outstanding_invoice_balance": zero,
            "total_confirmed_payments": zero,
            "total_refunds": zero,
            "net_collections": zero,
            "unallocated_client_credit": zero,
            "total_receipted": zero,
        }

    return {k: Decimal(str(v)) for k, v in row.items()}
