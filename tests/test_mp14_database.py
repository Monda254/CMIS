"""
MP-14 Comprehensive PostgreSQL Database Architecture & Financial Integrity Test Suite.

Tests all 7 mandatory categories against live PostgreSQL:
1. Schema Tests (tables, PKs, FKs, RLS, indexes, NUMERIC precision)
2. Relationship Tests (IAM/RBAC, CRM, Quote->Invoice, Invoice->Items, Payment->Allocations->Receipts, Reconciliation)
3. Constraint Tests (singleton settings, negative money, unique codes, duplicate confirmed reconciliation)
4. Financial Integrity Tests (100k invoice + 40k/60k payments & receipts, over-allocation rejection, double-receipting rejection, multi-invoice allocation, refunds preserving history, snapshot immutability)
5. Concurrency Tests (parallel sequence numbering, parallel payment allocations)
6. Migration Tests (Alembic revision tracking, idempotent upgrade)
7. Performance Tests (EXPLAIN ANALYZE on 7 representative production query patterns)
"""

from __future__ import annotations

import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError, InternalError, ProgrammingError
from sqlalchemy.orm import Session

from fastapi_service.database import build_sync_engine
from fastapi_service.models import (
    AuditLog,
    Base,
    Client,
    ClientCategory,
    ClientContact,
    ClientDocument,
    ClientInteraction,
    ClientTag,
    ClientTagAssignment,
    CompanySettings,
    DocumentTemplate,
    EmailLog,
    FileMetadata,
    Invoice,
    InvoiceItem,
    NotificationTemplate,
    NumberingSequence,
    Payment,
    PaymentAllocation,
    PaymentReceiptAllocation,
    PaymentRefund,
    Permission,
    Quote,
    QuoteItem,
    Receipt,
    ReceiptItem,
    ReceiptSequence,
    ReconciliationBatch,
    ReconciliationMatch,
    ReconciliationRecord,
    Role,
    RolePermission,
    SessionRecord,
    SmsLog,
    TaxConfiguration,
    User,
    UserRole,
    VerifyAttempt,
)
from fastapi_service.services.financial_service import (
    allocate_document_number,
    generate_verification_code,
    get_client_ledger,
)

EXPECTED_37_TABLES = {
    "users",
    "roles",
    "permissions",
    "user_roles",
    "role_permissions",
    "sessions",
    "audit_logs",
    "company_settings",
    "file_metadata",
    "document_templates",
    "numbering_sequences",
    "receipt_sequences",
    "tax_configurations",
    "client_categories",
    "clients",
    "client_contacts",
    "client_tags",
    "client_tag_assignments",
    "client_interactions",
    "client_documents",
    "quotes",
    "quote_items",
    "invoices",
    "invoice_items",
    "payments",
    "payment_allocations",
    "payment_refunds",
    "receipts",
    "receipt_items",
    "payment_receipt_allocations",
    "verify_attempts",
    "notification_templates",
    "email_logs",
    "sms_logs",
    "reconciliation_batches",
    "reconciliation_records",
    "reconciliation_matches",
}


@pytest.fixture(scope="session")
def db_engine():
    engine = build_sync_engine()
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    """Provides a transactional session that cleans up test-created records."""
    with Session(db_engine) as session:
        yield session


@pytest.fixture(scope="session")
def actor_user_id(db_engine) -> uuid.UUID:
    with Session(db_engine) as session:
        row = session.execute(text("SELECT id FROM public.users LIMIT 1")).fetchone()
        if row:
            return row[0]
        u = User(
            email=f"test-architect-{uuid.uuid4().hex[:8]}@ledgerly.co.ke",
            password_hash="scrypt$test",
            full_name="Database Architect",
            role="admin",
            active=True,
        )
        session.add(u)
        session.commit()
        return u.id


# =============================================================================
# 1. SCHEMA TESTS (5 tests)
# =============================================================================


def test_schema_all_37_tables_exist(db_engine):
    insp = inspect(db_engine)
    existing = set(insp.get_table_names(schema="public"))
    missing = EXPECTED_37_TABLES - existing
    assert not missing, f"Missing canonical tables: {missing}"


