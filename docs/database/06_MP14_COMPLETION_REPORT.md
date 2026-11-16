# MP-14 — MANDATORY DATABASE COMPLETION REPORT

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-14  
**Version:** 1.0  
**Development Area:** Database Architecture & Engineering  
**Primary Database:** PostgreSQL (Supabase PostgreSQL 17 / Pooler `aws-0-eu-west-2.pooler.supabase.com:6543`)  
**Backend ORM:** SQLAlchemy 2.x (`2.1.8`)  
**Migration Tool:** Alembic (`1.20.1`)  
**Backend Framework:** FastAPI  
**Frontend:** Next.js + React + TypeScript  
**Architecture:** Modular Monolith  
**Status:** COMPLETED & VERIFIED (`25 / 25` PostgreSQL Tests Passing)

---

## 21.1 Assignment overview

- **Prompt ID:** `MP-14`
- **Assignment title:** Database Architecture & Engineering Master Prompt
- **Objective:** Design, model, migrate, document, and test a canonical, normalized, auditable, concurrency-safe, and financially rigorous PostgreSQL database architecture supporting all 13 functional modules of the Integrated Business Management System (IBMS).
- **Repository inspected:** `/home/monda/CMISP`
- **Existing architecture discovered:**
  - Next.js App Router (`src/`) with Drizzle ORM (`drizzle/schema.ts`, `drizzle/migrations/0000_migration.sql`) and a companion FastAPI service (`fastapi_service/main.py`) connected to a shared Supabase PostgreSQL database (`public` schema).
  - Pre-existing baseline tables (`9` tables): `users`, `sessions`, `company_settings`, `clients`, `receipt_sequences`, `receipts`, `receipt_items`, `audit_logs`, and `verify_attempts`.
- **Scope completed:**
  - Established the unified `37`-table canonical domain model in `public` across all 13 functional modules while preserving 100% backward compatibility with the 9 baseline tables and existing live records.
  - Authored modular SQLAlchemy 2.x models across `9` domain modules (`fastapi_service/models/*.py`) and database session/engine factories (`fastapi_service/database.py`).
  - Implemented and applied the idempotent Alembic schema migration (`20261112_0001`), including database-level `CHECK` constraints, partial/composite indexes, Row-Level Security (RLS) on all 37 tables, three PL/pgSQL financial integrity triggers (`fn_sync_payment_allocation`, `fn_sync_payment_receipt_allocation`, `fn_sync_payment_refund`), and the authoritative derived client ledger view (`v_client_ledger_summary`).
  - Implemented concurrency-safe numbering and ledger query primitives in `fastapi_service/services/financial_service.py`.
  - Delivered all 6 comprehensive database architecture documents in `docs/database/` and verified 25 live PostgreSQL tests in `tests/test_mp14_database.py`.

---

## 21.2 Canonical data model

### Implemented Canonical Entities (`37` Tables in `public`)

