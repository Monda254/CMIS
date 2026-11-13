# MP-14 · Deliverable 5: Identifier, Migration, Security, Performance & Open Decisions

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-14

---

## 1. Identifier & Concurrency-Safe Numbering Strategy (`Section 8`)

### 1.1 Internal Primary Keys: UUIDv4 vs UUIDv7 Evaluation
- **Current PostgreSQL Engine:** Supabase PostgreSQL 15/17 (`gen_random_uuid()` native C function).
- **Decision:** All entity primary keys use native `UUID DEFAULT gen_random_uuid()` (UUIDv4) for zero-extension database-level generation, while Python/SQLAlchemy model factories support time-ordered UUID generation where sequential B-tree locality is beneficial. High-velocity append-only tables (`audit_logs`, `verify_attempts`) use `BIGINT GENERATED ALWAYS AS IDENTITY` for optimal B-tree append performance.
- **Separation of Concerns:** Internal `UUID` keys are never used as human-facing document numbers.

### 1.2 Concurrency-Safe Business Document Numbering (`numbering_sequences`)
Human-readable numbers (`QTN-2026-000001`, `INV-2026-000001`, `PAY-2026-000001`, `RCP-2026-000101`, `REF-2026-000001`) are allocated atomically inside the finalization transaction using PostgreSQL's row-locking upsert:

```sql
INSERT INTO public.numbering_sequences (document_type, prefix, scope_year, last_value, padding_length)
VALUES (:doc_type, :prefix, :year, 1, 6)
ON CONFLICT (document_type, prefix, scope_year)
DO UPDATE SET
    last_value = public.numbering_sequences.last_value + 1,
    updated_at = now()
RETURNING last_value, padding_length;
```

**Why this is 100% concurrency-safe:**
1. PostgreSQL acquires a row-level exclusive lock on the `(document_type, prefix, scope_year)` row during `DO UPDATE`.
2. Concurrent transactions finalizing documents of the same type serialize cleanly on that single counter row without deadlocks or duplicate numbers.
3. If a transaction rolls back, its sequence increment rolls back with it — preventing sequence gaps on failed finalizations.
4. Every document table also enforces a database-level `UNIQUE` constraint on its document number column (`quote_number`, `invoice_number`, `payment_reference`, `receipt_number`, `verification_code`) as a second line of defense.

---

## 2. Alembic Migration Architecture & Procedures (`Section 12.1 & 16.5`)

### 2.1 Directory Layout
```text
fastapi_service/
├── alembic.ini
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 20261112_0001_mp14_canonical_ibms_schema.py
├── database.py
├── models/
│   ├── __init__.py
│   ├── base.py
│   ├── identity.py
│   ├── settings.py
│   ├── crm.py
│   ├── quotations.py
│   ├── invoicing.py
│   ├── payments.py
│   ├── receipts.py
│   ├── communications.py
│   └── reconciliation.py
└── services/
    └── financial_service.py
```

### 2.2 Running Migrations
- **Check current revision:**
  ```bash
  .venv/bin/alembic -c fastapi_service/alembic.ini current
  ```
- **Upgrade to latest (`head`):**
  ```bash
  .venv/bin/alembic -c fastapi_service/alembic.ini upgrade head
  ```
- **Downgrade one revision (non-destructive to pre-existing baseline tables):**
  ```bash
  .venv/bin/alembic -c fastapi_service/alembic.ini downgrade -1
  ```

