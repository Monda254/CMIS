# MP-15 · Public Receipt Verification Contract (`docs/api/public-verification.md`)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-15

---

## 1. Public Endpoints

- `GET /api/v1/verification/{verification_code}`
- `POST /api/v1/verification` (`{"identifier": "<verification_code_or_receipt_number>"}`)

These endpoints are intentionally separated from authenticated internal routes so external customers, auditors, and QR-code scanners can verify the authenticity of a receipt without logging in.

---

## 2. Privacy & Anti-Enumeration Guarantees

1. **Strict Field Projection**:
   - Returns **only**: `result` (`valid`, `cancelled`, `not_found`, `invalid`), `receipt_number`, `code_hint` (e.g., `DTX****2A5`), `customer` (masked, e.g., `J******** K****`), `issued_at`, `total`, `amount_paid`, `balance_due`, `payment_status`, `payment_method`, `currency`, `company` (from `company_snapshot.name`), `cancelled_at`, and `cancel_reason`.
   - **Never** exposes internal CRM client notes, customer phone numbers, customer addresses, client tax PINs, staff user IDs, or unissued draft receipts.
2. **Database-Backed Rate Limiting (`public.verify_attempts`)**:
   - Caller IP addresses are hashed with `SHA-256` (`sha256("verify:" + ip)`).
   - Enforces a maximum of **30 attempts per hour per visitor IP hash** and **10 attempts per 10 minutes per target identifier**.
   - Exceeding either threshold returns `429 RATE_LIMIT_EXCEEDED`.
3. **Every Lookup is Logged**:
   - Every valid, cancelled, or not-found verification attempt is recorded in `public.verify_attempts` for security monitoring.
