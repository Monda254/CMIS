"""
Authoritative Financial & Concurrency-Safe Numbering Service (SQLAlchemy 2.x).
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

VERIFY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def quantize_money(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def generate_verification_code(length: int = 10) -> str:
    return "".join(secrets.choice(VERIFY_ALPHABET) for _ in range(length))


def allocate_document_number(
    session: Session,
    document_type: str,
    prefix: str,
    scope_year: int | None = None,
    padding_length: int = 6,
) -> str:
    """
    Atomically allocates the next sequential document number within the active transaction.
    Uses PostgreSQL row-level locking on public.numbering_sequences.
    """
    year = scope_year or datetime.now(timezone.utc).year
    clean_prefix = prefix.strip().upper()
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
    return f"{clean_prefix}-{year}-{str(seq_val).zfill(pad)}"


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
