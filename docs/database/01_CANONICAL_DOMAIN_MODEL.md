# MP-14 · Deliverable 1: Canonical Domain Model & Complete Entity Inventory

**Project:** Integrated Business Management System (IBMS) — Ledgerly / Folio  
**Prompt ID:** MP-14  
**Database Engine:** PostgreSQL 15+ (Supabase Managed PostgreSQL)  
**ORM & Migration Stack:** SQLAlchemy 2.x + Alembic (Python/FastAPI Backend) & Drizzle ORM (Next.js App Router)

---

## 1. Executive Summary & Architectural Philosophy

The Integrated Business Management System (IBMS) database is designed as a **single, shared, normalized relational source of truth** in the `public` schema supporting all 13 functional modules:

1. **Identity & Access Management (IAM)**
2. **Business Settings & Document Numbering**
3. **Client Relationship Management (CRM)**
4. **Quotations & Proposals**
5. **Invoicing & Accounts Receivable**
6. **Payments & Financial Transactions**
7. **Partial Payments & Payment Allocations**
8. **Receipt Generation & Public Verification**
9. **Communications (Email & SMS Logs + Templates)**
10. **Transaction Reconciliation**
11. **Tax Configuration**
12. **Dashboard Analytics & Financial Reporting**
13. **Security, Rate-Limiting & Audit Logging**

### Core Architectural Guarantees
- **Backward Compatibility with Existing Live Records:** All existing production tables (`users`, `sessions`, `company_settings`, `clients`, `receipt_sequences`, `receipts`, `receipt_items`, `audit_logs`, `verify_attempts`) are preserved without destructive changes and extended cleanly into the full 31-table IBMS canonical model.
- **Non-Linear Commercial Lifecycle:** Supports the full lifecycle (`Client → Interaction → Quotation → Invoice → Payment → Receipt → Reconciliation → Reporting`) while permitting valid shortcuts (e.g., direct Invoice without Quotation, direct Payment & Receipt for walk-in/cash sales without a prior Invoice).
- **Strict Separation of Financial Concepts:**
  - **Quotations (`quotes`)** represent non-binding commercial offers.
  - **Invoices (`invoices`)** represent amounts billed (accounts receivable obligation).
  - **Payments (`payments`)** represent actual money received (or attempted/refunded).
  - **Payment Allocations (`payment_allocations`)** map confirmed payments to invoices.
  - **Receipts (`receipts`)** and **Payment-Receipt Allocations (`payment_receipt_allocations`)** represent official, cryptographically verifiable acknowledgments of money received.

---

## 2. Complete Canonical Entity Inventory (31 Tables)

