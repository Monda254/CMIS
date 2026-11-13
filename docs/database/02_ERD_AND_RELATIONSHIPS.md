# MP-14 · Deliverable 2: Complete Entity Relationship Diagrams (ERDs)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-14

This document provides all five required Entity Relationship Diagrams in maintainable Mermaid `erDiagram` and `flowchart` syntax:
1. **High-Level Domain ERD**
2. **Complete Logical ERD**
3. **Physical Database ERD (with PostgreSQL Data Types, PKs, FKs, UKs)**
4. **Financial Transaction Relationship Diagram**
5. **User, Role & Permission (RBAC) Relationship Diagram**

---

## 1. High-Level Domain ERD

Shows how the 10 core domain clusters connect across the business lifecycle (`Client → Interaction → Quotation → Invoice → Payment → Receipt → Reconciliation → Audit`).

```mermaid
erDiagram
    IDENTITY_AND_IAM ||--o{ CRM_CLIENTS : "manages"
    IDENTITY_AND_IAM ||--o{ QUOTATIONS : "authors"
    IDENTITY_AND_IAM ||--o{ INVOICES : "issues"
    IDENTITY_AND_IAM ||--o{ PAYMENTS : "records"
    IDENTITY_AND_IAM ||--o{ RECEIPTS : "finalizes"
    IDENTITY_AND_IAM ||--o{ AUDIT_LOGS : "generates"

    BUSINESS_SETTINGS ||--o{ QUOTATIONS : "snapshots_into"
    BUSINESS_SETTINGS ||--o{ INVOICES : "snapshots_into"
    BUSINESS_SETTINGS ||--o{ RECEIPTS : "snapshots_into"
    TAX_CONFIGURATIONS ||--o{ QUOTATIONS : "applies_to"
    TAX_CONFIGURATIONS ||--o{ INVOICES : "applies_to"

    CRM_CLIENTS ||--o{ QUOTATIONS : "receives"
    CRM_CLIENTS ||--o{ INVOICES : "billed_via"
    CRM_CLIENTS ||--o{ PAYMENTS : "pays"
    CRM_CLIENTS ||--o{ RECEIPTS : "acknowledged_by"
    CRM_CLIENTS ||--o{ COMMUNICATIONS : "notified_via"

    QUOTATIONS |o--o{ INVOICES : "converts_to"
    INVOICES ||--o{ PAYMENT_ALLOCATIONS : "settled_by"
    PAYMENTS ||--o{ PAYMENT_ALLOCATIONS : "allocated_via"
    PAYMENTS ||--o{ PAYMENT_RECEIPT_ALLOCATIONS : "acknowledged_via"
    RECEIPTS ||--o{ PAYMENT_RECEIPT_ALLOCATIONS : "covers"
    PAYMENTS ||--o{ RECONCILIATION_MATCHES : "reconciled_with"
```

---

## 2. Complete Logical ERD

Shows every canonical entity, relationship cardinality (`||--o{`, `|o--o{`, `}o--o{`), and junction table across the entire platform.

```mermaid
erDiagram
    users ||--o{ sessions : "has_active"
    users ||--o{ user_roles : "assigned"
    roles ||--o{ user_roles : "granted_to"
    roles ||--o{ role_permissions : "includes"
    permissions ||--o{ role_permissions : "belongs_to"
    users ||--o{ audit_logs : "performs"

    client_categories |o--o{ clients : "categorizes"
    clients ||--o{ client_contacts : "has_contacts"
    clients ||--o{ client_tag_assignments : "tagged_with"
    client_tags ||--o{ client_tag_assignments : "applied_to"
    clients ||--o{ client_interactions : "has_history"
    clients ||--o{ client_documents : "owns_files"
    file_metadata ||--o{ client_documents : "stores_ref"

    clients ||--o{ quotes : "requests"
    quotes ||--|{ quote_items : "contains"
    tax_configurations |o--o{ quote_items : "taxes"

    clients ||--o{ invoices : "owes"
    quotes |o--o{ invoices : "converted_into"
    invoices ||--|{ invoice_items : "contains"
    tax_configurations |o--o{ invoice_items : "taxes"

    clients ||--o{ payments : "remits"
    payments ||--o{ payment_allocations : "allocates"
    invoices ||--o{ payment_allocations : "receives_allocation"
    payments ||--o{ payment_refunds : "refunded_by"

    clients ||--o{ receipts : "issued_to"
    receipts ||--|{ receipt_items : "itemizes"
    payments ||--o{ payment_receipt_allocations : "covered_by"
    receipts ||--o{ payment_receipt_allocations : "acknowledges"
    receipts |o--o{ verify_attempts : "verified_by"

    reconciliation_batches ||--o{ reconciliation_records : "contains_lines"
    reconciliation_records ||--o{ reconciliation_matches : "matched_in"
    payments |o--o{ reconciliation_matches : "matched_to"
    invoices |o--o{ reconciliation_matches : "matched_to_invoice"

    notification_templates |o--o{ email_logs : "renders"
    notification_templates |o--o{ sms_logs : "renders"
    clients |o--o{ email_logs : "receives_email"
    clients |o--o{ sms_logs : "receives_sms"
```