| # | Entity (`public.<table_name>`) | Business Purpose | Primary Key | Important Foreign Keys | Main Relationships | Important Constraints |
|---:|---|---|---|---|---|---|
| 1 | `users` | Staff user accounts, authentication credentials, and active status | `id (UUID)` | — | `1:N` `sessions`, `1:N` `user_roles`, `1:N` `audit_logs` | `UNIQUE (email)`, `users_email_idx` |
| 2 | `roles` | Named RBAC role definitions across all modules | `id (UUID)` | — | `1:N` `user_roles`, `1:N` `role_permissions` | `UNIQUE (code)` |
| 3 | `permissions` | Granular `module:action` application capabilities | `id (UUID)` | — | `1:N` `role_permissions` | `UNIQUE (code)`, `idx_permissions_module` |
| 4 | `user_roles` | Many-to-many assignment of staff users to roles | `(user_id, role_id)` | `user_id -> users.id (CASCADE)`, `role_id -> roles.id (CASCADE)`, `assigned_by -> users.id (SET NULL)` | Bridges `users` and `roles` | Composite PK `(user_id, role_id)` |
| 5 | `role_permissions` | Many-to-many mapping of roles to permissions | `(role_id, permission_id)` | `role_id -> roles.id (CASCADE)`, `permission_id -> permissions.id (CASCADE)` | Bridges `roles` and `permissions` | Composite PK `(role_id, permission_id)` |
| 6 | `sessions` | Server-managed HTTP-only session records | `id (TEXT)` | `user_id -> users.id (CASCADE)` | `N:1` `users` | `id` stores `SHA-256` token digest; `sessions_expires_at_idx` |
| 7 | `audit_logs` | Immutable security and financial audit trail with before/after state | `id (BIGINT IDENTITY)` | `actor_id -> users.id (SET NULL)` | `N:1` `users` | `CHECK (outcome IN ('success','failure','denied'))`, `idx_audit_logs_resource` |
| 8 | `company_settings` | Singleton organization profile, branding references, currency & prefixes | `id (INT = 1)` | `updated_by -> users.id (SET NULL)` | Referenced by document snapshot builders | `CHECK (id = 1)` (`chk_company_settings_singleton`) |
| 9 | `file_metadata` | Secure metadata registry for logos, stamps, signatures, PDFs, client docs | `id (UUID)` | `uploaded_by -> users.id (SET NULL)` | `1:N` `client_documents` | `UNIQUE (storage_key)`, `CHECK (file_size_bytes >= 0)`, `chk_file_metadata_classification` |
| 10 | `document_templates` | Configurable layout, terms, and branding templates | `id (UUID)` | `updated_by -> users.id (SET NULL)` | Used by quote/invoice/receipt renderers | `CHECK (document_type IN ('quote','invoice','receipt'))` |
| 11 | `numbering_sequences` | Concurrency-safe atomic counters per document type, prefix, and year | `(document_type, prefix, scope_year)` | — | Standalone atomic counter table | `CHECK (last_value >= 0)`, `CHECK (padding_length BETWEEN 3 AND 12)` |
| 12 | `receipt_sequences` | Preserved legacy yearly receipt counter table | `(prefix, year)` | — | Standalone receipt counter table | Composite PK `(prefix, year)` |
| 13 | `tax_configurations` | Tax codes, rates (`NUMERIC(6,4)`), inclusion behavior, and effective dates | `id (UUID)` | `created_by -> users.id (SET NULL)` | `1:N` `quote_items`, `1:N` `invoice_items` | `UNIQUE (code)`, `CHECK (rate >= 0 AND rate <= 100)`, `chk_tax_config_dates` |
| 14 | `client_categories` | Client segmentation tiers (`Enterprise`, `SME`, `Individual`, etc.) | `id (UUID)` | — | `1:N` `clients` | `UNIQUE (code)` |
| 15 | `clients` | Canonical customer/client entity across CRM and all financial modules | `id (UUID)` | `category_id -> client_categories.id (SET NULL)`, `created_by -> users.id (SET NULL)` | `1:N` `client_contacts`, `1:N` `quotes`, `1:N` `invoices`, `1:N` `payments`, `1:N` `receipts` | `UNIQUE (client_code)`, `chk_clients_type`, `chk_clients_status` |
| 16 | `client_contacts` | Multiple contact persons per corporate or individual client | `id (UUID)` | `client_id -> clients.id (CASCADE)` | `N:1` `clients`, `1:N` `client_interactions` | `idx_client_contacts_client` |
| 17 | `client_tags` | Reusable CRM classification tags | `id (UUID)` | — | `1:N` `client_tag_assignments` | `UNIQUE (name)` |
| 18 | `client_tag_assignments` | Many-to-many junction linking clients to tags | `(client_id, tag_id)` | `client_id -> clients.id (CASCADE)`, `tag_id -> client_tags.id (CASCADE)` | Bridges `clients` and `client_tags` | Composite PK `(client_id, tag_id)` |
| 19 | `client_interactions` | Logged calls, meetings, emails, follow-ups, requirements, and notes | `id (UUID)` | `client_id -> clients.id (CASCADE)`, `contact_id -> client_contacts.id (SET NULL)`, `logged_by -> users.id (SET NULL)` | `N:1` `clients` | `chk_client_interactions_type`, `idx_client_interactions_client_date` |
| 20 | `client_documents` | Links clients to contracts, proposals, SLAs, and KYC files | `id (UUID)` | `client_id -> clients.id (CASCADE)`, `file_id -> file_metadata.id (RESTRICT)` | `N:1` `clients`, `N:1` `file_metadata` | `chk_client_documents_category` |
| 21 | `quotes` | Commercial quotations/proposals with conversion lineage and snapshots | `id (UUID)` | `client_id -> clients.id (RESTRICT)`, `created_by -> users.id (RESTRICT)`, `finalized_by -> users.id (SET NULL)` | `N:1` `clients`, `1:N` `quote_items`, `1:N` `invoices` | `UNIQUE (quote_number)`, `chk_quotes_status`, `chk_quotes_amounts`, `chk_quotes_dates` |
| 22 | `quote_items` | Ordered line items belonging to a quotation | `id (UUID)` | `quote_id -> quotes.id (CASCADE)`, `tax_config_id -> tax_configurations.id (SET NULL)` | `N:1` `quotes`, `N:1` `tax_configurations` | `CHECK (quantity > 0)`, `chk_quote_items_prices`, `chk_quote_items_totals` |
| 23 | `invoices` | Accounts receivable billing documents with allocation & balance tracking | `id (UUID)` | `client_id -> clients.id (RESTRICT)`, `quote_id -> quotes.id (SET NULL)`, `created_by -> users.id (RESTRICT)` | `N:1` `clients`, `N:1` `quotes`, `1:N` `invoice_items`, `1:N` `payment_allocations` | `UNIQUE (invoice_number)`, `chk_invoices_balance_equation`, `chk_invoices_allocated_bounds` |
| 24 | `invoice_items` | Ordered line items belonging to an invoice | `id (UUID)` | `invoice_id -> invoices.id (CASCADE)`, `tax_config_id -> tax_configurations.id (SET NULL)` | `N:1` `invoices`, `N:1` `tax_configurations` | `CHECK (quantity > 0)`, `chk_invoice_items_prices`, `chk_invoice_items_totals` |
| 25 | `payments` | Canonical record of actual money received (`confirmed`, `pending`, etc.) | `id (UUID)` | `client_id -> clients.id (RESTRICT)`, `recorded_by -> users.id (RESTRICT)`, `confirmed_by -> users.id (SET NULL)` | `N:1` `clients`, `1:N` `payment_allocations`, `1:N` `payment_refunds`, `1:N` `payment_receipt_allocations` | `UNIQUE (payment_reference)`, `CHECK (amount > 0)`, `chk_payments_allocation_bounds`, `chk_payments_receipt_bounds`, `chk_payments_unallocated_sync` |
| 26 | `payment_allocations` | Allocates portions of confirmed payments to specific invoices | `id (UUID)` | `payment_id -> payments.id (RESTRICT)`, `invoice_id -> invoices.id (RESTRICT)`, `allocated_by -> users.id (RESTRICT)` | `N:1` `payments`, `N:1` `invoices` | `CHECK (amount > 0)`, `CHECK (status IN ('active','reversed'))`, trigger `trg_sync_payment_allocation` |
| 27 | `payment_refunds` | Traceable refund/reversal events preserving original payment records | `id (UUID)` | `payment_id -> payments.id (RESTRICT)`, `processed_by -> users.id (RESTRICT)` | `N:1` `payments` | `UNIQUE (refund_reference)`, `CHECK (amount > 0)`, trigger `trg_sync_payment_refund` |
| 28 | `receipts` | Immutable proof-of-payment documents with public QR verification codes | `id (UUID)` | `client_id -> clients.id`, `primary_payment_id -> payments.id (SET NULL)`, `invoice_id -> invoices.id (SET NULL)`, `created_by -> users.id` | `N:1` `clients`, `1:N` `receipt_items`, `1:N` `payment_receipt_allocations` | `UNIQUE (receipt_number)`, `UNIQUE (verification_code)`, `chk_receipts_amounts_non_negative` |
| 29 | `receipt_items` | Itemized breakdown lines on a receipt | `id (UUID)` | `receipt_id -> receipts.id (CASCADE)` | `N:1` `receipts` | `CHECK (quantity > 0)`, `CHECK (unit_price >= 0 AND line_total >= 0)` |
| 30 | `payment_receipt_allocations` | Explicit M:N coverage mapping how much of a payment is receipted | `id (UUID)` | `payment_id -> payments.id (RESTRICT)`, `receipt_id -> receipts.id (CASCADE)` | Bridges `payments` and `receipts` | `CHECK (amount_acknowledged > 0)`, partial unique `uq_payment_receipt_active`, trigger `trg_sync_payment_receipt_allocation` |
| 31 | `verify_attempts` | Public receipt verification log and rate-limiting ledger (`receipt_verification_logs`) | `id (BIGINT IDENTITY)` | — | Queries by `client_key` and `identifier` | `verify_attempts_client_key_idx`, `verify_attempts_identifier_idx` |
| 32 | `notification_templates` | Reusable email and SMS message templates | `id (UUID)` | — | `1:N` `email_logs`, `1:N` `sms_logs` | `UNIQUE (code)`, `CHECK (channel IN ('email','sms'))` |
| 33 | `email_logs` | Outbound email delivery tracking and status log | `id (UUID)` | `client_id -> clients.id (SET NULL)`, `template_id -> notification_templates.id (SET NULL)`, `triggered_by -> users.id (SET NULL)` | `N:1` `clients`, `N:1` `notification_templates` | `chk_email_logs_status`, `CHECK (attempt_count >= 0)` |
| 34 | `sms_logs` | Outbound SMS delivery tracking and status log | `id (UUID)` | `client_id -> clients.id (SET NULL)`, `template_id -> notification_templates.id (SET NULL)`, `triggered_by -> users.id (SET NULL)` | `N:1` `clients`, `N:1` `notification_templates` | `chk_sms_logs_status`, `CHECK (attempt_count >= 0)` |
| 35 | `reconciliation_batches` | Imported external bank / M-Pesa statement batch headers | `id (UUID)` | `imported_by -> users.id (RESTRICT)` | `1:N` `reconciliation_records` | `UNIQUE (batch_number)`, `chk_recon_batches_source`, `chk_recon_batches_status` |
| 36 | `reconciliation_records` | Normalized external statement lines within a batch | `id (UUID)` | `batch_id -> reconciliation_batches.id (CASCADE)`, `reviewed_by -> users.id (SET NULL)` | `N:1` `reconciliation_batches`, `1:N` `reconciliation_matches` | `UNIQUE (payment_method, external_tx_id)` (`uq_recon_external_source`), `CHECK (amount > 0)` |
| 37 | `reconciliation_matches` | Suggested, confirmed, or rejected matches to internal payments/invoices | `id (UUID)` | `reconciliation_record_id -> reconciliation_records.id (CASCADE)`, `payment_id -> payments.id (RESTRICT)`, `invoice_id -> invoices.id (RESTRICT)` | `N:1` `reconciliation_records`, `N:1` `payments`, `N:1` `invoices` | Partial unique `uq_recon_record_confirmed` (`WHERE match_state = 'confirmed'`) |