### 2.3 Rollback & Data Preservation Policy
- Revision `20261112_0001` is written idempotently (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DO $$ ... $$`) so it upgrades cleanly on both a brand-new PostgreSQL database and the existing live Supabase database containing the initial 9 receipt/client tables.
- Its `downgrade()` function drops only the newly introduced IBMS expansion views, triggers, and tables in reverse dependency order while **never** dropping the pre-existing production tables (`users`, `sessions`, `company_settings`, `clients`, `receipt_sequences`, `receipts`, `receipt_items`, `audit_logs`, `verify_attempts`).

---

## 3. Database Security & Privacy Design (`Section 11 & 16.8`)

1. **Row-Level Security (RLS) on All Public Tables:**
   - Every table in `public` has `ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;` enabled so Supabase's public PostgREST / Data API (`anon` key) cannot read or mutate internal tables directly.
   - All legitimate application traffic flows through the authenticated Next.js / FastAPI server connection using server-validated sessions and RBAC checks.
2. **Public Verification Boundary (`/api/public/verify`):**
   - Queries only `receipts` and `verify_attempts`.
   - Returns **only** the public verification projection (`receipt_number`, `code_hint`, `customer_name`, `issued_at`, `total`, `amount_paid`, `balance_due`, `payment_status`, `payment_method`, `currency`, `company_snapshot.name`).
   - Internal CRM notes, client phone numbers, client addresses, tax PINs, contact lists, and staff user IDs are **never** returned by public verification queries.
3. **Credential & Token Protection:**
   - User passwords are hashed with `scrypt` (`password_hash`).
   - Session tokens and password reset tokens are stored as `SHA-256` hex digests (`sessions.id`, `users.reset_token_hash`).
   - Caller IP addresses in `sessions` and `verify_attempts` are hashed (`SHA-256`) for privacy compliance.
   - `payments` strictly prohibits storing PAN/card numbers or CVV values.

---

## 4. Index Strategy & Query Performance Findings (`Section 9.2, 13 & 16.7`)

### 4.1 Key Composite & Partial Indexes Implemented
| Index Name | Table | Columns / Expression | Query Pattern Optimized |
|---|---|---|---|
| `idx_invoices_client_status` | `invoices` | `(client_id, status, due_date)` | Client statement & overdue receivables lookup. |
| `idx_payments_client_status_date` | `payments` | `(client_id, status, payment_date DESC)` | Client payment history & daily/monthly cash collection reports. |
| `idx_payment_alloc_invoice` | `payment_allocations` | `(invoice_id, status)` | Summing active allocations per invoice. |
| `idx_payment_alloc_payment` | `payment_allocations` | `(payment_id, status)` | Summing active allocations per payment. |
| `uq_payment_receipt_active` | `payment_receipt_allocations` | `(payment_id, receipt_id) WHERE status = 'active'` | Preventing duplicate active link between same payment and receipt. |
| `uq_recon_record_confirmed` | `reconciliation_matches` | `(reconciliation_record_id) WHERE match_state = 'confirmed'` | Preventing double reconciliation of external statement lines. |
| `receipts_status_finalized_idx` | `receipts` | `(status, finalized_at)` | Date-range finalized receipt reporting & dashboard KPIs. |

---

## 5. Open Database Decisions Register (`Rule 8 & Section 21.10`)

In accordance with **Rule 8 (Do not invent business decisions)** and **Rule 9 (No speculative integrations)**, the following items are recorded in the Open Decisions Register without introducing speculative tables:

| # | Decision Topic | Current Database Design | Open Business Question for Future Confirmation |
|---:|---|---|---|
| 1 | **Multi-Company / Multi-Branch Support** | Single-company canonical setup (`company_settings.id = 1`). | If multi-branch or multi-tenant operation is required in a future release, a nullable/required `branch_id` or `organization_id` foreign key can be added to transactional tables. |
| 2 | **Multi-Currency Exchange Rates** | Every document (`quotes`, `invoices`, `payments`, `receipts`) stores an ISO 4217 `currency` code (`DEFAULT 'KES'`), and triggers enforce that allocations match the target document's currency. | Cross-currency allocation (e.g., USD payment settling a KES invoice) requires an approved exchange-rate table (`fx_rates`) and realized gain/loss policy before enabling. |
| 3 | **Credit Notes vs Invoice Adjustments** | Invoice cancellations/voids and payment refunds (`payment_refunds`) are implemented. | Formal tax credit notes (`credit_notes`) are deferred until the business confirms its statutory credit-note workflow. |
| 4 | **KRA eTIMS Compliance Integration** | `tax_configurations` supports VAT/withholding/exempt rates and snapshots on line items. | No speculative eTIMS control-unit tables were created; once the official KRA eTIMS integration route (OSCU vs VSCU) is confirmed, an `etims_submissions` table can be added via Alembic. |
| 5 | **Automated M-Pesa Daraja / Payment Webhooks** | `payments.external_reference` and `reconciliation_records` support M-Pesa receipt codes (`external_tx_id`). | Live Daraja STK Push / C2B webhook payload staging tables should only be added when API credentials and callback workflows are authorized. |