---

## 3. Physical Database ERD (Core Tables, Columns, Keys & Types)

```mermaid
erDiagram
    clients {
        uuid id PK
        varchar client_code UK
        varchar client_type "individual | corporate"
        text name
        text email
        text phone
        text address
        text billing_address
        varchar tax_pin
        uuid category_id FK
        varchar status "active | inactive | archived"
        boolean active
        timestamptz last_activity_at
        uuid created_by FK
        timestamptz created_at
        timestamptz updated_at
    }

    quotes {
        uuid id PK
        varchar quote_number UK
        uuid client_id FK
        varchar status "draft | sent | approved | rejected | expired | converted | cancelled"
        date issue_date
        date expiry_date
        varchar currency
        numeric_14_2 subtotal
        numeric_14_2 discount_total
        numeric_14_2 tax_total
        numeric_14_2 total
        jsonb company_snapshot
        jsonb client_snapshot
        uuid created_by FK
        timestamptz finalized_at
        timestamptz created_at
    }

    invoices {
        uuid id PK
        varchar invoice_number UK
        uuid client_id FK
        uuid quote_id FK "nullable"
        varchar status "draft | issued | partially_paid | paid | overdue | cancelled | void"
        date issue_date
        date due_date
        varchar currency
        numeric_14_2 subtotal
        numeric_14_2 discount_total
        numeric_14_2 tax_total
        numeric_14_2 total
        numeric_14_2 amount_allocated
        numeric_14_2 balance_due
        jsonb company_snapshot
        jsonb client_snapshot
        uuid created_by FK
        uuid issued_by FK
        timestamptz finalized_at
        timestamptz cancelled_at
    }

    payments {
        uuid id PK
        varchar payment_reference UK
        uuid client_id FK
        varchar status "pending | confirmed | failed | refunded | partially_refunded | reversed"
        varchar payment_method "cash | mpesa | bank_transfer | card | cheque | other"
        varchar external_reference
        timestamptz payment_date
        varchar currency
        numeric_14_2 amount
        numeric_14_2 amount_allocated
        numeric_14_2 amount_refunded
        numeric_14_2 amount_receipted
        numeric_14_2 unallocated_amount
        uuid recorded_by FK
        uuid confirmed_by FK
        timestamptz confirmed_at
    }

    payment_allocations {
        uuid id PK
        uuid payment_id FK
        uuid invoice_id FK
        numeric_14_2 amount
        varchar status "active | reversed"
        uuid allocated_by FK
        timestamptz allocated_at
        timestamptz reversed_at
    }

    payment_refunds {
        uuid id PK
        varchar refund_reference UK
        uuid payment_id FK
        numeric_14_2 amount
        varchar reason
        varchar status "pending | completed | failed"
        varchar external_reference
        uuid processed_by FK
        timestamptz refunded_at
    }

    receipts {
        uuid id PK
        receipt_status status "draft | finalized | cancelled"
        text receipt_number UK
        text verification_code UK
        uuid client_id FK
        uuid primary_payment_id FK "nullable"
        text customer_name
        varchar currency
        numeric_14_2 total
        text payment_status
        numeric_14_2 amount_paid
        numeric_14_2 balance_due
        text payment_method
        jsonb company_snapshot
        uuid created_by FK
        uuid issued_by FK
        timestamptz finalized_at
        timestamptz cancelled_at
    }

    payment_receipt_allocations {
        uuid id PK
        uuid payment_id FK
        uuid receipt_id FK
        numeric_14_2 amount_acknowledged
        varchar status "active | cancelled"
        timestamptz created_at
    }

    clients ||--o{ quotes : "client_id"
    clients ||--o{ invoices : "client_id"
    clients ||--o{ payments : "client_id"
    clients ||--o{ receipts : "client_id"
    quotes |o--o{ invoices : "quote_id"
    invoices ||--o{ payment_allocations : "invoice_id"
    payments ||--o{ payment_allocations : "payment_id"
    payments ||--o{ payment_refunds : "payment_id"
    payments ||--o{ payment_receipt_allocations : "payment_id"
    receipts ||--o{ payment_receipt_allocations : "receipt_id"
```

