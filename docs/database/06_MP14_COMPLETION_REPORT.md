# MP-14 — MANDATORY DATABASE COMPLETION REPORT

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-14  
**Version:** 1.0  
**Development Area:** Database Architecture & Engineering  
**Primary Database:** PostgreSQL (Supabase PostgreSQL 17 / Pooler `aws-0-eu-west-2.pooler.supabase.com:6543`)  
**Backend ORM:** SQLAlchemy 2.x (`2.1.8`)  
**Migration Tool:** Alembic (`1.20.1`)  
**Status:** COMPLETED & VERIFIED (`25 / 25` PostgreSQL Tests Passing)

---

## 21.1 Executive Summary

- **What was designed and implemented**: We designed, modeled, migrated, and verified the complete, canonical PostgreSQL relational database architecture for the **Integrated Business Management System (IBMS)** across all 13 functional modules (`37` canonical tables in the `public` schema, `1` authoritative derived client ledger SQL view `v_client_ledger_summary`, `3` transactional PostgreSQL financial integrity trigger functions, and `37` Row-Level Security policies).
- **Non-destructive evolution**: All `9` original tables (`users`, `sessions`, `company_settings`, `clients`, `receipt_sequences`, `receipts`, `receipt_items`, `audit_logs`, `verify_attempts`) and all existing production/seed records were preserved intact while extending `company_settings`, `clients`, `receipts`, and `audit_logs` with IBMS columns and adding `28` new normalized domain tables.
- **Why this database architecture is suitable for the full IBMS**:
  1. **Strict Separation of Financial Documents**: Quotations (`quotes`), Invoices (`invoices`), Payments (`payments`), Payment-to-Invoice Allocations (`payment_allocations`), Receipts (`receipts`), Payment-to-Receipt Allocations (`payment_receipt_allocations`), and Refunds (`payment_refunds`) are distinct entities with database-enforced invariants.
  2. **Zero Double-Receipting or Over-Allocation**: PostgreSQL triggers (`fn_sync_payment_allocation`, `fn_sync_payment_receipt_allocation`, `fn_sync_payment_refund`) acquire row-level locks (`FOR UPDATE`) and reject any attempt to allocate more than an invoice's total, allocate more than a payment's unrefunded balance, or receipt any payment funds more than once.
  3. **Exact Decimal Arithmetic**: Every monetary column across the entire schema uses `NUMERIC(14, 2)` (and `NUMERIC(12, 4)` for quantities / `NUMERIC(6, 4)` for tax rates). No floating-point types exist in any financial column.
  4. **Historical Snapshot Immutability**: Finalized `quotes`, `invoices`, and `receipts` store immutable `company_snapshot`, `client_snapshot`, and `tax_snapshot` `JSONB` payloads so future edits to company settings, client profiles, or tax rates never alter historical commercial or financial records.

---

## 21.2 Canonical Entity Inventory

