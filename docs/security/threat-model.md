# IBMS Threat Model (`STRIDE` — `MP-17`)

## 1. Critical Assets Protected

1. **Identity & Session Credentials**: `public.users.password_hash`, `public.sessions.id`, `public.password_reset_tokens.token_hash`.
2. **Financial Ledger & Commercial Documents**: `public.quotations`, `public.invoices`, `public.payments`, `public.payment_allocations`, `public.receipts`, `public.reconciliation_statements`.
3. **Client & Company Master Data**: `public.clients` (KRA PINs, contact info, credit limits), `public.company_settings` (tax PINs, bank accounts, branding stamps/signatures).
4. **Public Verification Integrity**: `public.receipts.verification_code`, `public.verify_attempts`.
5. **Audit Trail**: `public.audit_logs` (immutable forensic record of all sensitive actions).

---

## 2. STRIDE Threat Matrix

| Threat ID | STRIDE Category | Component / Surface | Threat Scenario | Risk Rating | Implemented Mitigation |
| :--- | :--- | :--- | :--- | :--- | :---
| **TM-01** | **S**poofing | `/api/auth/login`, `/api/v1/auth/login` | Brute-force credential stuffing or password spraying across single or multiple workers | **High** | Dual-layer rate limiting (in-memory + PostgreSQL `check_db_auth_rate_limit` on `audit_logs`), `scrypt` hashing, constant-time digest comparison, generic `INVALID_CREDENTIALS` error |
| **TM-02** | **S**poofing | Session Lifecycle (`/api/users`, `/api/v1/users/{id}/deactivate`) | Deactivated or terminated employee continues using pre-existing session cookie/token | **Critical** | Immediate `DELETE FROM public.sessions WHERE user_id = :uid` on deactivation and password reset, plus live `user.active` check on every authenticated request (`SEC-01`) |
| **TM-03** | **T**ampering | Financial Endpoints (`/api/v1/invoices`, `/api/v1/payments`, `/api/v1/receipts`) | Attacker submits tampered `total`, binary float values, or modifies an already-issued invoice/receipt | **Critical** | `StrictInputModel` (`extra="forbid"`), `MoneyDecimal` float rejection, server-side `compute_authoritative_document_totals()`, and PostgreSQL trigger `trg_protect_immutable_financial_docs` |
| **TM-04** | **T**ampering | Payment Allocation & Receipt Generation | Concurrent requests attempt double-allocation of one payment or duplicate receipt issuance | **Critical** | `SELECT ... FOR UPDATE` row locking on `payments` and `invoices`, `Idempotency-Key` replay cache, and PL/pgSQL triggers `trg_validate_payment_allocation` & `trg_validate_receipt_generation` |
| **TM-05** | **T**ampering | File Upload (`/api/v1/files/upload`, `/api/settings/branding`) | Uploading HTML/JS/executable disguised with `.png` or `.webp` extension to achieve Stored XSS or RCE | **High** | Extension allowlist, MIME allowlist, binary magic-byte header verification (`%PDF-`, `\x89PNG`, `\xff\xd8\xff`, `RIFF....WEBP`), random storage keys, and `nosniff` + sandbox CSP on download (`SEC-03`) |
| **TM-06** | **R**epudiation | `public.audit_logs` | Compromised insider or admin attempts to `UPDATE` or `DELETE` audit records to hide fraudulent refunds or voids | **High** | PostgreSQL trigger `trg_protect_audit_logs_immutable` (`20261116_0002`) blocks all `UPDATE` and `DELETE` statements on `public.audit_logs` (`SEC-06`) |
| **TM-07** | **I**nformation Disclosure | Public Verification (`/api/public/verify`, `/api/v1/public/verify/{code}`) | Enumerating receipt verification codes or scraping sensitive client phone/email/PIN from public receipts | **High** | 30/hr per IP hash and 10/10min per identifier DB-backed rate limits in `verify_attempts`; public payload returns masked buyer name (`mask_client_name`) and omits client phone, email, address, and KRA PIN |
| **TM-08** | **I**nformation Disclosure | Error Handling (`src/lib/server/http.ts`, FastAPI exception handlers) | Unhandled database exceptions leaking SQL queries, table names, or stack traces in `500` responses | **Medium** | Sanitized error envelopes returning generic `"An unexpected internal server error occurred."` while logging full details server-side with `X-Request-ID` (`SEC-04`) |
| **TM-09** | **D**enial of Service | File Uploads, Paginated List Queries | Oversized upload payloads or unbounded query `page_size` exhausting memory/DB connections | **Medium** | 2 MB branding limit, 10 MB attachment limit, `PaginationParams` max `page_size=100`, SQLAlchemy pool limits (`pool_size=10`, `max_overflow=20`, `pool_pre_ping=True`) |
| **TM-10** | **E**levation of Privilege | RBAC Protected Routes (`/api/v1/users`, `/api/v1/payments/{id}/refund`, `/api/v1/audit-logs`) | Cashier attempts to create admin users, approve refunds, cancel finalized receipts, or alter tax settings | **Critical** | Backend `require_roles("admin")` and `require_permissions(...)` enforced on every mutating and administrative route; verified by automated privilege escalation tests |