---

## 4. Financial Transaction Relationship Diagram

Illustrates the strict separation between **Billing (`invoices`)**, **Cash Collection (`payments`)**, **Invoice Settlement (`payment_allocations`)**, **Acknowledgment (`receipts` + `payment_receipt_allocations`)**, **Reversals (`payment_refunds`)**, and **Bank/M-Pesa Reconciliation (`reconciliation_matches`)**.

```mermaid
flowchart TB
    subgraph Billing["1. Billing Layer (Accounts Receivable)"]
        QTN["Quotation (quotes)\nQTN-2026-000101\nTotal: KES 100,000"]
        INV["Invoice (invoices)\nINV-2026-000101\nTotal: KES 100,000\nAllocated: KES 100,000\nBalance Due: KES 0"]
        QTN -. "Optional conversion\n(invoices.quote_id)" .-> INV
    end

    subgraph Collection["2. Cash Collection Layer (Authoritative Money In)"]
        PAY1["Payment 1 (payments)\nPAY-2026-000201\nConfirmed: KES 40,000"]
        PAY2["Payment 2 (payments)\nPAY-2026-000202\nConfirmed: KES 60,000"]
        REF["Payment Refund (payment_refunds)\nPreserves original payment\nReduces net collections"]
        PAY1 --> REF
    end

    subgraph Settlement["3. Allocation Layer (Invoice Settlement)"]
        ALLOC1["Allocation 1 (payment_allocations)\nPayment 1 -> Invoice: KES 40,000\n(Balance after = KES 60,000)"]
        ALLOC2["Allocation 2 (payment_allocations)\nPayment 2 -> Invoice: KES 60,000\n(Balance after = KES 0)"]
        PAY1 --> ALLOC1 --> INV
        PAY2 --> ALLOC2 --> INV
    end

    subgraph Acknowledgment["4. Receipt Layer (Verifiable Proof of Payment)"]
        PRA1["Receipt Coverage 1\n(payment_receipt_allocations)\nKES 40,000"]
        PRA2["Receipt Coverage 2\n(payment_receipt_allocations)\nKES 60,000"]
        RCP1["Receipt 1 (receipts)\nRCP-2026-000301\nAmount: KES 40,000"]
        RCP2["Receipt 2 (receipts)\nRCP-2026-000302\nAmount: KES 60,000"]
        PAY1 --> PRA1 --> RCP1
        PAY2 --> PRA2 --> RCP2
    end

    subgraph Recon["5. External Statement Reconciliation"]
        EXT["External Statement Line\n(reconciliation_records)\nM-Pesa / Bank TX ID"]
        MATCH["Reconciliation Match\n(reconciliation_matches)\nConfirmed 1:1 or N:1"]
        EXT --> MATCH --> PAY1
    end
```

---

## 5. User, Role & Permission (RBAC) Relationship Diagram

```mermaid
erDiagram
    users {
        uuid id PK
        text email UK
        text password_hash
        text full_name
        app_role role "admin | cashier (legacy primary role)"
        boolean active
        text reset_token_hash
        timestamptz reset_token_expires_at
        timestamptz last_login_at
        timestamptz created_at
        timestamptz updated_at
    }

    roles {
        uuid id PK
        varchar code UK "admin | cashier | accountant | auditor | crm_manager"
        varchar name
        text description
        boolean is_system
        timestamptz created_at
    }

    permissions {
        uuid id PK
        varchar code UK "e.g. invoices:write, receipts:cancel, payments:allocate"
        varchar module
        text description
        timestamptz created_at
    }

    user_roles {
        uuid user_id PK,FK
        uuid role_id PK,FK
        uuid assigned_by FK
        timestamptz assigned_at
    }

    role_permissions {
        uuid role_id PK,FK
        uuid permission_id PK,FK
        timestamptz granted_at
    }

    sessions {
        text id PK "SHA-256 token hash"
        uuid user_id FK
        timestamptz expires_at
        text ip_hash
        text user_agent
        timestamptz created_at
    }

    audit_logs {
        bigint id PK
        uuid actor_id FK
        text action
        text resource_type
        text resource_id
        text outcome
        jsonb before_state
        jsonb after_state
        jsonb metadata
        timestamptz created_at
    }

    users ||--o{ user_roles : "user_id"
    roles ||--o{ user_roles : "role_id"
    roles ||--o{ role_permissions : "role_id"
    permissions ||--o{ role_permissions : "permission_id"
    users ||--o{ sessions : "user_id"
    users ||--o{ audit_logs : "actor_id"
```