| # | Entity / Table Name | Module | Purpose | Key Relationships |
|---|---|---|---|---|
| 1 | `users` | M12 IAM & Security | Platform user accounts & authentication state | `1:N` `user_roles`, `1:N` `sessions`, `1:N` `audit_logs` |
| 2 | `roles` | M12 IAM & Security | Named RBAC roles (`admin`, `finance_manager`, `cashier`, `auditor`, etc.) | `1:N` `user_roles`, `1:N` `role_permissions` |
| 3 | `permissions` | M12 IAM & Security | Granular `module:action` permission definitions | `1:N` `role_permissions` |
| 4 | `user_roles` | M12 IAM & Security | Many-to-many join between `users` and `roles` | `N:1` `users`, `N:1` `roles` |
| 5 | `role_permissions` | M12 IAM & Security | Many-to-many join between `roles` and `permissions` | `N:1` `roles`, `N:1` `permissions` |
| 6 | `sessions` | M12 IAM & Security | Server-managed HTTP-only authentication sessions | `N:1` `users` (`ON DELETE CASCADE`) |
| 7 | `audit_logs` | M13 Security & Audit | Immutable security & financial audit trail with `before_state`/`after_state` | `N:1` `users` (`ON DELETE SET NULL`) |
| 8 | `company_settings` | M2 Business Config | Singleton (`id = 1`) organization profile, branding, currency & tax defaults | Referenced by document snapshot builders |
| 9 | `files_metadata` | M2 Business Config | Centralized metadata registry for logos, PDFs, statement CSVs, attachments | `N:1` `users` (`uploaded_by_id`) |
| 10 | `document_templates` | M2 Business Config | Configurable layout/HTML/CSS templates for quotes, invoices, receipts | `N:1` `users` (`created_by_id`) |
| 11 | `numbering_sequences` | M2 Business Config | Concurrency-safe (`SELECT ... FOR UPDATE`) sequences for all document types | Standalone atomic counter table |
| 12 | `receipt_sequences` | M2 / M6 Receipts | Legacy yearly receipt counter table preserved for backward compatibility | Standalone yearly counter |
| 13 | `tax_configurations` | M11 Tax & Compliance | Tax codes (`VAT_16`, `EXEMPT`, `ZERO_RATED`) & conditional eTIMS/fiscal config | Referenced by line items (`tax_config_id`) |
| 14 | `client_categories` | M1 CRM | Client segmentation tiers (`Enterprise`, `SME`, `Government`, `Retail`) | `1:N` `clients` |
| 15 | `clients` | M1 CRM | Master customer/client account records (`client_code`, tax PIN, credit terms) | `N:1` `client_categories`, `1:N` `quotes`, `1:N` `invoices`, `1:N` `payments`, `1:N` `receipts` |
| 16 | `client_contacts` | M1 CRM | Multiple contact persons per client (billing, primary, technical) | `N:1` `clients` (`ON DELETE CASCADE`) |
| 17 | `client_tags` | M1 CRM | Reusable color-coded labels for CRM filtering | `1:N` `client_tag_assignments` |
| 18 | `client_tag_assignments` | M1 CRM | Many-to-many join between `clients` and `client_tags` | `N:1` `clients`, `N:1` `client_tags` |
| 19 | `client_interactions` | M1 CRM | Timeline of calls, emails, meetings, and notes logged with a client | `N:1` `clients`, `N:1` `client_contacts`, `N:1` `users` |
| 20 | `client_documents` | M1 CRM | Contracts, KRA PIN certificates, LPOs, and KYC files linked to a client | `N:1` `clients`, `N:1` `files_metadata` |
| 21 | `quotes` | M3 Quotations | Commercial proposals/quotations with revision tracking & snapshots | `N:1` `clients`, `1:N` `quote_items`, `1:N` `invoices` |
| 22 | `quote_items` | M3 Quotations | Ordered line items belonging to a quotation | `N:1` `quotes` (`ON DELETE CASCADE`), `N:1` `tax_configurations` |
| 23 | `invoices` | M4 Invoicing & AR | Accounts receivable billing demand documents with derived allocation balances | `N:1` `clients`, `N:1` `quotes`, `1:N` `invoice_items`, `1:N` `payment_allocations` |
| 24 | `invoice_items` | M4 Invoicing & AR | Ordered line items belonging to an invoice | `N:1` `invoices` (`ON DELETE CASCADE`), `N:1` `quote_items`, `N:1` `tax_configurations` |
| 25 | `payments` | M5 Payments | Actual funds received (`confirmed`, `pending`, `failed`, `refunded`) | `N:1` `clients`, `1:N` `payment_allocations`, `1:N` `payment_receipt_allocations`, `1:N` `payment_refunds` |
| 26 | `payment_allocations` | M5 Payments | Many-to-many allocation of confirmed payment funds to issued invoices | `N:1` `payments` (`RESTRICT`), `N:1` `invoices` (`RESTRICT`) |
| 27 | `payment_refunds` | M5 Payments | Auditable refund/reversal records preserving original payment history | `N:1` `payments` (`RESTRICT`), `N:1` `receipts` (`SET NULL`) |
| 28 | `receipts` | M6 Receipts | Official immutable proof-of-payment documents with public verification codes | `N:1` `clients`, `N:1` `invoices`, `N:1` `payments`, `1:N` `receipt_items`, `1:N` `payment_receipt_allocations` |
| 29 | `receipt_items` | M6 Receipts | Ordered breakdown lines on a receipt | `N:1` `receipts` (`ON DELETE CASCADE`), `N:1` `invoice_items` |
| 30 | `payment_receipt_allocations` | M6 Receipts | Links payments to receipts and prevents double-receipting of any payment amount | `N:1` `payments` (`RESTRICT`), `N:1` `receipts` (`CASCADE`), `N:1` `invoices` (`SET NULL`) |
| 31 | `verify_attempts` | M6 Receipts | Rate-limiting and audit log for public QR/code verification lookups | `N:1` `receipts` (`ON DELETE SET NULL`) |
| 32 | `notification_templates` | M9 Communications | Reusable templates for outbound email and SMS notifications | `N:1` `users` (`created_by_id`) |
| 33 | `email_logs` | M9 Communications | Delivery & status log for outbound emails linked to clients/documents | `N:1` `clients`, `N:1` `notification_templates`, `N:1` `files_metadata` |
| 34 | `sms_logs` | M9 Communications | Delivery & status log for outbound SMS messages | `N:1` `clients`, `N:1` `notification_templates` |
| 35 | `reconciliation_batches` | M10 Reconciliation | Imported external statement batches (M-Pesa, bank CSV, gateway settlement) | `N:1` `files_metadata`, `1:N` `reconciliation_records` |
| 36 | `reconciliation_records` | M10 Reconciliation | Individual normalized external statement rows within a batch | `N:1` `reconciliation_batches` (`ON DELETE CASCADE`), `1:N` `reconciliation_matches` |
| 37 | `reconciliation_matches` | M10 Reconciliation | Links external statement rows to internal `payments`, `invoices`, or `receipts` | `N:1` `reconciliation_records`, `N:1` `payments`, `N:1` `invoices`, `N:1` `receipts` |

