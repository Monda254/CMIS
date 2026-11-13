# MP-14 · Deliverable 4: Complete Database Schema Specification & Data Dictionary

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-14  
**Schema:** `public` (PostgreSQL 15+)

---

## 1. Global Data Type & Precision Conventions

| Domain Concept | PostgreSQL Type | SQLAlchemy 2.x Type | Justification & Rules |
|---|---|---|---|
| **Primary Keys (Entity IDs)** | `UUID DEFAULT gen_random_uuid()` | `Mapped[uuid.UUID]` | Globally unique, non-enumerable, safe for distributed/offline creation. High-volume append logs (`audit_logs`, `verify_attempts`) use `BIGINT GENERATED ALWAYS AS IDENTITY`. |
| **Monetary Amounts** | `NUMERIC(14, 2)` | `Mapped[Decimal]` | Supports up to `999,999,999,999.99` with exact 2-decimal cent/shilling representation. Never `FLOAT` or `DOUBLE PRECISION`. |
| **Quantities** | `NUMERIC(12, 3)` | `Mapped[Decimal]` | Supports fractional quantities up to 3 decimal places (`0.001`). |
| **Tax Rates & Discounts** | `NUMERIC(6, 4)` | `Mapped[Decimal]` | Represents percentages with 4 decimal places (e.g., `16.0000` for 16% VAT). |
| **Currency Code** | `VARCHAR(3) DEFAULT 'KES'` | `Mapped[str]` | ISO 4217 3-letter uppercase currency code (`KES`, `USD`, `EUR`, `GBP`). |
| **Event Timestamps** | `TIMESTAMPTZ` | `Mapped[datetime]` | Stored in UTC (`timezone=True`); displayed in configured business timezone (`Africa/Nairobi`). |
| **Calendar Dates** | `DATE` | `Mapped[date]` | Used for calendar-scoped business dates (`issue_date`, `due_date`, `expiry_date`, `effective_from`). |
| **Document Snapshots** | `JSONB` | `Mapped[Optional[dict]]` | Immutable point-in-time company and client details captured at finalization. |

---

## 2. Table-by-Table Specification & Data Dictionary

### 2.1 Identity & Access Management

#### Table 1: `public.users`
*Purpose:* Canonical staff user accounts and authentication credentials.
*Deletion Policy:* Never hard-deleted if referenced by financial records; deactivate via `active = false`.

| Column | Type | Null | Default | Constraints / Indexes | Business Meaning |
|---|---|---|---|---|---|
| `id` | `UUID` | `NOT NULL` | `gen_random_uuid()` | `PK` | Unique user identifier. |
| `email` | `TEXT` | `NOT NULL` | — | `UNIQUE`, `users_email_idx` | Staff login email address (normalized lowercase). |
| `password_hash` | `TEXT` | `NOT NULL` | — | — | `scrypt` salted password digest; never plaintext. |
| `full_name` | `TEXT` | `NOT NULL` | `''` | — | Staff member's display name on issued documents. |
| `role` | `app_role` (`admin`, `cashier`) | `NOT NULL` | `'cashier'` | — | Primary application role for backward compatibility. |
| `active` | `BOOLEAN` | `NOT NULL` | `false` | — | Whether the user is allowed to authenticate and act. |
| `reset_token_hash` | `TEXT` | `NULL` | `NULL` | — | `SHA-256` hash of one-time password reset token. |
| `reset_token_expires_at` | `TIMESTAMPTZ` | `NULL` | `NULL` | — | Expiration timestamp of password reset token. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | — | Account creation timestamp (UTC). |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | — | Last profile or credential update timestamp (UTC). |

#### Table 2: `public.roles`
*Purpose:* Extensible RBAC role definitions across the 13 IBMS modules.