| # | Table Name | Functional Domain | Primary Key | Business Purpose & Ownership Boundary |
|---:|---|---|---|---|
| 1 | `users` | Identity & Access | `id (UUID)` | Canonical staff/user identity, scrypt password hash, active status, primary role. |
| 2 | `roles` | Identity & Access | `id (UUID)` | Named RBAC roles (`admin`, `cashier`, `accountant`, `auditor`, `crm_manager`). |
| 3 | `permissions` | Identity & Access | `id (UUID)` | Granular capability codes (e.g. `invoices:issue`, `receipts:cancel`, `reports:export`). |
| 4 | `user_roles` | Identity & Access | `(user_id, role_id)` | M:N assignment of users to roles with assignment metadata. |
| 5 | `role_permissions` | Identity & Access | `(role_id, permission_id)` | M:N mapping of roles to granular permissions. |
| 6 | `sessions` | Identity & Access | `id (TEXT)` | Server-managed HTTP-only session records (`SHA-256` token digest, expiry, IP hash). |
| 7 | `audit_logs` | Audit & Security | `id (BIGINT IDENTITY)` | Append-only immutable audit trail of actor, action, resource, outcome, before/after state. |
| 8 | `company_settings` | Business Settings | `id (INT = 1)` | Singleton organization profile, currency (`KES`), prefixes, branding references. |
| 9 | `file_metadata` | Business Settings / Storage | `id (UUID)` | Canonical metadata & access classification for logos, stamps, signatures, PDFs, client docs. |
| 10 | `document_templates` | Business Settings | `id (UUID)` | Configurable layout/terms templates for quotations, invoices, and receipts. |
| 11 | `numbering_sequences` | Business Settings | `(document_type, prefix, scope_year)` | Concurrency-safe atomic sequence counters for `QTN`, `INV`, `PAY`, `RCP`. |
| 12 | `receipt_sequences` | Business Settings (Legacy Sync) | `(prefix, year)` | Preserved existing sequence table for receipt numbering compatibility. |
| 13 | `tax_configurations` | Tax & Compliance | `id (UUID)` | Tax codes, rates (`NUMERIC(6,4)`), inclusive/exclusive behavior, effective dates. |
| 14 | `client_categories` | CRM | `id (UUID)` | Classification tiers for clients (e.g., Enterprise, SME, Government, Individual). |
| 15 | `clients` | CRM | `id (UUID)` | Canonical client record (individual or corporate), contact details, tax PIN, status. |
| 16 | `client_contacts` | CRM | `id (UUID)` | Multiple contact persons per corporate client (name, title, email, phone, is_primary). |
| 17 | `client_tags` | CRM | `id (UUID)` | Reusable CRM labels (e.g., `VIP`, `Retainer`, `High-Priority`). |
| 18 | `client_tag_assignments` | CRM | `(client_id, tag_id)` | M:N junction linking clients to tags. |
| 19 | `client_interactions` | CRM | `id (UUID)` | Logged calls, meetings, emails, follow-ups, requirements, and internal notes. |
| 20 | `client_documents` | CRM | `id (UUID)` | Links clients to contracts, SLAs, and compliance files stored in `file_metadata`. |
| 21 | `quotes` | Quotations | `id (UUID)` | Commercial quotations/proposals with validity dates, totals, and snapshot. |
| 22 | `quote_items` | Quotations | `id (UUID)` | Line items for quotations with quantity, unit price, discount, tax, and line totals. |
| 23 | `invoices` | Invoicing | `id (UUID)` | Accounts receivable billing documents with optional link to originating `quote_id`. |
| 24 | `invoice_items` | Invoicing | `id (UUID)` | Line items for invoices with quantity, unit price, discount, tax rate, and line totals. |
| 25 | `payments` | Payments | `id (UUID)` | Canonical record of money received (Cash, M-Pesa, Bank Transfer, Card, Cheque). |
| 26 | `payment_allocations` | Payments | `id (UUID)` | Allocates confirmed payment amounts to specific invoices (supports partial & multi-invoice). |
| 27 | `payment_refunds` | Payments | `id (UUID)` | Traceable refund/reversal events against a payment without deleting the original payment. |
| 28 | `receipts` | Receipts | `id (UUID)` | Official verifiable receipts with immutable `company_snapshot` and QR verification code. |
| 29 | `receipt_items` | Receipts | `id (UUID)` | Itemized breakdown on a receipt. |
| 30 | `payment_receipt_allocations` | Receipts / Payments | `id (UUID)` | Explicit M:N link mapping how much of a `payment` is acknowledged by a `receipt`. |
| 31 | `verify_attempts` | Receipts / Security | `id (BIGINT IDENTITY)` | Public receipt verification log & rate-limiting ledger (`receipt_verification_logs`). |
| 32 | `notification_templates` | Communications | `id (UUID)` | Email and SMS templates with variable placeholders. |
| 33 | `email_logs` | Communications | `id (UUID)` | Outbound email delivery tracking, provider reference, attempts, and failure reason. |
| 34 | `sms_logs` | Communications | `id (UUID)` | Outbound SMS delivery tracking, provider reference, attempts, and failure reason. |
| 35 | `reconciliation_batches` | Reconciliation | `id (UUID)` | Imported bank / M-Pesa statement batch header and summary counts. |
| 36 | `reconciliation_records` | Reconciliation | `id (UUID)` | Individual external statement lines within a batch (`external_tx_id`, amount, date). |
| 37 | `reconciliation_matches` | Reconciliation | `id (UUID)` | Suggested, confirmed, or rejected matches between external lines and `payments` / `invoices`. |

---

## 3. Domain Ownership Boundaries & Rules

1. **Identity & Access Management (`users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `sessions`)**
   - Owns authentication state and role/permission resolution.
   - Other modules reference `users(id)` via foreign keys (`ON DELETE RESTRICT` or `ON DELETE SET NULL` for non-critical metadata; never `CASCADE` on financial records).
   - Deactivating a user (`active = false`) immediately invalidates protected operations while keeping historical `created_by`, `issued_by`, and `actor_id` references intact.

2. **CRM (`clients`, `client_contacts`, `client_categories`, `client_tags`, `client_tag_assignments`, `client_interactions`, `client_documents`)**
   - `clients` is the **single canonical customer entity** used by Quotations, Invoices, Payments, and Receipts.
   - Supports both `individual` and `corporate` client types (`client_type`).
   - Phone numbers are indexed for fast lookup (`clients_phone_idx`) but are **not** globally unique, because multiple corporate departments or family members may share a reception/mobile number.

3. **Commercial Documents (`quotes`, `quote_items`, `invoices`, `invoice_items`)**
   - A `quote` is converted to an `invoice` by setting `invoices.quote_id = quotes.id` and updating `quotes.status = 'converted'`. The original `quote` and `quote_items` remain 100% preserved and immutable.
   - Finalized `invoices` store both `company_snapshot` and `client_snapshot` (`JSONB`) so subsequent edits to `clients` or `company_settings` never alter historical invoices.

4. **Financial Settlement & Acknowledgment (`payments`, `payment_allocations`, `payment_refunds`, `receipts`, `receipt_items`, `payment_receipt_allocations`)**
   - `payments` record actual funds received.
   - `payment_allocations` link `payments` to `invoices` (preventing over-allocation via triggers/constraints and transactional locking).
   - `payment_receipt_allocations` link `payments` to `receipts` so the database tracks the exact `allocated_amount` of every payment acknowledged by each finalized receipt, preventing double-receipting.
