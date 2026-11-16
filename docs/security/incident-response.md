# IBMS Security Incident Response Playbook (`MP-17`)

## 1. Severity Classification

| Severity | Description | Response SLA | Examples |
| :--- | :--- | :--- | :--- |
| **SEV-1 (Critical)** | Active compromise of credentials, financial ledger tampering, or unauthorized access to database/secrets | `< 15 minutes` | Leaked `DATABASE_URL`, compromised `admin` session, unauthorized receipt cancellation or payment refund |
| **SEV-2 (High)** | Sustained brute-force attack, verification endpoint scraping, or privilege escalation attempt | `< 1 hour` | Repeated `403` on financial admin endpoints from a staff account, spike in `auth.login_failed` |
| **SEV-3 (Medium)** | Isolated policy violation or suspicious file upload blocked by magic-byte/extension filters | `< 4 hours` | `INVALID_FILE_SIGNATURE` or `UNSAFE_FILE_EXTENSION` events in logs |

---

## 2. Step-by-Step Containment & Eradication Runbooks

### Runbook A: Suspected Compromised Staff Account
1. **Contain Immediately**:
   - Deactivate the account via `POST /api/v1/users/{user_id}/deactivate` (or `PATCH /api/users`), which sets `users.active = false` and immediately executes `DELETE FROM public.sessions WHERE user_id = :uid`.
2. **Investigate via Immutable Audit Trail**:
   - Query `GET /api/v1/audit-logs?actor_user_id=<uuid>` to inspect every action, `request_id`, `ip_hash`, and `before`/`after` state performed by the account.
3. **Remediate Financial Impact**:
   - If unauthorized invoices or receipts were issued, execute privileged cancellation (`POST /api/v1/invoices/{id}/cancel` or `POST /api/v1/receipts/{id}/cancel`) with an explicit incident reference reason.
4. **Recover**:
   - Require out-of-band identity verification and password rotation before reactivating the account.

### Runbook B: Suspected Database Credential Exposure
1. **Rotate Credentials**: Rotate the PostgreSQL password in Supabase/PostgreSQL and update `DATABASE_URL` in environment secrets.
2. **Invalidate All Active Sessions**: Execute `DELETE FROM public.sessions;` and `DELETE FROM public.password_reset_tokens;` to force re-authentication for all users.
3. **Verify Forensic Integrity**: Run `pytest tests/test_mp14_database.py tests/test_mp17_security.py` to confirm all 37 tables, RLS policies, and all 4 PL/pgSQL triggers (`trg_protect_audit_logs_immutable`, `trg_protect_immutable_financial_docs`, `trg_validate_payment_allocation`, `trg_validate_receipt_generation`) remain intact.