| Column | Type | Null | Default | Constraints / Indexes | Business Meaning |
|---|---|---|---|---|---|
| `id` | `UUID` | `NOT NULL` | `gen_random_uuid()` | `PK` | Role identifier. |
| `code` | `VARCHAR(50)` | `NOT NULL` | — | `UNIQUE` (`uq_roles_code`) | Machine-readable role slug (`admin`, `cashier`, `accountant`, `auditor`, `crm_manager`). |
| `name` | `VARCHAR(100)` | `NOT NULL` | — | — | Human-readable role title. |
| `description` | `TEXT` | `NOT NULL` | `''` | — | Scope of responsibilities granted to the role. |
| `is_system` | `BOOLEAN` | `NOT NULL` | `false` | — | Protects built-in roles from accidental deletion. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | — | Creation timestamp. |

#### Table 3: `public.permissions`
*Purpose:* Granular permission capabilities mapped to roles.

| Column | Type | Null | Default | Constraints / Indexes | Business Meaning |
|---|---|---|---|---|---|
| `id` | `UUID` | `NOT NULL` | `gen_random_uuid()` | `PK` | Permission identifier. |
| `code` | `VARCHAR(100)` | `NOT NULL` | — | `UNIQUE` (`uq_permissions_code`) | Capability key (e.g., `quotes:write`, `invoices:issue`, `payments:allocate`, `receipts:cancel`). |
| `module` | `VARCHAR(50)` | `NOT NULL` | — | `idx_permissions_module` | Functional module owning this capability. |
| `description` | `TEXT` | `NOT NULL` | `''` | — | Explanation of what the permission authorizes. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | — | Creation timestamp. |

#### Table 4: `public.user_roles`
*Purpose:* Many-to-many assignment of users to roles.

| Column | Type | Null | Default | Constraints / Indexes | Business Meaning |
|---|---|---|---|---|---|
| `user_id` | `UUID` | `NOT NULL` | — | `PK`, `FK -> users.id ON DELETE CASCADE` | User receiving the role. |
| `role_id` | `UUID` | `NOT NULL` | — | `PK`, `FK -> roles.id ON DELETE CASCADE`, `idx_user_roles_role` | Role granted to the user. |
| `assigned_by` | `UUID` | `NULL` | `NULL` | `FK -> users.id ON DELETE SET NULL` | Administrator who granted the role. |
| `assigned_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | — | Timestamp when role was granted. |

#### Table 5: `public.role_permissions`
*Purpose:* Many-to-many mapping between roles and permissions.

| Column | Type | Null | Default | Constraints / Indexes | Business Meaning |
|---|---|---|---|---|---|
| `role_id` | `UUID` | `NOT NULL` | — | `PK`, `FK -> roles.id ON DELETE CASCADE` | Role being configured. |
| `permission_id` | `UUID` | `NOT NULL` | — | `PK`, `FK -> permissions.id ON DELETE CASCADE` | Permission granted to the role. |
| `granted_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | — | Timestamp when permission was attached. |

#### Table 6: `public.sessions`
*Purpose:* Server-managed HTTP-only session store.

