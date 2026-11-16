# MP-15 · Authentication & Authorization (`docs/api/authentication.md`)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-15

---

## 1. Authentication Architecture

The IBMS API shares its authoritative identity store (`public.users` and `public.sessions`) with the Next.js frontend:

1. **Password Hashing (`scrypt`)**:
   - Passwords are stored exclusively as salted `scrypt` digests in the format `scrypt$<16-byte-hex-salt>$<64-byte-hex-derived-key>` (`N=16384, r=8, p=1, dklen=64`).
   - Plaintext passwords are never logged or persisted.
2. **Opaque Session Tokens (`SHA-256` Digests)**:
   - On `POST /api/v1/auth/login`, the backend generates a cryptographically random 256-bit URL-safe token (`access_token`) and stores only its `SHA-256` hex digest (`sessions.id`) in `public.sessions` with a 14-day expiration (`expires_at`) and hashed IP (`ip_hash`).
   - The raw token is returned in both:
     - The JSON response (`data.access_token`) for `Authorization: Bearer <token>` clients.
     - An `HttpOnly`, `SameSite=Lax` cookie (`ledgerly_session`) for browser clients.
3. **Deactivation & Immediate Session Revocation**:
   - When an administrator deactivates a user (`POST /api/v1/users/{user_id}/deactivate` or `PATCH /api/v1/users/{user_id}` with `active: false`), all active rows in `public.sessions` for that user are deleted immediately within the same transaction.

---

## 2. Role-Based & Permission-Based Access Control (RBAC)

Authorization is evaluated on every protected endpoint via `get_current_user`, `require_admin`, and `require_permission("<module>:<action>")`:

| Role | Granted Capabilities |
|---|---|
| `admin` | Full administrative access (`*`), including user/role management, company settings, tax rules, invoice/receipt cancellation, payment reversal, financial reports, and audit logs. |
| `accountant` | Full CRM, Quotations, Invoices, Payments (including refunds), Receipts, Reconciliation, Dashboard, and Financial Reports (`reports:read`). |
| `cashier` | Day-to-day operational access: CRM (`clients:read`, `clients:write`), Quotations, Invoices (`invoices:read`, `invoices:write`, `invoices:issue`), Payments (`payments:write`, `payments:confirm`, `payments:allocate`), Receipts (`receipts:write`, `receipts:finalize`, `receipts:print`), and Dashboard counts. Cannot manage users, change company settings, cancel documents, reverse payments, or view executive reports/audit logs. |
| `auditor` | Read-only inspection across CRM, Quotations, Invoices, Payments, Receipts, Reconciliation, Reports (`reports:read`), and Audit Logs (`audit:read`). |
| Custom Roles | Stored in `public.roles` and mapped to granular capabilities in `public.permissions` via `public.role_permissions` and `public.user_roles`. |