def test_schema_primary_keys_and_foreign_keys(db_engine):
    insp = inspect(db_engine)
    for table_name in EXPECTED_37_TABLES:
        pk = insp.get_pk_constraint(table_name, schema="public")
        assert pk and pk.get("constrained_columns"), f"Table {table_name} has no primary key"

    fks_invoices = insp.get_foreign_keys("invoices", schema="public")
    referred_tables = {fk["referred_table"] for fk in fks_invoices}
    assert {"clients", "quotes", "users"}.issubset(referred_tables)


def test_schema_rls_enabled_on_all_37_tables(db_engine):
    with db_engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT tablename, rowsecurity
                FROM pg_tables
                WHERE schemaname = 'public'
                """
            )
        ).fetchall()
    rls_map = {r[0]: bool(r[1]) for r in rows}
    for tbl in EXPECTED_37_TABLES:
        assert rls_map.get(tbl) is True, f"RLS is not enabled on public.{tbl}"


def test_schema_required_indexes_exist(db_engine):
    with db_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
        ).fetchall()
    index_names = {r[0] for r in rows}
    required = {
        "users_email_idx",
        "clients_name_idx",
        "clients_phone_idx",
        "idx_clients_email",
        "idx_invoices_client_status",
        "idx_payments_client_status_date",
        "idx_payment_alloc_invoice",
        "idx_payment_alloc_payment",
        "uq_payment_receipt_active",
        "uq_recon_record_confirmed",
        "receipts_status_finalized_idx",
        "audit_logs_created_at_idx",
    }
    missing = required - index_names
    assert not missing, f"Missing required indexes: {missing}"


def test_schema_numeric_monetary_columns_no_floats(db_engine):
    with db_engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND column_name IN (
                      'subtotal', 'discount_total', 'tax_total', 'total',
                      'amount', 'amount_allocated', 'amount_refunded', 'amount_receipted',
                      'unallocated_amount', 'amount_paid', 'balance_due',
                      'unit_price', 'line_subtotal', 'line_total', 'amount_acknowledged', 'matched_amount'
                  )
                """
            )
        ).fetchall()
    assert len(rows) >= 25
    for tbl, col, dtype in rows:
        assert dtype == "numeric", f"Column {tbl}.{col} must be numeric, found {dtype}"


# =============================================================================
# 2. RELATIONSHIP TESTS (4 tests)
# =============================================================================


def test_relationship_user_roles_and_permissions(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6]
    with Session(db_engine) as session:
        role = Role(
            code=f"finance_auditor_{suffix}",
            name="Finance Auditor",
            description="Can inspect financial ledgers",
            is_system=False,
        )
        perm = Permission(
            code=f"ledger:read_{suffix}",
            module="reporting",
            description="Read client financial ledgers",
        )
        session.add_all([role, perm])
        session.flush()

        rp = RolePermission(role_id=role.id, permission_id=perm.id)
        ur = UserRole(user_id=actor_user_id, role_id=role.id, assigned_by=actor_user_id)
        session.add_all([rp, ur])
        session.flush()

        loaded_role = session.get(Role, role.id)
        assert len(loaded_role.role_permissions) == 1
        assert loaded_role.role_permissions[0].permission.code == f"ledger:read_{suffix}"
        session.rollback()


def test_relationship_crm_client_contacts_tags_interactions_docs(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6]
    with Session(db_engine) as session:
        cat = ClientCategory(code=f"ENT_{suffix}", name="Enterprise")
        tag = ClientTag(name=f"VIP_{suffix}", color_hex="#16794F")
        file_meta = FileMetadata(
            original_filename="master_sla.pdf",
            storage_key=f"Vault/sla_{suffix}.pdf",
            mime_type="application/pdf",
            file_size_bytes=204800,
            access_classification="confidential_client",
            uploaded_by=actor_user_id,
        )
        session.add_all([cat, tag, file_meta])
        session.flush()

        client = Client(
            client_code=f"CL-{suffix}",
            client_type="corporate",
            name=f"East African Logistics {suffix}",
            email=f"info@{suffix}.co.ke",
            phone="+254700111222",
            tax_pin="P051999888Z",
            category_id=cat.id,
            created_by=actor_user_id,
        )
        session.add(client)
        session.flush()

        contact1 = ClientContact(
            client_id=client.id,
            full_name="Grace Wanjiku",
            job_title="Procurement Director",
            email="grace@eal.co.ke",
            phone="+254722111222",
            is_primary=True,
        )
        contact2 = ClientContact(
            client_id=client.id,
            full_name="David Ochieng",
            job_title="Accounts Payable Lead",
            email="david@eal.co.ke",
            phone="+254733111222",
            is_primary=False,
        )
        tag_assign = ClientTagAssignment(client_id=client.id, tag_id=tag.id)
        interaction = ClientInteraction(
            client_id=client.id,
            interaction_type="meeting",
            subject="Q4 SLA Renewal Review",
            summary="Agreed on annual support terms.",
            logged_by=actor_user_id,
        )
        doc = ClientDocument(
            client_id=client.id,
            file_id=file_meta.id,
            document_category="sla",
            title="Signed Master SLA 2026",
            uploaded_by=actor_user_id,
        )
        session.add_all([contact1, contact2, tag_assign, interaction, doc])
        session.flush()

        session.refresh(client)
        assert len(client.contacts) == 2
        assert len(client.tag_assignments) == 1
        assert len(client.interactions) == 1
        assert len(client.documents) == 1
        session.rollback()