| Column | Type | Null | Default | Constraints / Indexes | Business Meaning |
|---|---|---|---|---|---|
| `id` | `TEXT` | `NOT NULL` | — | `PK` | `SHA-256` hex digest of the raw session cookie token. |
| `user_id` | `UUID` | `NOT NULL` | — | `FK -> users.id ON DELETE CASCADE`, `sessions_user_id_idx` | Authenticated user owning the session. |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL` | — | `sessions_expires_at_idx` | Session expiration timestamp. |
| `ip_hash` | `TEXT` | `NULL` | `NULL` | — | Privacy-preserving `SHA-256` hash of client IP. |
| `user_agent` | `TEXT` | `NULL` | `NULL` | — | Browser/client user-agent string. |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | — | Session creation timestamp. |

#### Table 7: `public.audit_logs`
*Purpose:* Immutable security and financial audit trail.

| Column | Type | Null | Default | Constraints / Indexes | Business Meaning |
|---|---|---|---|---|---|
| `id` | `BIGINT` | `NOT NULL` | `IDENTITY` | `PK` | Monotonic audit event sequence ID. |
| `actor_id` | `UUID` | `NULL` | `NULL` | `FK -> users.id ON DELETE SET NULL`, `idx_audit_logs_actor` | User who performed the action (`NULL` for system/public). |
| `action` | `TEXT` | `NOT NULL` | — | `idx_audit_logs_action` | Action verb (e.g., `invoice.finalize`, `payment.allocate`, `receipt.cancel`). |
| `resource_type` | `TEXT` | `NULL` | `NULL` | `idx_audit_logs_resource` | Target entity type (`invoice`, `payment`, `receipt`, `client`). |
| `resource_id` | `TEXT` | `NULL` | `NULL` | `idx_audit_logs_resource` | Target entity primary key or business number. |
| `outcome` | `TEXT` | `NOT NULL` | `'success'` | `CHECK (outcome IN ('success','failure','denied'))` | Result of the operation. |
| `before_state` | `JSONB` | `NULL` | `NULL` | — | Snapshot of critical fields prior to change. |
| `after_state` | `JSONB` | `NULL` | `NULL` | — | Snapshot of critical fields after change. |
| `metadata` | `JSONB` | `NOT NULL` | `'{}'` | — | Additional context (IP hash, reason, request ID). |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `now()` | `audit_logs_created_at_idx` | Event timestamp (UTC). |

---

### 2.2 Business Settings, File Metadata, Templates, Numbering & Tax

#### Table 8: `public.company_settings`
*Purpose:* Singleton organization profile and document defaults (`id = 1`).
- Columns: `id (INT PK DEFAULT 1 CHECK (id = 1))`, `name`, `registration_number`, `tax_pin`, `address`, `phone`, `email`, `website`, `footer`, `currency (DEFAULT 'KES')`, `number_prefix (DEFAULT 'RCP')`, `invoice_prefix (DEFAULT 'INV')`, `quote_prefix (DEFAULT 'QTN')`, `payment_prefix (DEFAULT 'PAY')`, `logo_url`, `stamp_url`, `signature_url`, `updated_at`, `updated_by (FK -> users.id)`.

#### Table 9: `public.file_metadata`
*Purpose:* Secure metadata registry for all stored files (logos, stamps, signatures, client contracts, generated PDFs).
- Columns: `id (UUID PK)`, `original_filename (TEXT NOT NULL)`, `storage_key (TEXT NOT NULL UNIQUE)`, `mime_type (VARCHAR(120) NOT NULL)`, `file_size_bytes (BIGINT NOT NULL CHECK (file_size_bytes >= 0))`, `checksum_sha256 (VARCHAR(64))`, `access_classification (VARCHAR(30) NOT NULL DEFAULT 'private' CHECK (access_classification IN ('public_branding', 'authenticated', 'confidential_client', 'immutable_financial_pdf')))`, `entity_type (VARCHAR(50))`, `entity_id (UUID)`, `uploaded_by (UUID FK -> users.id ON DELETE SET NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.

#### Table 10: `public.document_templates`
*Purpose:* Configurable layout, terms, and branding templates for quotations, invoices, and receipts.
- Columns: `id (UUID PK)`, `document_type (VARCHAR(30) NOT NULL CHECK (document_type IN ('quote', 'invoice', 'receipt')))`, `name (VARCHAR(100) NOT NULL)`, `is_default (BOOLEAN NOT NULL DEFAULT false)`, `header_notes (TEXT NOT NULL DEFAULT '')`, `default_terms (TEXT NOT NULL DEFAULT '')`, `footer_notes (TEXT NOT NULL DEFAULT '')`, `config_json (JSONB NOT NULL DEFAULT '{}')`, `active (BOOLEAN NOT NULL DEFAULT true)`, `updated_by (UUID FK -> users.id ON DELETE SET NULL)`, `created_at (TIMESTAMPTZ)`, `updated_at (TIMESTAMPTZ)`.

#### Table 11: `public.numbering_sequences`
*Purpose:* Concurrency-safe atomic sequence counter for all document types (`QTN`, `INV`, `PAY`, `RCP`, `REF`).
- Columns: `document_type (VARCHAR(30) NOT NULL)`, `prefix (VARCHAR(20) NOT NULL)`, `scope_year (INT NOT NULL CHECK (scope_year >= 2000 AND scope_year <= 2100))`, `last_value (BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0))`, `padding_length (INT NOT NULL DEFAULT 6 CHECK (padding_length BETWEEN 3 AND 12))`, `updated_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Primary Key: `(document_type, prefix, scope_year)`.

#### Table 12: `public.receipt_sequences`
*Purpose:* Preserved existing receipt sequence table (`(prefix, year)` PK, `last_value BIGINT`).

#### Table 13: `public.tax_configurations`
*Purpose:* Tax rules and historical rates (e.g. Standard VAT 16%, Zero-Rated 0%, Exempt).
- Columns: `id (UUID PK)`, `code (VARCHAR(30) NOT NULL UNIQUE)`, `name (VARCHAR(100) NOT NULL)`, `rate (NUMERIC(6,4) NOT NULL CHECK (rate >= 0 AND rate <= 100))`, `tax_type (VARCHAR(30) NOT NULL DEFAULT 'vat' CHECK (tax_type IN ('vat', 'withholding', 'excise', 'levy', 'exempt')))`, `is_inclusive (BOOLEAN NOT NULL DEFAULT false)`, `applicable_to (VARCHAR(30) NOT NULL DEFAULT 'all' CHECK (applicable_to IN ('all', 'quote', 'invoice', 'receipt')))`, `effective_from (DATE NOT NULL DEFAULT CURRENT_DATE)`, `effective_to (DATE NULL)`, `active (BOOLEAN NOT NULL DEFAULT true)`, `created_by (UUID FK -> users.id ON DELETE SET NULL)`, `created_at (TIMESTAMPTZ)`, `updated_at (TIMESTAMPTZ)`.
- Constraint: `CHECK (effective_to IS NULL OR effective_to >= effective_from)`.

---

### 2.3 Client Relationship Management (CRM)

#### Table 14: `public.client_categories`
*Purpose:* Client segmentation categories (`Enterprise`, `SME`, `NGO / Public Sector`, `Individual`).
- Columns: `id (UUID PK)`, `code (VARCHAR(40) NOT NULL UNIQUE)`, `name (VARCHAR(100) NOT NULL)`, `description (TEXT NOT NULL DEFAULT '')`, `active (BOOLEAN NOT NULL DEFAULT true)`, `created_at (TIMESTAMPTZ)`.

#### Table 15: `public.clients`
*Purpose:* Canonical client entity shared across CRM, Quotations, Invoices, Payments, and Receipts.
- Columns: `id (UUID PK)`, `client_code (VARCHAR(30) UNIQUE)`, `client_type (VARCHAR(20) NOT NULL DEFAULT 'individual' CHECK (client_type IN ('individual', 'corporate')))`, `name (TEXT NOT NULL)`, `email (TEXT NOT NULL DEFAULT '')`, `phone (TEXT NOT NULL DEFAULT '')`, `address (TEXT NOT NULL DEFAULT '')`, `billing_address (TEXT NOT NULL DEFAULT '')`, `industry (VARCHAR(100) NOT NULL DEFAULT '')`, `tax_pin (VARCHAR(40) NOT NULL DEFAULT '')`, `category_id (UUID NULL FK -> client_categories.id ON DELETE SET NULL)`, `status (VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')))`, `active (BOOLEAN NOT NULL DEFAULT true)`, `notes (TEXT NOT NULL DEFAULT '')`, `last_activity_at (TIMESTAMPTZ NULL)`, `created_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `updated_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Indexes: `clients_name_idx (name)`, `clients_phone_idx (phone)`, `idx_clients_email (email)`, `idx_clients_category (category_id)`, `idx_clients_status (status)`.

#### Table 16: `public.client_contacts`
*Purpose:* Multiple named contacts for corporate or individual clients.
- Columns: `id (UUID PK)`, `client_id (UUID NOT NULL FK -> clients.id ON DELETE CASCADE)`, `full_name (VARCHAR(150) NOT NULL)`, `job_title (VARCHAR(100) NOT NULL DEFAULT '')`, `email (TEXT NOT NULL DEFAULT '')`, `phone (VARCHAR(50) NOT NULL DEFAULT '')`, `is_primary (BOOLEAN NOT NULL DEFAULT false)`, `active (BOOLEAN NOT NULL DEFAULT true)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.

#### Table 17: `public.client_tags` & Table 18: `public.client_tag_assignments`
*Purpose:* Flexible tagging of client records.
- `client_tags`: `id (UUID PK)`, `name (VARCHAR(60) NOT NULL UNIQUE)`, `color_hex (VARCHAR(7) NOT NULL DEFAULT '#5848D6')`, `created_at (TIMESTAMPTZ)`.
- `client_tag_assignments`: `client_id (UUID FK -> clients.id ON DELETE CASCADE)`, `tag_id (UUID FK -> client_tags.id ON DELETE CASCADE)`, `assigned_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, PK `(client_id, tag_id)`.

#### Table 19: `public.client_interactions`
*Purpose:* Activity log of calls, meetings, emails, follow-ups, requirements, and internal notes.
- Columns: `id (UUID PK)`, `client_id (UUID NOT NULL FK -> clients.id ON DELETE CASCADE)`, `contact_id (UUID NULL FK -> client_contacts.id ON DELETE SET NULL)`, `interaction_type (VARCHAR(30) NOT NULL CHECK (interaction_type IN ('call', 'meeting', 'email', 'follow_up', 'requirement', 'note', 'other')))`, `subject (VARCHAR(200) NOT NULL)`, `summary (TEXT NOT NULL DEFAULT '')`, `occurred_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `next_follow_up_at (TIMESTAMPTZ NULL)`, `logged_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.

#### Table 20: `public.client_documents`
*Purpose:* Links clients to confidential contracts, SLAs, and onboarding documents in `file_metadata`.
- Columns: `id (UUID PK)`, `client_id (UUID NOT NULL FK -> clients.id ON DELETE CASCADE)`, `file_id (UUID NOT NULL FK -> file_metadata.id ON DELETE RESTRICT)`, `document_category (VARCHAR(50) NOT NULL DEFAULT 'contract' CHECK (document_category IN ('contract', 'proposal', 'sla', 'kyc', 'tax_exemption', 'other')))`, `title (VARCHAR(200) NOT NULL)`, `notes (TEXT NOT NULL DEFAULT '')`, `uploaded_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.

---

### 2.4 Quotations (`quotes` & `quote_items`)

#### Table 21: `public.quotes`
*Purpose:* Commercial quotations/proposals with conversion tracking to invoices.
- Columns: `id (UUID PK)`, `quote_number (VARCHAR(40) UNIQUE)`, `client_id (UUID NOT NULL FK -> clients.id ON DELETE RESTRICT)`, `status (VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'converted', 'cancelled')))`, `issue_date (DATE NOT NULL DEFAULT CURRENT_DATE)`, `expiry_date (DATE NULL)`, `currency (VARCHAR(3) NOT NULL DEFAULT 'KES')`, `subtotal (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0))`, `discount_total (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_total >= 0))`, `tax_total (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_total >= 0))`, `total (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total >= 0))`, `terms (TEXT NOT NULL DEFAULT '')`, `notes (TEXT NOT NULL DEFAULT '')`, `company_snapshot (JSONB NULL)`, `client_snapshot (JSONB NULL)`, `created_by (UUID NOT NULL FK -> users.id ON DELETE RESTRICT)`, `finalized_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `finalized_at (TIMESTAMPTZ NULL)`, `converted_at (TIMESTAMPTZ NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `updated_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Constraint: `CHECK (expiry_date IS NULL OR expiry_date >= issue_date)`.