### Entities Proposed / Deferred (Not Implemented per Rule 8 & Rule 9)
- **`credit_notes` / `credit_note_items`**: Deferred per Section 5.5 and Rule 8 until the client's statutory tax credit-note workflow is confirmed; invoice cancellations and `payment_refunds` are fully implemented.
- **`etims_submissions` / KRA OSCU-VSCU tables**: Deferred per Section 5.10 and Rule 9 until the official KRA eTIMS integration route is verified.
- **`branches` / `tenants`**: Deferred per Section 5.2 and Rule 8 (single-company setup confirmed for initial release).

---

## 21.3 ERD deliverables

All five required Entity Relationship Diagrams are completed and maintained in Mermaid source format in [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md):

| Diagram Deliverable | Status | File Reference |
|---|---|---|
| 1. High-level domain ERD | **COMPLETED** | [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md#L15-L46) |
| 2. Complete logical ERD | **COMPLETED** | [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md#L50-L100) |
| 3. Physical database ERD | **COMPLETED** | [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md#L104-L251) |
| 4. Financial transaction relationship diagram | **COMPLETED** | [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md#L255-L295) |
| 5. User/role/permission relationship diagram | **COMPLETED** | [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md#L299-L375) |

---

## 21.4 Database implementation

- **SQLAlchemy 2.x models created / updated:**
  - Core DeclarativeBase & Engine Factory: [fastapi_service/database.py](file:///home/monda/CMISP/fastapi_service/database.py)
  - Canonical Model Registry (`37` models): [fastapi_service/models/__init__.py](file:///home/monda/CMISP/fastapi_service/models/__init__.py)
  - Identity, RBAC & Audit (`User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `SessionRecord`, `AuditLog`): [fastapi_service/models/identity.py](file:///home/monda/CMISP/fastapi_service/models/identity.py)
  - Business Settings, Files, Templates, Numbering & Tax (`CompanySettings`, `FileMetadata`, `DocumentTemplate`, `NumberingSequence`, `ReceiptSequence`, `TaxConfiguration`): [fastapi_service/models/settings.py](file:///home/monda/CMISP/fastapi_service/models/settings.py)
  - CRM (`ClientCategory`, `Client`, `ClientContact`, `ClientTag`, `ClientTagAssignment`, `ClientInteraction`, `ClientDocument`): [fastapi_service/models/crm.py](file:///home/monda/CMISP/fastapi_service/models/crm.py)
  - Quotations (`Quote`, `QuoteItem`): [fastapi_service/models/quotations.py](file:///home/monda/CMISP/fastapi_service/models/quotations.py)
  - Invoicing (`Invoice`, `InvoiceItem`): [fastapi_service/models/invoicing.py](file:///home/monda/CMISP/fastapi_service/models/invoicing.py)
  - Payments (`Payment`, `PaymentAllocation`, `PaymentRefund`): [fastapi_service/models/payments.py](file:///home/monda/CMISP/fastapi_service/models/payments.py)
  - Receipts (`Receipt`, `ReceiptItem`, `PaymentReceiptAllocation`, `VerifyAttempt`): [fastapi_service/models/receipts.py](file:///home/monda/CMISP/fastapi_service/models/receipts.py)
  - Communications (`NotificationTemplate`, `EmailLog`, `SmsLog`): [fastapi_service/models/communications.py](file:///home/monda/CMISP/fastapi_service/models/communications.py)
  - Reconciliation (`ReconciliationBatch`, `ReconciliationRecord`, `ReconciliationMatch`): [fastapi_service/models/reconciliation.py](file:///home/monda/CMISP/fastapi_service/models/reconciliation.py)
- **Alembic migrations created:**
  - Configuration: [fastapi_service/alembic.ini](file:///home/monda/CMISP/fastapi_service/alembic.ini) and [fastapi_service/alembic/env.py](file:///home/monda/CMISP/fastapi_service/alembic/env.py)
  - Initial Canonical IBMS Migration (`revision = "20261112_0001"`): [20261112_0001_mp14_canonical_ibms_schema.py](file:///home/monda/CMISP/fastapi_service/alembic/versions/20261112_0001_mp14_canonical_ibms_schema.py)
- **Database constraints implemented:**
  - Singleton constraint on `company_settings (id = 1)`.
  - Positive/non-negative monetary & quantity `CHECK` constraints across `quotes`, `quote_items`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `payment_refunds`, `receipts`, `receipt_items`, `payment_receipt_allocations`, and `reconciliation_*`.
  - Balance equation `CHECK` constraints: `invoices` (`status IN ('cancelled', 'void') OR (amount_allocated + balance_due = total)`) and `payments` (`unallocated_amount = amount - amount_allocated - amount_refunded`, `amount_allocated + amount_refunded <= amount`, `amount_receipted <= amount - amount_refunded`).
  - Partial unique indexes: `uq_payment_receipt_active` on `payment_receipt_allocations(payment_id, receipt_id) WHERE status = 'active'` and `uq_recon_record_confirmed` on `reconciliation_matches(reconciliation_record_id) WHERE match_state = 'confirmed'`.
- **Indexes implemented:**
  - Search, foreign-key, status, date-range, and partial unique indexes across all 37 tables (documented in [05_MIGRATION_SECURITY_AND_PERFORMANCE.md](file:///home/monda/CMISP/docs/database/05_MIGRATION_SECURITY_AND_PERFORMANCE.md)).
- **Numbering strategy implemented:**
  - Concurrency-safe atomic `INSERT ... ON CONFLICT (document_type, prefix, scope_year) DO UPDATE SET last_value = last_value + 1 RETURNING last_value, padding_length` in `allocate_document_number()` ([fastapi_service/services/financial_service.py](file:///home/monda/CMISP/fastapi_service/services/financial_service.py#L27-L62)).
- **Historical snapshot strategy implemented:**
  - Finalized `quotes`, `invoices`, and `receipts` persist point-in-time `company_snapshot` and `client_snapshot` `JSONB` payloads so future edits to live `clients` or `company_settings` rows never alter historical documents.

---

## 21.5 Financial integrity assessment

Documented in [03_FINANCIAL_DATA_MODEL.md](file:///home/monda/CMISP/docs/database/03_FINANCIAL_DATA_MODEL.md) and enforced at the PostgreSQL engine level in [20261112_0001_mp14_canonical_ibms_schema.py](file:///home/monda/CMISP/fastapi_service/alembic/versions/20261112_0001_mp14_canonical_ibms_schema.py#L780-L986):

1. **One invoice with multiple payments & partial payment allocation:**
   - Trigger `trg_sync_payment_allocation` locks both the target `payments` and `invoices` rows (`FOR UPDATE`), sums active `payment_allocations`, updates `invoices.amount_allocated` and `invoices.balance_due = total - amount_allocated`, and transitions `invoices.status` from `'issued'` to `'partially_paid'` (after first payment of `KES 40,000.00` on a `KES 100,000.00` invoice) and `'paid'` (after second payment of `KES 60,000.00`).
   - *Concrete Test Evidence:* `test_financial_lifecycle_100k_invoice_40k_and_60k_payments_and_receipts` (`PASSED`).
2. **One payment allocated across multiple invoices:**
   - A single confirmed `Payment` (`KES 75,000.00`) can have multiple `PaymentAllocation` rows settling `INV-1` (`KES 30,000.00`) and `INV-2` (`KES 45,000.00`), reducing `payment.unallocated_amount` to `0.00` and marking both invoices `'paid'`.
   - *Concrete Test Evidence:* `test_financial_one_payment_allocated_across_multiple_invoices` (`PASSED`).
3. **Prevention of over-allocation and unconfirmed payment allocation:**
   - `fn_sync_payment_allocation` raises a PostgreSQL exception if `payment.status NOT IN ('confirmed', 'partially_refunded')`, if `SUM(allocations) + amount_refunded > payment.amount`, or if `SUM(allocations) > invoice.total`.
   - *Concrete Test Evidence:* `test_financial_over_allocation_rejected_by_database` (`PASSED`), `test_financial_unconfirmed_payment_allocation_rejected` (`PASSED`), and `test_concurrency_parallel_payment_allocation_prevents_over_allocation` (`PASSED`).
4. **Receipt creation from confirmed payments & prevention of duplicate receipting:**
   - `payment_receipt_allocations` explicitly records `amount_acknowledged` for each `(payment_id, receipt_id)` pair. Trigger `trg_sync_payment_receipt_allocation` locks the `payments` row (`FOR UPDATE`), sums all active `amount_acknowledged`, rejects any attempt to acknowledge unconfirmed funds or exceed `payment.amount - payment.amount_refunded`, and updates `payments.amount_receipted`.
   - *Concrete Test Evidence:* `test_financial_double_receipting_prevented_by_database` (`PASSED`).
5. **Outstanding balance & client ledger calculation:**
   - View `public.v_client_ledger_summary` derives `total_invoiced`, `total_allocated_to_invoices`, `outstanding_invoice_balance`, `total_confirmed_payments`, `total_refunds`, `net_collections`, `unallocated_client_credit`, and `total_receipted` directly from authoritative records without ever double-counting payments and receipts.
   - *Concrete Test Evidence:* `test_financial_lifecycle_100k_invoice_40k_and_60k_payments_and_receipts` (`PASSED`).
6. **Refunds and reversals preserving history:**
   - Inserting into `payment_refunds` triggers `trg_sync_payment_refund`, which preserves `payments.amount` (`KES 50,000.00`), increments `payments.amount_refunded` (`KES 15,000.00`), reduces `unallocated_amount` (`KES 35,000.00`), transitions `payments.status` to `'partially_refunded'`, and reduces `net_collections` in `v_client_ledger_summary`.
   - *Concrete Test Evidence:* `test_financial_refund_preserves_payment_and_updates_ledger` (`PASSED`).
7. **Historical financial document preservation:**
   - Mutating `clients.name` and `clients.address` after an invoice or receipt is issued leaves `invoices.client_snapshot` and `invoices.company_snapshot` completely unchanged.
   - *Concrete Test Evidence:* `test_financial_historical_snapshot_immutability` (`PASSED`).

---

## 21.6 Database security assessment

- **Database roles, privileges & Row-Level Security (RLS):**
  - RLS is enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) on all `37` tables in `public` so external PostgREST/anonymous clients have zero direct table access (`test_schema_rls_enabled_on_all_37_tables`). All authorized queries run through backend server sessions.
- **Sensitive data handling:**
  - User passwords are stored exclusively as salted `scrypt` hashes (`users.password_hash`).
  - Session IDs (`sessions.id`) and password reset tokens (`users.reset_token_hash`) are stored as `SHA-256` digests.
  - Visitor IP addresses in `sessions.ip_hash` and `verify_attempts.client_key` are hashed with `SHA-256`.
  - No payment card PANs, CVVs, or plaintext provider API secrets are stored in database columns.
- **Audit model:**
  - `audit_logs` records `actor_id`, `action`, `resource_type`, `resource_id`, `outcome`, `before_state (JSONB)`, `after_state (JSONB)`, `metadata (JSONB)`, and UTC `created_at`. Financial records use `ON DELETE RESTRICT` to prevent silent history deletion.
- **File metadata security:**
  - `file_metadata` stores `storage_key`, `checksum_sha256`, and `access_classification IN ('public_branding', 'authenticated', 'confidential_client', 'immutable_financial_pdf')` rather than exposing raw unrestricted storage URLs for confidential client documents.
- **Public/private data separation:**
  - Public receipt verification (`POST /api/public/verify`) queries only the receipt verification projection and logs rate-limited attempts in `verify_attempts`, never exposing internal `clients` CRM notes, contacts, tax PINs, or ledger balances.
- **Backup-related security considerations:**
  - Managed automated daily backups and point-in-time recovery (PITR) on encrypted storage volumes, with all schema modifications strictly versioned in Alembic.

---

## 21.7 Testing report

| Test category | Tests written | Tests passed | Tests failed | Status |
|---|---:|---:|---:|---|
| Schema | 5 | 5 | 0 | **PASSED** |
| Relationships | 4 | 4 | 0 | **PASSED** |
| Constraints | 4 | 4 | 0 | **PASSED** |
| Financial integrity | 7 | 7 | 0 | **PASSED** |
| Concurrency | 2 | 2 | 0 | **PASSED** |
| Migrations | 2 | 2 | 0 | **PASSED** |
| Performance | 1 | 1 | 0 | **PASSED** |
| **TOTAL** | **25** | **25** | **0** | **PASSED (100%)** |

### Actual Commands Executed & Results
1. **Alembic Migration Upgrade:**
   ```bash
   /home/monda/CMISP/.venv/bin/alembic -c /home/monda/CMISP/fastapi_service/alembic.ini upgrade head
   ```
   - Result: Exited with code `0` (`head = 20261112_0001`).
2. **Pytest Database Test Suite against Live PostgreSQL:**
   ```bash
   /home/monda/CMISP/.venv/bin/pytest /home/monda/CMISP/tests/test_mp14_database.py -v
   ```
   - Result: `25 passed` against live Supabase PostgreSQL (`aws-0-eu-west-2.pooler.supabase.com:6543`).

---

## 21.8 Files changed

- **Files created / maintained for MP-14:**
  - `fastapi_service/database.py` — SQLAlchemy 2.x `DeclarativeBase`, naming conventions, sync/async engine builders.
  - `fastapi_service/models/__init__.py` — Canonical 37-model registry.
  - `fastapi_service/models/identity.py` — IAM, RBAC, session, and audit models.
  - `fastapi_service/models/settings.py` — Company settings, file metadata, templates, numbering sequences, and tax configuration models.
  - `fastapi_service/models/crm.py` — Client categories, clients, contacts, tags, tag assignments, interactions, and documents models.
  - `fastapi_service/models/quotations.py` — Quotation and quotation line item models.
  - `fastapi_service/models/invoicing.py` — Invoice and invoice line item models.
  - `fastapi_service/models/payments.py` — Payment, payment allocation, and payment refund models.
  - `fastapi_service/models/receipts.py` — Receipt, receipt item, payment-receipt allocation, and verify attempt models.
  - `fastapi_service/models/communications.py` — Notification template, email log, and SMS log models.
  - `fastapi_service/models/reconciliation.py` — Reconciliation batch, record, and match models.
  - `fastapi_service/services/__init__.py` & `fastapi_service/services/financial_service.py` — Concurrency-safe document numbering, verification code generation, and client ledger query service.
- **Migration files:**
  - `fastapi_service/alembic.ini`
  - `fastapi_service/alembic/env.py`
  - `fastapi_service/alembic/script.py.mako`
  - `fastapi_service/alembic/versions/20261112_0001_mp14_canonical_ibms_schema.py`
- **Documentation files:**
  - `docs/database/01_CANONICAL_DOMAIN_MODEL.md`
  - `docs/database/02_ERD_AND_RELATIONSHIPS.md`
  - `docs/database/03_FINANCIAL_DATA_MODEL.md`
  - `docs/database/04_SCHEMA_SPECIFICATION_AND_DATA_DICTIONARY.md`
  - `docs/database/05_MIGRATION_SECURITY_AND_PERFORMANCE.md`
  - `docs/database/06_MP14_COMPLETION_REPORT.md`
- **Test files:**
  - `tests/test_mp14_database.py`
- **Files removed:**
  - None (`0` files removed; all existing project files and tables were preserved).

---

## 21.9 Acceptance criteria assessment

| Category | Acceptance Criterion (Section 20) | Status | Supporting Explanation & Evidence |
|---|---|---|---|
| **Architecture** | A canonical domain model exists | **PASSED** | Documented in [01_CANONICAL_DOMAIN_MODEL.md](file:///home/monda/CMISP/docs/database/01_CANONICAL_DOMAIN_MODEL.md) and registered in [fastapi_service/models/__init__.py](file:///home/monda/CMISP/fastapi_service/models/__init__.py). |
| **Architecture** | All approved functional modules are represented | **PASSED** | All 13 modules represented across `37` normalized tables in `public`. |
| **Architecture** | Module boundaries are documented | **PASSED** | Domain ownership boundaries documented in [01_CANONICAL_DOMAIN_MODEL.md](file:///home/monda/CMISP/docs/database/01_CANONICAL_DOMAIN_MODEL.md#L84-L103). |
| **Architecture** | Relationships are justified | **PASSED** | Every FK and referential action (`RESTRICT`, `CASCADE`, `SET NULL`) is justified by business lifecycle rules. |
| **Architecture** | No conflicting sources of truth exist | **PASSED** | Single canonical `clients`, `quotes`, `invoices`, `payments`, `receipts`, and `users` entities; derived client ledger view `v_client_ledger_summary`. |
| **Database design** | Complete ERDs exist | **PASSED** | All 5 required Mermaid diagrams completed in [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md). |
| **Database design** | All approved entities have defined schemas | **PASSED** | Full table specifications in [04_SCHEMA_SPECIFICATION_AND_DATA_DICTIONARY.md](file:///home/monda/CMISP/docs/database/04_SCHEMA_SPECIFICATION_AND_DATA_DICTIONARY.md). |
| **Database design** | Primary keys and foreign keys are documented | **PASSED** | Verified by `test_schema_primary_keys_and_foreign_keys`. |
| **Database design** | Constraints and indexes are justified | **PASSED** | Verified by `test_schema_required_indexes_exist` and `test_constraint_*`. |
| **Database design** | Monetary values use appropriate decimal types | **PASSED** | All monetary columns use `NUMERIC(14, 2)` (`test_schema_numeric_monetary_columns_no_floats`). |
| **Database design** | Timestamp handling is consistent | **PASSED** | Event timestamps use `TIMESTAMPTZ` (UTC); calendar dates use `DATE`. |
| **Financial integrity** | Invoice, payment, and receipt are distinct entities | **PASSED** | Separate `invoices`, `payments`, and `receipts` tables with independent lifecycles. |
| **Financial integrity** | Partial payments are supported | **PASSED** | Verified by `test_financial_lifecycle_100k_invoice_40k_and_60k_payments_and_receipts`. |
| **Financial integrity** | Payment allocations are represented | **PASSED** | `payment_allocations` table + `trg_sync_payment_allocation` trigger. |
| **Financial integrity** | Outstanding balances can be accurately derived | **PASSED** | Enforced on `invoices.balance_due` and aggregated via `v_client_ledger_summary`. |
| **Financial integrity** | Duplicate financial operations are prevented | **PASSED** | Unique numbers, partial unique indexes, and row-locking triggers prevent over-allocation and double-receipting. |
| **Financial integrity** | Receipt-to-payment relationships preserve correct amounts | **PASSED** | `payment_receipt_allocations` + `trg_sync_payment_receipt_allocation` (`test_financial_double_receipting_prevented_by_database`). |
| **Financial integrity** | Refunds and reversals preserve financial history | **PASSED** | `payment_refunds` + `trg_sync_payment_refund` (`test_financial_refund_preserves_payment_and_updates_ledger`). |
| **Financial integrity** | Finalized documents preserve historical snapshots | **PASSED** | `company_snapshot` and `client_snapshot` `JSONB` columns (`test_financial_historical_snapshot_immutability`). |
| **Implementation** | SQLAlchemy models are implemented | **PASSED** | 37 typed SQLAlchemy 2.x models in `fastapi_service/models/`. |
| **Implementation** | Alembic migrations exist | **PASSED** | `fastapi_service/alembic/versions/20261112_0001_mp14_canonical_ibms_schema.py`. |
| **Implementation** | Database configuration is secure | **PASSED** | RLS enabled on all 37 tables; connection pooling & env-based credentials in `fastapi_service/database.py`. |
| **Implementation** | Database relationships work | **PASSED** | All 4 relationship test suites pass against live PostgreSQL. |
| **Implementation** | PostgreSQL constraints work | **PASSED** | All constraint and financial trigger tests pass against live PostgreSQL. |
| **Implementation** | Migrations execute successfully | **PASSED** | `test_migration_alembic_current_head_version` and `test_migration_idempotent_upgrade_head` pass. |
| **Testing** | Schema, Relationship, Financial, Concurrency, Migration & Performance tests pass | **PASSED** | `25 / 25` tests passing in `tests/test_mp14_database.py`. |
| **Documentation** | Data dictionary, ERDs, Financial model, Migration docs & Open decisions exist | **PASSED** | Delivered in `docs/database/01_*.md` through `06_*.md` and `docs/open-decisions.md`. |

---

## 21.10 Open decisions and blockers

- **Unconfirmed business rules (recorded per Rule 8, non-blocking for MP-14):**
  1. **Multi-company / multi-branch operation:** Single-company schema (`company_settings.id = 1`) is implemented for initial release. Multi-branch support would add a `branch_id` foreign key if approved later.
  2. **Cross-currency payment allocation:** Documents store ISO 4217 `currency` (`DEFAULT 'KES'`), and `fn_sync_payment_allocation` enforces matching currency between payment and invoice. Cross-currency settlement requires an approved FX rate policy before enabling.
  3. **Formal tax credit notes (`credit_notes`):** Deferred until statutory credit-note rules are confirmed; invoice cancellation and `payment_refunds` are active.
  4. **KRA eTIMS / M-Pesa Daraja webhook automation:** No speculative integration tables were created (Rule 9); `tax_configurations` and `payments.external_reference` provide clean foundations once official integration routes are confirmed.
- **Proposed architectural decisions requiring approval:**
  - Confirm whether refunding an already-allocated payment should automatically reverse the latest `payment_allocations` row or require explicit staff de-allocation first (currently enforced as explicit de-allocation first by `fn_sync_payment_refund` to prevent silent invoice reopening).
- **Dependencies on other modules:** None blocking MP-14. Subsequent backend/frontend prompts depend on this schema.
- **Known limitations / Technical debt / Remaining defects:** None (`0` failing tests, `0` schema drift).

---

## 21.11 Final readiness assessment

**Status:** **`READY FOR APPROVAL`**

**Explanation:** All 37 canonical tables, database-level constraints, PL/pgSQL financial integrity triggers, derived client ledger view (`v_client_ledger_summary`), Row-Level Security policies, SQLAlchemy 2.x models, Alembic migrations, documentation deliverables, and all 25 PostgreSQL integration/concurrency/performance tests are complete and verified against live PostgreSQL with zero defects.

---

## 21.12 Next-step recommendation

Once this **MP-14** database architecture completion report is reviewed and approved, the next master prompt to execute should be the **Backend Core / Domain Services & API Master Prompt**, which will build the FastAPI modular routers, Pydantic v2 contracts, RBAC authorization dependencies, and transactional service endpoints directly on top of:
- `fastapi_service/database.py`
- `fastapi_service/models/` (`37` SQLAlchemy 2.x models)
- `fastapi_service/services/financial_service.py`
- `docs/database/01_CANONICAL_DOMAIN_MODEL.md` through `05_MIGRATION_SECURITY_AND_PERFORMANCE.md`

*(Per Rule 17, work is stopped here awaiting your explicit review and authorization.)*