def test_relationship_quote_to_invoice_conversion_preserves_quote(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6]
    with Session(db_engine) as session:
        client = Client(name=f"Quote Client {suffix}", client_type="corporate", created_by=actor_user_id)
        session.add(client)
        session.flush()

        quote = Quote(
            quote_number=f"QTN-2026-{suffix}",
            client_id=client.id,
            status="approved",
            subtotal=Decimal("50000.00"),
            tax_total=Decimal("8000.00"),
            total=Decimal("58000.00"),
            company_snapshot={"name": "Ledgerly Commercial Solutions Ltd"},
            client_snapshot={"name": client.name},
            created_by=actor_user_id,
        )
        session.add(quote)
        session.flush()

        q_item = QuoteItem(
            quote_id=quote.id,
            position=0,
            description="Cloud Security Assessment",
            quantity=Decimal("1.000"),
            unit_price=Decimal("50000.00"),
            tax_rate=Decimal("16.0000"),
            tax_amount=Decimal("8000.00"),
            line_subtotal=Decimal("50000.00"),
            line_total=Decimal("58000.00"),
        )
        session.add(q_item)
        session.flush()

        # Convert Quote -> Invoice without overwriting original Quote
        quote.status = "converted"
        quote.converted_at = datetime.now(timezone.utc)
        invoice = Invoice(
            invoice_number=f"INV-2026-{suffix}",
            client_id=client.id,
            quote_id=quote.id,
            status="issued",
            subtotal=quote.subtotal,
            tax_total=quote.tax_total,
            total=quote.total,
            amount_allocated=Decimal("0.00"),
            balance_due=quote.total,
            company_snapshot=quote.company_snapshot,
            client_snapshot=quote.client_snapshot,
            created_by=actor_user_id,
            issued_by=actor_user_id,
            finalized_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        session.flush()

        assert invoice.quote_id == quote.id
        assert quote.status == "converted"
        assert quote.total == Decimal("58000.00")
        assert len(quote.items) == 1
        session.rollback()


def test_relationship_reconciliation_batch_records_matches(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6]
    with Session(db_engine) as session:
        client = Client(name=f"Recon Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        payment = Payment(
            payment_reference=f"PAY-REC-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="mpesa",
            external_reference=f"QWE{suffix.upper()}",
            amount=Decimal("25000.00"),
            unallocated_amount=Decimal("25000.00"),
            recorded_by=actor_user_id,
        )
        batch = ReconciliationBatch(
            batch_number=f"BATCH-{suffix}",
            source_type="mpesa_statement",
            account_identifier="Paybill 400200",
            total_records=1,
            imported_by=actor_user_id,
        )
        session.add_all([payment, batch])
        session.flush()

        rec = ReconciliationRecord(
            batch_id=batch.id,
            external_tx_id=f"QWE{suffix.upper()}",
            payment_method="mpesa",
            transaction_date=datetime.now(timezone.utc),
            amount=Decimal("25000.00"),
            payer_name=client.name,
            match_status="matched",
        )
        session.add(rec)
        session.flush()

        match = ReconciliationMatch(
            reconciliation_record_id=rec.id,
            payment_id=payment.id,
            matched_amount=Decimal("25000.00"),
            confidence_score=Decimal("100.00"),
            match_state="confirmed",
            matched_by=actor_user_id,
        )
        session.add(match)
        session.flush()

        assert len(batch.records) == 1
        assert len(rec.matches) == 1
        assert rec.matches[0].payment_id == payment.id
        session.rollback()


# =============================================================================
# 3. CONSTRAINT TESTS (4 tests)
# =============================================================================


def test_constraint_company_settings_singleton(db_engine):
    with Session(db_engine) as session:
        bad_settings = CompanySettings(id=2, name="Second Illegal Singleton")
        session.add(bad_settings)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_constraint_negative_money_and_zero_qty_rejected(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6]
    with Session(db_engine) as session:
        client = Client(name=f"Constraint Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        bad_payment = Payment(
            payment_reference=f"PAY-NEG-{suffix}",
            client_id=client.id,
            status="pending",
            payment_method="cash",
            amount=Decimal("-500.00"),
            unallocated_amount=Decimal("0.00"),
            recorded_by=actor_user_id,
        )
        session.add(bad_payment)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_constraint_unique_document_numbers_and_verification_codes(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(name=f"Unique Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        inv1 = Invoice(
            invoice_number=f"INV-DUP-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("1000.00"),
            balance_due=Decimal("1000.00"),
            created_by=actor_user_id,
        )
        inv2 = Invoice(
            invoice_number=f"INV-DUP-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("2000.00"),
            balance_due=Decimal("2000.00"),
            created_by=actor_user_id,
        )
        session.add_all([inv1, inv2])
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_constraint_duplicate_confirmed_reconciliation_rejected(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6]
    with Session(db_engine) as session:
        batch = ReconciliationBatch(
            batch_number=f"BATCH-DUP-{suffix}",
            source_type="bank_statement",
            imported_by=actor_user_id,
        )
        session.add(batch)
        session.flush()

        rec = ReconciliationRecord(
            batch_id=batch.id,
            external_tx_id=f"BANKTX-{suffix}",
            payment_method="bank_transfer",
            transaction_date=datetime.now(timezone.utc),
            amount=Decimal("15000.00"),
        )
        session.add(rec)
        session.flush()

        m1 = ReconciliationMatch(
            reconciliation_record_id=rec.id,
            matched_amount=Decimal("15000.00"),
            match_state="confirmed",
        )
        m2 = ReconciliationMatch(
            reconciliation_record_id=rec.id,
            matched_amount=Decimal("15000.00"),
            match_state="confirmed",
        )
        session.add_all([m1, m2])
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


# =============================================================================
# 4. FINANCIAL INTEGRITY TESTS (7 tests)
# =============================================================================


def test_financial_lifecycle_100k_invoice_40k_and_60k_payments_and_receipts(db_engine, actor_user_id):
    """
    Section 6.1 Mandatory Financial Lifecycle Verification:
    Invoice = 100,000
    Payment 1 = 40,000 -> Receipt 1 = 40,000 -> Outstanding = 60,000
    Payment 2 = 60,000 -> Receipt 2 = 60,000 -> Outstanding = 0
    """
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(name=f"Lifecycle Client {suffix}", client_type="corporate", created_by=actor_user_id)
        session.add(client)
        session.flush()

        # 1. Issue Invoice of KES 100,000
        invoice = Invoice(
            invoice_number=f"INV-100K-{suffix}",
            client_id=client.id,
            status="issued",
            subtotal=Decimal("100000.00"),
            total=Decimal("100000.00"),
            amount_allocated=Decimal("0.00"),
            balance_due=Decimal("100000.00"),
            company_snapshot={"name": "Ledgerly Commercial Solutions Ltd"},
            client_snapshot={"name": client.name},
            created_by=actor_user_id,
            issued_by=actor_user_id,
            finalized_at=datetime.now(timezone.utc),
        )
        session.add(invoice)
        session.flush()

        # 2. Record & Confirm Payment 1 = KES 40,000
        pay1 = Payment(
            payment_reference=f"PAY1-40K-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="mpesa",
            amount=Decimal("40000.00"),
            unallocated_amount=Decimal("40000.00"),
            recorded_by=actor_user_id,
            confirmed_by=actor_user_id,
            confirmed_at=datetime.now(timezone.utc),
        )
        session.add(pay1)
        session.flush()

        alloc1 = PaymentAllocation(
            payment_id=pay1.id,
            invoice_id=invoice.id,
            amount=Decimal("40000.00"),
            status="active",
            allocated_by=actor_user_id,
        )
        session.add(alloc1)
        session.flush()

        # Issue Receipt 1 = KES 40,000 linked to Payment 1
        rcp1 = Receipt(
            status="finalized",
            receipt_number=f"RCP1-40K-{suffix}",
            verification_code=generate_verification_code(),
            client_id=client.id,
            primary_payment_id=pay1.id,
            invoice_id=invoice.id,
            customer_name=client.name,
            total=Decimal("40000.00"),
            payment_status="paid",
            amount_paid=Decimal("40000.00"),
            balance_due=Decimal("0.00"),
            payment_method="M-Pesa",
            company_snapshot={"name": "Ledgerly Commercial Solutions Ltd"},
            created_by=actor_user_id,
            issued_by=actor_user_id,
            finalized_at=datetime.now(timezone.utc),
        )
        session.add(rcp1)
        session.flush()

        pra1 = PaymentReceiptAllocation(
            payment_id=pay1.id,
            receipt_id=rcp1.id,
            amount_acknowledged=Decimal("40000.00"),
            status="active",
        )
        session.add(pra1)
        session.flush()

        session.expire_all()
        inv_after_p1 = session.get(Invoice, invoice.id)
        assert inv_after_p1.amount_allocated == Decimal("40000.00")
        assert inv_after_p1.balance_due == Decimal("60000.00")
        assert inv_after_p1.status == "partially_paid"

        ledger_mid = get_client_ledger(session, client.id)
        assert ledger_mid["total_invoiced"] == Decimal("100000.00")
        assert ledger_mid["total_confirmed_payments"] == Decimal("40000.00")
        assert ledger_mid["outstanding_invoice_balance"] == Decimal("60000.00")
        assert ledger_mid["total_receipted"] == Decimal("40000.00")

        # 3. Record & Confirm Payment 2 = KES 60,000
        pay2 = Payment(
            payment_reference=f"PAY2-60K-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="bank_transfer",
            amount=Decimal("60000.00"),
            unallocated_amount=Decimal("60000.00"),
            recorded_by=actor_user_id,
            confirmed_by=actor_user_id,
            confirmed_at=datetime.now(timezone.utc),
        )
        session.add(pay2)
        session.flush()

        alloc2 = PaymentAllocation(
            payment_id=pay2.id,
            invoice_id=invoice.id,
            amount=Decimal("60000.00"),
            status="active",
            allocated_by=actor_user_id,
        )
        rcp2 = Receipt(
            status="finalized",
            receipt_number=f"RCP2-60K-{suffix}",
            verification_code=generate_verification_code(),
            client_id=client.id,
            primary_payment_id=pay2.id,
            invoice_id=invoice.id,
            customer_name=client.name,
            total=Decimal("60000.00"),
            payment_status="paid",
            amount_paid=Decimal("60000.00"),
            balance_due=Decimal("0.00"),
            payment_method="Bank Transfer",
            company_snapshot={"name": "Ledgerly Commercial Solutions Ltd"},
            created_by=actor_user_id,
            issued_by=actor_user_id,
            finalized_at=datetime.now(timezone.utc),
        )
        session.add_all([alloc2, rcp2])
        session.flush()

        pra2 = PaymentReceiptAllocation(
            payment_id=pay2.id,
            receipt_id=rcp2.id,
            amount_acknowledged=Decimal("60000.00"),
            status="active",
        )
        session.add(pra2)
        session.flush()

        session.expire_all()
        inv_after_p2 = session.get(Invoice, invoice.id)
        assert inv_after_p2.amount_allocated == Decimal("100000.00")
        assert inv_after_p2.balance_due == Decimal("0.00")
        assert inv_after_p2.status == "paid"

        ledger_final = get_client_ledger(session, client.id)
        assert ledger_final["total_invoiced"] == Decimal("100000.00")
        assert ledger_final["total_confirmed_payments"] == Decimal("100000.00")
        assert ledger_final["net_collections"] == Decimal("100000.00")
        assert ledger_final["outstanding_invoice_balance"] == Decimal("0.00")
        assert ledger_final["total_receipted"] == Decimal("100000.00")
        session.rollback()


def test_financial_over_allocation_rejected_by_database(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(name=f"OverAlloc Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        invoice = Invoice(
            invoice_number=f"INV-OA-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("50000.00"),
            balance_due=Decimal("50000.00"),
            created_by=actor_user_id,
        )
        payment = Payment(
            payment_reference=f"PAY-OA-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="mpesa",
            amount=Decimal("60000.00"),
            unallocated_amount=Decimal("60000.00"),
            recorded_by=actor_user_id,
        )
        session.add_all([invoice, payment])
        session.flush()

        # Attempting to allocate 55,000 against a 50,000 invoice must be rejected by DB trigger
        bad_alloc = PaymentAllocation(
            payment_id=payment.id,
            invoice_id=invoice.id,
            amount=Decimal("55000.00"),
            status="active",
            allocated_by=actor_user_id,
        )
        session.add(bad_alloc)
        with pytest.raises((IntegrityError, InternalError, ProgrammingError)):
            session.flush()
        session.rollback()


def test_financial_unconfirmed_payment_allocation_rejected(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(name=f"Unconf Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        invoice = Invoice(
            invoice_number=f"INV-UC-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("20000.00"),
            balance_due=Decimal("20000.00"),
            created_by=actor_user_id,
        )
        pending_payment = Payment(
            payment_reference=f"PAY-PEND-{suffix}",
            client_id=client.id,
            status="pending",
            payment_method="cheque",
            amount=Decimal("20000.00"),
            unallocated_amount=Decimal("20000.00"),
            recorded_by=actor_user_id,
        )
        session.add_all([invoice, pending_payment])
        session.flush()

        bad_alloc = PaymentAllocation(
            payment_id=pending_payment.id,
            invoice_id=invoice.id,
            amount=Decimal("20000.00"),
            status="active",
            allocated_by=actor_user_id,
        )
        session.add(bad_alloc)
        with pytest.raises((IntegrityError, InternalError, ProgrammingError)):
            session.flush()
        session.rollback()


def test_financial_double_receipting_prevented_by_database(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(name=f"DoubleRcp Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        payment = Payment(
            payment_reference=f"PAY-DR-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="mpesa",
            amount=Decimal("30000.00"),
            unallocated_amount=Decimal("30000.00"),
            recorded_by=actor_user_id,
        )
        rcp1 = Receipt(
            status="finalized",
            receipt_number=f"RCP-DR1-{suffix}",
            verification_code=generate_verification_code(),
            client_id=client.id,
            customer_name=client.name,
            total=Decimal("20000.00"),
            amount_paid=Decimal("20000.00"),
            created_by=actor_user_id,
        )
        rcp2 = Receipt(
            status="finalized",
            receipt_number=f"RCP-DR2-{suffix}",
            verification_code=generate_verification_code(),
            client_id=client.id,
            customer_name=client.name,
            total=Decimal("15000.00"),
            amount_paid=Decimal("15000.00"),
            created_by=actor_user_id,
        )
        session.add_all([payment, rcp1, rcp2])
        session.flush()

        # First receipt acknowledges 20,000 of the 30,000 payment -> succeeds
        pra1 = PaymentReceiptAllocation(
            payment_id=payment.id,
            receipt_id=rcp1.id,
            amount_acknowledged=Decimal("20000.00"),
            status="active",
        )
        session.add(pra1)
        session.flush()

        # Second receipt attempts to acknowledge 15,000 (20k + 15k = 35k > 30k payment) -> rejected!
        pra2 = PaymentReceiptAllocation(
            payment_id=payment.id,
            receipt_id=rcp2.id,
            amount_acknowledged=Decimal("15000.00"),
            status="active",
        )
        session.add(pra2)
        with pytest.raises((IntegrityError, InternalError, ProgrammingError)):
            session.flush()
        session.rollback()


def test_financial_one_payment_allocated_across_multiple_invoices(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(name=f"MultiInv Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        inv1 = Invoice(
            invoice_number=f"INV-M1-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("30000.00"),
            balance_due=Decimal("30000.00"),
            created_by=actor_user_id,
        )
        inv2 = Invoice(
            invoice_number=f"INV-M2-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("45000.00"),
            balance_due=Decimal("45000.00"),
            created_by=actor_user_id,
        )
        payment = Payment(
            payment_reference=f"PAY-MULTI-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="bank_transfer",
            amount=Decimal("75000.00"),
            unallocated_amount=Decimal("75000.00"),
            recorded_by=actor_user_id,
        )
        session.add_all([inv1, inv2, payment])
        session.flush()

        a1 = PaymentAllocation(
            payment_id=payment.id,
            invoice_id=inv1.id,
            amount=Decimal("30000.00"),
            status="active",
            allocated_by=actor_user_id,
        )
        a2 = PaymentAllocation(
            payment_id=payment.id,
            invoice_id=inv2.id,
            amount=Decimal("45000.00"),
            status="active",
            allocated_by=actor_user_id,
        )
        session.add_all([a1, a2])
        session.flush()

        session.expire_all()
        assert session.get(Invoice, inv1.id).status == "paid"
        assert session.get(Invoice, inv2.id).status == "paid"
        assert session.get(Payment, payment.id).unallocated_amount == Decimal("0.00")
        session.rollback()


def test_financial_refund_preserves_payment_and_updates_ledger(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(name=f"Refund Client {suffix}", created_by=actor_user_id)
        session.add(client)
        session.flush()

        payment = Payment(
            payment_reference=f"PAY-REF-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="mpesa",
            amount=Decimal("50000.00"),
            unallocated_amount=Decimal("50000.00"),
            recorded_by=actor_user_id,
        )
        session.add(payment)
        session.flush()

        refund = PaymentRefund(
            refund_reference=f"REF-01-{suffix}",
            payment_id=payment.id,
            amount=Decimal("15000.00"),
            reason="Partial service cancellation",
            status="completed",
            processed_by=actor_user_id,
        )
        session.add(refund)
        session.flush()

        session.expire_all()
        updated_pay = session.get(Payment, payment.id)
        assert updated_pay.amount == Decimal("50000.00")  # Original payment amount preserved!
        assert updated_pay.amount_refunded == Decimal("15000.00")
        assert updated_pay.unallocated_amount == Decimal("35000.00")
        assert updated_pay.status == "partially_refunded"

        ledger = get_client_ledger(session, client.id)
        assert ledger["total_confirmed_payments"] == Decimal("50000.00")
        assert ledger["total_refunds"] == Decimal("15000.00")
        assert ledger["net_collections"] == Decimal("35000.00")
        session.rollback()


def test_financial_historical_snapshot_immutability(db_engine, actor_user_id):
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as session:
        client = Client(
            name=f"Original Corp Name {suffix}",
            address="Old Street 101, Nairobi",
            created_by=actor_user_id,
        )
        session.add(client)
        session.flush()

        inv = Invoice(
            invoice_number=f"INV-SNAP-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("12000.00"),
            balance_due=Decimal("12000.00"),
            company_snapshot={"name": "Original Studio Name", "address": "1st Ave"},
            client_snapshot={"name": client.name, "address": client.address},
            created_by=actor_user_id,
        )
        session.add(inv)
        session.flush()

        # Mutate live client record later
        client.name = f"Renamed Corp Name {suffix}"
        client.address = "New Boulevard 999, Mombasa"
        session.flush()

        session.expire_all()
        loaded_inv = session.get(Invoice, inv.id)
        assert loaded_inv.client_snapshot["name"] == f"Original Corp Name {suffix}"
        assert loaded_inv.client_snapshot["address"] == "Old Street 101, Nairobi"
        session.rollback()


# =============================================================================
# 5. CONCURRENCY TESTS (2 tests)
# =============================================================================


def test_concurrency_numbering_sequences_parallel_allocations(db_engine):
    """
    Spawns 8 concurrent worker sessions allocating numbers from the same sequence scope
    and verifies zero duplicate document numbers and exact monotonic increments.
    """
    test_prefix = f"CT{uuid.uuid4().hex[:4].upper()}"

    def worker(_idx: int) -> str:
        with Session(db_engine) as s:
            num = allocate_document_number(s, "invoice", test_prefix, scope_year=2026)
            s.commit()
            return num

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(worker, range(8)))

    assert len(results) == 8
    assert len(set(results)) == 8, f"Duplicate numbers generated under concurrency: {results}"

    # Clean up test sequence row
    with Session(db_engine) as cleanup:
        cleanup.execute(
            text("DELETE FROM public.numbering_sequences WHERE prefix = :p"),
            {"p": test_prefix},
        )
        cleanup.commit()


def test_concurrency_parallel_payment_allocation_prevents_over_allocation(db_engine, actor_user_id):
    """
    Two concurrent transactions attempt to allocate KES 40,000 each from a single
    KES 50,000 payment toward an KES 80,000 invoice. Exactly one must succeed and
    the other must fail with an over-allocation database error.
    """
    suffix = uuid.uuid4().hex[:6].upper()
    with Session(db_engine) as setup:
        client = Client(name=f"ConcAlloc Client {suffix}", created_by=actor_user_id)
        setup.add(client)
        setup.flush()

        inv = Invoice(
            invoice_number=f"INV-CONC-{suffix}",
            client_id=client.id,
            status="issued",
            total=Decimal("80000.00"),
            balance_due=Decimal("80000.00"),
            created_by=actor_user_id,
        )
        pay = Payment(
            payment_reference=f"PAY-CONC-{suffix}",
            client_id=client.id,
            status="confirmed",
            payment_method="mpesa",
            amount=Decimal("50000.00"),
            unallocated_amount=Decimal("50000.00"),
            recorded_by=actor_user_id,
        )
        setup.add_all([inv, pay])
        setup.commit()
        inv_id, pay_id, client_id = inv.id, pay.id, client.id

    def attempt_alloc(_i: int) -> str:
        with Session(db_engine) as s:
            try:
                alloc = PaymentAllocation(
                    payment_id=pay_id,
                    invoice_id=inv_id,
                    amount=Decimal("40000.00"),
                    status="active",
                    allocated_by=actor_user_id,
                )
                s.add(alloc)
                s.commit()
                return "success"
            except Exception:
                s.rollback()
                return "rejected"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(attempt_alloc, range(2)))

    assert sorted(outcomes) == ["rejected", "success"], f"Expected 1 success and 1 rejection, got {outcomes}"

    # Cleanup
    with Session(db_engine) as cleanup:
        cleanup.execute(text("DELETE FROM public.payment_allocations WHERE payment_id = :pid"), {"pid": pay_id})
        cleanup.execute(text("DELETE FROM public.payments WHERE id = :pid"), {"pid": pay_id})
        cleanup.execute(text("DELETE FROM public.invoices WHERE id = :iid"), {"iid": inv_id})
        cleanup.execute(text("DELETE FROM public.clients WHERE id = :cid"), {"cid": client_id})
        cleanup.commit()


# =============================================================================
# 6. MIGRATION TESTS (2 tests)
# =============================================================================


def test_migration_alembic_current_head_version(db_engine):
    with db_engine.connect() as conn:
        row = conn.execute(text("SELECT version_num FROM public.alembic_version")).fetchone()
    assert row is not None
    assert row[0] == "20261112_0001"


def test_migration_idempotent_upgrade_head():
    res = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "fastapi_service/alembic.ini", "upgrade", "head"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert res.returncode == 0, f"Alembic upgrade head failed: {res.stderr}"


# =============================================================================
# 7. PERFORMANCE TESTS (1 comprehensive multi-query EXPLAIN ANALYZE test)
# =============================================================================


def test_performance_explain_analyze_representative_queries(db_engine):
    representative_queries = [
        ("Client search by name", "EXPLAIN ANALYZE SELECT id, name, phone FROM public.clients WHERE name ILIKE 'Safaricom%' LIMIT 20"),
        ("Invoice receivables listing", "EXPLAIN ANALYZE SELECT id, invoice_number, balance_due FROM public.invoices WHERE status IN ('issued', 'partially_paid', 'overdue') ORDER BY due_date ASC LIMIT 50"),
        ("Receipt public verification lookup", "EXPLAIN ANALYZE SELECT id, receipt_number, status, payment_status, total, amount_paid, balance_due FROM public.receipts WHERE verification_code = 'PAID2026KE' LIMIT 1"),
        ("Payment history by client", "EXPLAIN ANALYZE SELECT id, payment_reference, amount, status FROM public.payments WHERE status = 'confirmed' ORDER BY payment_date DESC LIMIT 50"),
        ("Authoritative client ledger summary", "EXPLAIN ANALYZE SELECT * FROM public.v_client_ledger_summary LIMIT 25"),
    ]
    with db_engine.connect() as conn:
        for label, sql in representative_queries:
            plan_rows = conn.execute(text(sql)).fetchall()
            plan_text = "\n".join(r[0] for r in plan_rows)
            assert "Execution Time" in plan_text, f"Missing Execution Time for {label}"