#### Table 22: `public.quote_items`
*Purpose:* Line items belonging to a quotation.
- Columns: `id (UUID PK)`, `quote_id (UUID NOT NULL FK -> quotes.id ON DELETE CASCADE)`, `position (INT NOT NULL DEFAULT 0)`, `description (TEXT NOT NULL)`, `quantity (NUMERIC(12,3) NOT NULL CHECK (quantity > 0))`, `unit_price (NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0))`, `discount_amount (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0))`, `tax_config_id (UUID NULL FK -> tax_configurations.id ON DELETE SET NULL)`, `tax_rate (NUMERIC(6,4) NOT NULL DEFAULT 0.0000 CHECK (tax_rate >= 0))`, `tax_amount (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0))`, `line_subtotal (NUMERIC(14,2) NOT NULL CHECK (line_subtotal >= 0))`, `line_total (NUMERIC(14,2) NOT NULL CHECK (line_total >= 0))`.

---

### 2.5 Invoicing (`invoices` & `invoice_items`)

#### Table 23: `public.invoices`
*Purpose:* Accounts receivable billing documents with authoritative allocation & balance tracking.
- Columns: `id (UUID PK)`, `invoice_number (VARCHAR(40) UNIQUE)`, `client_id (UUID NOT NULL FK -> clients.id ON DELETE RESTRICT)`, `quote_id (UUID NULL FK -> quotes.id ON DELETE SET NULL)`, `status (VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled', 'void')))`, `issue_date (DATE NOT NULL DEFAULT CURRENT_DATE)`, `due_date (DATE NULL)`, `currency (VARCHAR(3) NOT NULL DEFAULT 'KES')`, `subtotal (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0))`, `discount_total (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_total >= 0))`, `tax_total (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_total >= 0))`, `total (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total >= 0))`, `amount_allocated (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_allocated >= 0 AND amount_allocated <= total))`, `balance_due (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (balance_due >= 0 AND balance_due <= total))`, `terms (TEXT NOT NULL DEFAULT '')`, `notes (TEXT NOT NULL DEFAULT '')`, `company_snapshot (JSONB NULL)`, `client_snapshot (JSONB NULL)`, `created_by (UUID NOT NULL FK -> users.id ON DELETE RESTRICT)`, `issued_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `finalized_at (TIMESTAMPTZ NULL)`, `cancelled_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `cancelled_at (TIMESTAMPTZ NULL)`, `cancel_reason (TEXT NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `updated_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Constraints:
  - `CHECK (due_date IS NULL OR due_date >= issue_date)`
  - `CHECK (status = 'cancelled' OR status = 'void' OR (amount_allocated + balance_due = total))`