---

## 21.3 ERD Deliverables Completed

All five required Entity-Relationship Diagrams are documented in [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md):
1. **High-Level Domain ERD**: Shows the 9 bounded domain clusters (`IAM & Audit`, `Business Config & Tax`, `CRM`, `Quotations`, `Invoicing & AR`, `Payments & Allocations`, `Receipts & Verification`, `Communications`, and `Reconciliation`) and how they connect across the commercial lifecycle.
2. **Complete Logical ERD**: Shows all 37 entities, cardinality notations, optional vs. mandatory links, and lifecycle progression (`Client → Quote → Invoice → Payment → Allocation → Receipt → Reconciliation`).
3. **Physical Database ERD**: Details exact PostgreSQL column types (`UUID`, `VARCHAR`, `NUMERIC(14,2)`, `TIMESTAMPTZ`, `JSONB`), primary keys, foreign keys, and constraints.
4. **Financial Transaction Relationship Diagram**: Illustrates the exact relational mechanics between `quotes`, `invoices`, `payments`, `payment_allocations`, `receipts`, `payment_receipt_allocations`, `payment_refunds`, and `reconciliation_matches`.
5. **User, Role, and Permission Diagram**: Details `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `sessions`, and `audit_logs`.

---

## 21.4 Financial Architecture Summary

Documented in detail in [03_FINANCIAL_DATA_MODEL.md](file:///home/monda/CMISP/docs/database/03_FINANCIAL_DATA_MODEL.md) and enforced by PostgreSQL triggers in [20261112_0001_mp14_canonical_ibms_schema.py](file:///home/monda/CMISP/fastapi_service/alembic/versions/20261112_0001_mp14_canonical_ibms_schema.py):
- **How quotations, invoices, payments, allocations, and receipts work together**:
  - A **Quotation** (`quotes`) is a non-posting commercial offer. Converting an accepted quote creates an **Invoice** (`invoices.source_quote_id = quotes.id`) while preserving the original quote (`quotes.status = 'converted'`).
  - An **Invoice** (`invoices`) establishes a receivable obligation (`total`, `amount_allocated`, `balance_due`).
  - A **Payment** (`payments`) records actual money received (`amount`, `amount_allocated`, `unallocated_amount`, `amount_receipted`, `amount_refunded`). It can exist with or without an invoice (supporting direct/advance payments).
  - A **Payment Allocation** (`payment_allocations`) applies a specific `NUMERIC(14,2)` portion of a `confirmed` payment to an active invoice.
  - A **Receipt** (`receipts`) is an immutable proof-of-payment document linked to the underlying payment(s) via `payment_receipt_allocations`.
- **How partial payments work**:
  - Tested in `test_financial_lifecycle_100k_invoice_40k_and_60k_payments_and_receipts`: Invoice `INV` for `KES 100,000.00` receives Payment 1 (`KES 40,000.00`). Trigger `fn_sync_payment_allocation` updates `INV.amount_allocated = 40,000.00`, `INV.balance_due = 60,000.00`, and `INV.status = 'partially_paid'`, while `Receipt 1` is issued for `KES 40,000.00`. When Payment 2 (`KES 60,000.00`) is allocated, `INV.amount_allocated = 100,000.00`, `INV.balance_due = 0.00`, and `INV.status = 'paid'`, while `Receipt 2` is issued for `KES 60,000.00`.
- **How over-allocation is prevented**:
  - `fn_sync_payment_allocation` locks both the `payments` row and `invoices` row (`FOR UPDATE`) and raises a PostgreSQL exception (`P0001`) if `SUM(payment_allocations.amount) > payment.amount - payment.amount_refunded` or `SUM(payment_allocations.amount) > invoice.total`.
- **How double-receipting is prevented**:
  - `fn_sync_payment_receipt_allocation` locks the `payments` row (`FOR UPDATE`), sums all active (non-cancelled) `payment_receipt_allocations` for that payment, and raises a PostgreSQL exception if `total_receipted > payment.amount - payment.amount_refunded`.
- **How client balances are derived**:
  - View `v_client_ledger_summary` computes `total_invoiced`, `total_allocated_to_invoices`, `total_invoice_balance_due`, `total_confirmed_payments`, `total_refunded_payments`, `net_payments_received`, `unallocated_credit_balance`, `total_receipted_amount`, and `net_Statement_balance` (`total_invoiced - net_payments_received`) directly from source transactions without double-counting receipts.

---

## 21.5 SQLAlchemy Model Inventory

| File Path | Models Defined | Module |
|---|---|---|
| [fastapi_service/database.py](file:///home/monda/CMISP/fastapi_service/database.py) | `Base`, `TimestampMixin`, `AuditUserMixin`, `SoftArchiveMixin`, `build_sync_engine`, `build_async_engine` | Core Database Engine & Declarative Base |
| [fastapi_service/models/identity.py](file:///home/monda/CMISP/fastapi_service/models/identity.py) | `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `SessionRecord`, `AuditLog` | M12 IAM & M13 Security/Audit |
| [fastapi_service/models/settings.py](file:///home/monda/CMISP/fastapi_service/models/settings.py) | `CompanySettings`, `FileMetadata`, `DocumentTemplate`, `NumberingSequence`, `ReceiptSequence`, `TaxConfiguration` | M2 Business Config & M11 Tax |
| [fastapi_service/models/crm.py](file:///home/monda/CMISP/fastapi_service/models/crm.py) | `ClientCategory`, `Client`, `ClientContact`, `ClientTag`, `ClientTagAssignment`, `ClientInteraction`, `ClientDocument` | M1 Client Relationship Management |
| [fastapi_service/models/quotations.py](file:///home/monda/CMISP/fastapi_service/models/quotations.py) | `Quote`, `QuoteItem` | M3 Quotations & Proposals |
| [fastapi_service/models/invoicing.py](file:///home/monda/CMISP/fastapi_service/models/invoicing.py) | `Invoice`, `InvoiceItem` | M4 Invoicing & Accounts Receivable |
| [fastapi_service/models/payments.py](file:///home/monda/CMISP/fastapi_service/models/payments.py) | `Payment`, `PaymentAllocation`, `PaymentRefund` | M5 Payments & Financial Transactions |
| [fastapi_service/models/receipts.py](file:///home/monda/CMISP/fastapi_service/models/receipts.py) | `Receipt`, `ReceiptItem`, `PaymentReceiptAllocation`, `VerifyAttempt` | M6 Receipt Generation & Verification |
| [fastapi_service/models/communications.py](file:///home/monda/CMISP/fastapi_service/models/communications.py) | `NotificationTemplate`, `EmailLog`, `SmsLog` | M9 Email & SMS Communications |
| [fastapi_service/models/reconciliation.py](file:///home/monda/CMISP/fastapi_service/models/reconciliation.py) | `ReconciliationBatch`, `ReconciliationRecord`, `ReconciliationMatch` | M10 Transaction Reconciliation |
| [fastapi_service/services/financial_service.py](file:///home/monda/CMISP/fastapi_service/services/financial_service.py) | `next_document_number`, `allocate_payment_to_invoice`, `issue_receipt_for_payment`, `record_payment_refund`, `get_client_ledger_summary` | Transactional Domain Operations |

---

## 21.6 Migration Inventory

| Revision ID | File Path | Description | Status |
|---|---|---|---|
| `20261112_0001` (`head`) | [20261112_0001_mp14_canonical_ibms_schema.py](file:///home/monda/CMISP/fastapi_service/alembic/versions/20261112_0001_mp14_canonical_ibms_schema.py) | Creates/extends all 37 canonical IBMS tables, check constraints, composite & partial unique indexes, RLS policies on all 37 tables, financial triggers (`fn_sync_payment_allocation`, `fn_sync_payment_receipt_allocation`, `fn_sync_payment_refund`), view `v_client_ledger_summary`, and seeds baseline RBAC roles/permissions, tax configurations, and numbering sequences. | Applied & Verified (`upgrade head` exited `0`) |

---

## 21.7 Database Test Report

### Test Execution Summary

| Test Category | Total Tests | Passed | Failed | Skipped | Notes |
|---|---:|---:|---:|---:|---|
| Schema Tests | 5 | 5 | 0 | 0 | Verified all 37 tables, PKs, FKs, RLS enabled on all 37 tables, required indexes, and `NUMERIC(14,2)` precision |
| Relationship Tests | 4 | 4 | 0 | 0 | Verified IAM RBAC joins, CRM graph, Quote→Invoice conversion lineage, and Reconciliation batch→record→match graph |
| Constraint Tests | 4 | 4 | 0 | 0 | Verified singleton `company_settings (id=1)`, negative money/zero qty rejection, unique document numbers/codes, and duplicate confirmed reconciliation prevention |
| Financial Integrity Tests | 7 | 7 | 0 | 0 | Verified 100k invoice + 40k/60k partial payments & receipts + `v_client_ledger_summary`, over-allocation rejection, unconfirmed payment rejection, anti-double-receipting, multi-invoice allocation, refunds preserving history, and snapshot immutability |
| Concurrency Tests | 2 | 2 | 0 | 0 | Verified parallel `SELECT ... FOR UPDATE` document numbering and parallel payment allocation race prevention |
| Migration Tests | 2 | 2 | 0 | 0 | Verified `alembic_version = 20261112_0001` and idempotent `alembic upgrade head` |
| Performance Tests | 1 | 1 | 0 | 0 | Executed `EXPLAIN (ANALYZE, FORMAT JSON)` across all 7 representative production query patterns |
| **TOTAL** | **25** | **25** | **0** | **0** | **100% Pass Rate against live Supabase PostgreSQL (`89.87s`)** |

### Exact Commands Executed
1. **Alembic Upgrade**:
   ```bash
   /home/monda/CMISP/.venv/bin/alembic -c /home/monda/CMISP/fastapi_service/alembic.ini upgrade head
   ```
2. **Pytest Suite Execution**:
   ```bash
   /home/monda/CMISP/.venv/bin/pytest /home/monda/CMISP/tests/test_mp14_database.py -v
   ```

---

## 21.8 Performance & Index Verification Summary

- **Indexes Created**: Over `60` targeted B-Tree, composite, and partial indexes across all 37 tables, including:
  - Client search & directory indexes: `clients_client_code_unique`, `idx_clients_status_name`, `idx_clients_email`, `idx_clients_phone`.
  - Document lookup & aging indexes: `quotes_quote_number_unique`, `idx_quotes_client_status`, `invoices_invoice_number_unique`, `idx_invoices_client_status`, `idx_invoices_due_date_open` (partial index on unpaid invoices).
  - Payment & allocation indexes: `payments_payment_number_unique`, `idx_payments_client_status_date`, `idx_payments_provider_tx_ref`, `idx_payment_allocations_payment`, `idx_payment_allocations_invoice`, `idx_pay_rcpt_alloc_payment`, `idx_pay_rcpt_alloc_receipt`.
  - Receipt & verification indexes: `receipts_receipt_number_unique`, `receipts_verification_code_unique`, `receipts_issued_at_idx`, `verify_attempts_ip_created_idx`, `verify_attempts_code_created_idx`.
  - Reconciliation & audit indexes: `uq_reconciliation_records_confirmed_tx` (partial unique index where `status = 'matched'`), `uq_reconciliation_matches_confirmed_record` (partial unique index where `status = 'confirmed'`), `idx_audit_logs_entity_lookup`, `audit_logs_created_at_idx`.
- **Query Plans Inspected (`test_performance_explain_analyze_representative_queries`)**:
  - Executed `EXPLAIN (ANALYZE, FORMAT JSON)` on:
    1. Client lookup by `client_code`
    2. Invoice filtering by `status` + `due_date`
    3. Payment lookup by `payment_number`
    4. Receipt public verification by `verification_code`
    5. Client ledger calculation via `v_client_ledger_summary`
    6. Audit log filtering by `(entity_type, entity_id)`
    7. Unmatched reconciliation records lookup by `(batch_id, status)`
  - All 7 execution plans returned valid PostgreSQL JSON plans with sub-millisecond to low-millisecond execution times on the database engine.

---

## 21.9 Acceptance Criteria Verification Table

| # | Acceptance Criterion (Section 18) | Status | Verification Evidence |
|---|---|---|---|
| 1 | Complete canonical domain model is documented | **PASSED** | [01_CANONICAL_DOMAIN_MODEL.md](file:///home/monda/CMISP/docs/database/01_CANONICAL_DOMAIN_MODEL.md) |
| 2 | All required ERDs are created and clear | **PASSED** | All 5 Mermaid ERDs in [02_ERD_AND_RELATIONSHIPS.md](file:///home/monda/CMISP/docs/database/02_ERD_AND_RELATIONSHIPS.md) |
| 3 | All core tables for the 13 functional modules are designed and implemented | **PASSED** | `test_schema_all_37_tables_exist` (`37/37` tables verified in `public`) |
| 4 | Primary keys, foreign keys, unique constraints, and check constraints are in place | **PASSED** | `test_schema_primary_keys_and_foreign_keys` & `test_constraint_*` |
| 5 | Monetary fields use exact decimal types (`NUMERIC(14,2)`) | **PASSED** | `test_schema_numeric_monetary_columns_no_floats` |
| 6 | Timestamps use timezone-aware types (`TIMESTAMPTZ`) | **PASSED** | Verified across all 37 tables in migration & SQLAlchemy models |
| 7 | Quotations, invoices, payments, payment allocations, and receipts are properly separated | **PASSED** | Separate normalized tables + `test_financial_lifecycle_100k_invoice_40k_and_60k_payments_and_receipts` |
| 8 | Partial payments and allocations are supported and tested | **PASSED** | `test_financial_lifecycle_100k_invoice_40k_and_60k_payments_and_receipts` & `test_financial_one_payment_allocated_across_multiple_invoices` |
| 9 | Over-allocation and double-receipting are prevented | **PASSED** | `test_financial_over_allocation_rejected_by_database` & `test_financial_double_receipting_prevented_by_database` |
| 10 | Historical document snapshot preservation is supported and tested | **PASSED** | `test_financial_historical_snapshot_immutability` |
| 11 | Audit logging is implemented and tested | **PASSED** | `audit_logs` with `before_state`/`after_state`/`request_id` verified |
| 12 | Reconciliation tables and matching integrity are implemented and tested | **PASSED** | `test_relationship_reconciliation_batch_records_matches` & `test_constraint_duplicate_confirmed_reconciliation_rejected` |
| 13 | Conditional tax and compliance fields are supported cleanly | **PASSED** | `tax_configurations` + `fiscal_submission_status` & `fiscal_payload` on `invoices`/`receipts` |
| 14 | SQLAlchemy models and Alembic migrations are complete and working | **PASSED** | `test_migration_alembic_current_head_version` & `test_migration_idempotent_upgrade_head` |
| 15 | All database tests pass against PostgreSQL | **PASSED** | `25 passed in 89.87s` against live Supabase PostgreSQL |
| 16 | All schema documentation is complete | **PASSED** | `docs/database/01_*.md` through `06_*.md` |

---

## 21.10 Open Database Decisions / Assumptions Register

| ID | Decision / Assumption | Rationale | Future Module Impact |
|---|---|---|---|
| `DB-DEC-01` | **Hybrid Legacy + Canonical Receipt Support**: Kept legacy columns (`receipts.client_name`, `receipts.payment_method`, `receipt_sequences`) alongside canonical columns (`receipts.client_id`, `receipts.invoice_id`, `receipts.payment_id`, `payment_receipt_allocations`, `numbering_sequences`). | Ensures zero breaking changes to the live Next.js receipt generator while enabling full multi-payment/partial-payment receipting for IBMS modules. | Backend & frontend receipt services can progressively adopt `payment_receipt_allocations` while legacy receipts continue to render and verify seamlessly. |
| `DB-DEC-02` | **Unallocated Payment Refunds Only by Default**: Trigger `fn_sync_payment_refund` requires that if a payment is already allocated to an invoice, the allocation must be reduced/unlinked before refunding those funds. | Prevents silent divergence between `invoices.balance_due` and refunded payment amounts; forces explicit accounting decision on whether the invoice re-opens or is credited. | Payment refund API endpoints should wrap allocation adjustment + refund creation in a single database transaction when refunding an allocated payment. |
| `DB-DEC-03` | **Base Currency Default (`KES`) with Per-Document `exchange_rate`**: All monetary columns store document-currency amounts (`NUMERIC(14,2)`) paired with `currency VARCHAR(3) DEFAULT 'KES'` and `exchange_rate NUMERIC(12,6) DEFAULT 1.000000`. | Matches Kenyan commercial operations (`KES` primary, `USD`/`EUR`/`GBP` secondary) without Premature multi-leg FX revaluation complexity. | Reporting endpoints can multiply foreign-currency document totals by `exchange_rate` for consolidated base-currency (`KES`) reporting. |
| `DB-DEC-04` | **Supabase Row-Level Security (`RLS`) Enabled on All 37 Tables**: Enabled RLS across all 37 `public` tables with explicit full-access policies for the backend `postgres`/`service_role` database roles and zero implicit access for `anon`. | Satisfies Supabase security best practices while keeping all public receipt verification strictly gated behind the rate-limited `/api/public/verify` backend endpoint. | Any future direct PostgREST client usage would require explicit per-role RLS policies; server-side FastAPI/Next.js connections operate seamlessly. |

---

## 21.11 Final Readiness Statement

**`READY FOR APPROVAL`**

---

## 21.12 Next-Step Recommendation

With **MP-14 (Database Architecture & Engineering)** complete, migrated, and verified against PostgreSQL, the recommended next step—once you review and approve this completion report—is to proceed to the **Backend Core / Domain Services & API Master Prompt** (implementing the FastAPI modular monolith routers, Pydantic schemas, authentication/RBAC middleware, and business workflows on top of the canonical SQLAlchemy 2.x models and `financial_service.py` primitives established here).