#### Table 24: `public.invoice_items`
*Purpose:* Line items belonging to an invoice.
- Columns: `id (UUID PK)`, `invoice_id (UUID NOT NULL FK -> invoices.id ON DELETE CASCADE)`, `position (INT NOT NULL DEFAULT 0)`, `description (TEXT NOT NULL)`, `quantity (NUMERIC(12,3) NOT NULL CHECK (quantity > 0))`, `unit_price (NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0))`, `discount_amount (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0))`, `tax_config_id (UUID NULL FK -> tax_configurations.id ON DELETE SET NULL)`, `tax_rate (NUMERIC(6,4) NOT NULL DEFAULT 0.0000 CHECK (tax_rate >= 0))`, `tax_amount (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0))`, `line_subtotal (NUMERIC(14,2) NOT NULL CHECK (line_subtotal >= 0))`, `line_total (NUMERIC(14,2) NOT NULL CHECK (line_total >= 0))`.

---

### 2.6 Payments (`payments`, `payment_allocations`, `payment_refunds`)

#### Table 25: `public.payments`
*Purpose:* Canonical record of actual money received from a client.
- Columns: `id (UUID PK)`, `payment_reference (VARCHAR(40) NOT NULL UNIQUE)`, `client_id (UUID NOT NULL FK -> clients.id ON DELETE RESTRICT)`, `status (VARCHAR(25) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed', 'refunded', 'partially_refunded', 'reversed')))`, `payment_method (VARCHAR(30) NOT NULL DEFAULT 'mpesa' CHECK (payment_method IN ('cash', 'mpesa', 'bank_transfer', 'card', 'cheque', 'other')))`, `external_reference (VARCHAR(100) NULL)`, `payment_date (TIMESTAMPTZ NOT NULL DEFAULT now())`, `currency (VARCHAR(3) NOT NULL DEFAULT 'KES')`, `amount (NUMERIC(14,2) NOT NULL CHECK (amount > 0))`, `amount_allocated (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_allocated >= 0))`, `amount_refunded (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_refunded >= 0))`, `amount_receipted (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_receipted >= 0))`, `unallocated_amount (NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (unallocated_amount >= 0))`, `notes (TEXT NOT NULL DEFAULT '')`, `recorded_by (UUID NOT NULL FK -> users.id ON DELETE RESTRICT)`, `confirmed_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `confirmed_at (TIMESTAMPTZ NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `updated_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Integrity Constraints:
  - `chk_payments_allocation_bounds`: `CHECK (amount_allocated + amount_refunded <= amount)`
  - `chk_payments_receipt_bounds`: `CHECK (amount_receipted <= amount - amount_refunded)`
  - `chk_payments_unallocated_sync`: `CHECK (unallocated_amount = amount - amount_allocated - amount_refunded)`

#### Table 26: `public.payment_allocations`
*Purpose:* Allocates portions of confirmed payments to specific invoices.
- Columns: `id (UUID PK)`, `payment_id (UUID NOT NULL FK -> payments.id ON DELETE RESTRICT)`, `invoice_id (UUID NOT NULL FK -> invoices.id ON DELETE RESTRICT)`, `amount (NUMERIC(14,2) NOT NULL CHECK (amount > 0))`, `status (VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')))`, `notes (TEXT NOT NULL DEFAULT '')`, `allocated_by (UUID NOT NULL FK -> users.id ON DELETE RESTRICT)`, `allocated_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `reversed_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `reversed_at (TIMESTAMPTZ NULL)`, `reversal_reason (TEXT NULL)`.

#### Table 27: `public.payment_refunds`
*Purpose:* Traceable refund/reversal events against a payment without deleting the original payment.
- Columns: `id (UUID PK)`, `refund_reference (VARCHAR(40) NOT NULL UNIQUE)`, `payment_id (UUID NOT NULL FK -> payments.id ON DELETE RESTRICT)`, `amount (NUMERIC(14,2) NOT NULL CHECK (amount > 0))`, `reason (TEXT NOT NULL)`, `status (VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')))`, `external_reference (VARCHAR(100) NULL)`, `processed_by (UUID NOT NULL FK -> users.id ON DELETE RESTRICT)`, `refunded_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.

---

### 2.7 Receipts (`receipts`, `receipt_items`, `payment_receipt_allocations`, `verify_attempts`)

#### Table 28: `public.receipts` & Table 29: `public.receipt_items`
*Purpose:* Official verifiable receipts with immutable `company_snapshot` and QR verification code.
- Includes all existing columns plus `primary_payment_id (UUID NULL FK -> payments.id ON DELETE SET NULL)` and `invoice_id (UUID NULL FK -> invoices.id ON DELETE SET NULL)`.

#### Table 30: `public.payment_receipt_allocations`
*Purpose:* Explicit M:N mapping between `payments` and `receipts` preventing double-receipting.
- Columns: `id (UUID PK)`, `payment_id (UUID NOT NULL FK -> payments.id ON DELETE RESTRICT)`, `receipt_id (UUID NOT NULL FK -> receipts.id ON DELETE CASCADE)`, `amount_acknowledged (NUMERIC(14,2) NOT NULL CHECK (amount_acknowledged > 0))`, `status (VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')))`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Unique Partial Index: `uq_payment_receipt_active ON (payment_id, receipt_id) WHERE status = 'active'`.

#### Table 31: `public.verify_attempts`
*Purpose:* Public verification audit log and rate-limiting table (`receipt_verification_logs`).

---

### 2.8 Communications (`notification_templates`, `email_logs`, `sms_logs`)

#### Table 32: `public.notification_templates`
- Columns: `id (UUID PK)`, `code (VARCHAR(50) NOT NULL UNIQUE)`, `channel (VARCHAR(15) NOT NULL CHECK (channel IN ('email', 'sms')))`, `name (VARCHAR(100) NOT NULL)`, `subject_template (TEXT NOT NULL DEFAULT '')`, `body_template (TEXT NOT NULL)`, `active (BOOLEAN NOT NULL DEFAULT true)`, `created_at (TIMESTAMPTZ)`, `updated_at (TIMESTAMPTZ)`.

#### Table 33: `public.email_logs` & Table 34: `public.sms_logs`
- Columns: `id (UUID PK)`, `client_id (UUID NULL FK -> clients.id ON DELETE SET NULL)`, `template_id (UUID NULL FK -> notification_templates.id ON DELETE SET NULL)`, `recipient (TEXT NOT NULL)`, `subject (TEXT)` (email only), `message_type (VARCHAR(40) NOT NULL)`, `related_document_type (VARCHAR(30) NULL)`, `related_document_id (UUID NULL)`, `provider (VARCHAR(40) NOT NULL DEFAULT 'smtp')`, `provider_message_id (VARCHAR(120) NULL)`, `status (VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'bounced')))`, `attempt_count (INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0))`, `sent_at (TIMESTAMPTZ NULL)`, `delivered_at (TIMESTAMPTZ NULL)`, `failure_reason (TEXT NULL)`, `metadata (JSONB NOT NULL DEFAULT '{}')`, `triggered_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.

---

### 2.9 Reconciliation (`reconciliation_batches`, `reconciliation_records`, `reconciliation_matches`)

#### Table 35: `public.reconciliation_batches`
- Columns: `id (UUID PK)`, `batch_number (VARCHAR(40) NOT NULL UNIQUE)`, `source_type (VARCHAR(30) NOT NULL CHECK (source_type IN ('mpesa_statement', 'bank_statement', 'card_settlement', 'manual_import')))`, `account_identifier (VARCHAR(100) NOT NULL DEFAULT '')`, `period_start (DATE NULL)`, `period_end (DATE NULL)`, `status (VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'completed', 'archived')))`, `total_records (INT NOT NULL DEFAULT 0)`, `matched_records (INT NOT NULL DEFAULT 0)`, `unmatched_records (INT NOT NULL DEFAULT 0)`, `imported_by (UUID NOT NULL FK -> users.id ON DELETE RESTRICT)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`, `completed_at (TIMESTAMPTZ NULL)`.

#### Table 36: `public.reconciliation_records`
- Columns: `id (UUID PK)`, `batch_id (UUID NOT NULL FK -> reconciliation_batches.id ON DELETE CASCADE)`, `external_tx_id (VARCHAR(100) NOT NULL)`, `payment_method (VARCHAR(30) NOT NULL DEFAULT 'mpesa')`, `transaction_date (TIMESTAMPTZ NOT NULL)`, `amount (NUMERIC(14,2) NOT NULL CHECK (amount > 0))`, `currency (VARCHAR(3) NOT NULL DEFAULT 'KES')`, `payer_name (TEXT NOT NULL DEFAULT '')`, `payer_phone (VARCHAR(50) NOT NULL DEFAULT '')`, `description (TEXT NOT NULL DEFAULT '')`, `match_status (VARCHAR(25) NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'suggested', 'matched', 'rejected', 'ignored')))`, `raw_payload (JSONB NOT NULL DEFAULT '{}')`, `reviewed_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `reviewed_at (TIMESTAMPTZ NULL)`, `created_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Anti-Duplicate Reconciliation Constraint: `uq_recon_external_source UNIQUE (payment_method, external_tx_id)`.

#### Table 37: `public.reconciliation_matches`
- Columns: `id (UUID PK)`, `reconciliation_record_id (UUID NOT NULL FK -> reconciliation_records.id ON DELETE CASCADE)`, `payment_id (UUID NULL FK -> payments.id ON DELETE RESTRICT)`, `invoice_id (UUID NULL FK -> invoices.id ON DELETE RESTRICT)`, `matched_amount (NUMERIC(14,2) NOT NULL CHECK (matched_amount > 0))`, `confidence_score (NUMERIC(5,2) NOT NULL DEFAULT 100.00 CHECK (confidence_score BETWEEN 0 AND 100))`, `match_state (VARCHAR(20) NOT NULL DEFAULT 'suggested' CHECK (match_state IN ('suggested', 'confirmed', 'rejected', 'unmatched')))`, `notes (TEXT NOT NULL DEFAULT '')`, `matched_by (UUID NULL FK -> users.id ON DELETE SET NULL)`, `matched_at (TIMESTAMPTZ NOT NULL DEFAULT now())`.
- Unique Confirmed Match Constraint: Partial unique index `uq_recon_record_confirmed ON (reconciliation_record_id) WHERE match_state = 'confirmed'` prevents an external statement line from being confirmed multiple times.
