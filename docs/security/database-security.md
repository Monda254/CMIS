# IBMS Database Security Architecture (`MP-17`)

## 1. Schema & Access Control Hardening

- **Unified Single-Source-of-Truth Schema**: All 37 tables reside in the PostgreSQL `public` schema managed through Alembic migrations (`20261112_0001_mp14_enterprise_ibms_schema.py` and `20261116_0002_mp17_security_hardening.py`).
- **Row-Level Security (`RLS`)**: All 37 tables in `public` have `ROW LEVEL SECURITY` enabled (`relrowsecurity = true` in `pg_class`), preventing unauthorized PostgREST/anonymous role access while permitting authenticated backend service operations.
- **Parameterized Queries Only**: Both SQLAlchemy 2.x (`select()`, bound `text(:param)`) and Drizzle ORM execute strictly parameterized SQL statements. Dynamic SQL string concatenation is prohibited across the codebase.

## 2. Database-Enforced Integrity Triggers

Four PL/pgSQL triggers enforce critical financial and forensic invariants directly inside PostgreSQL, protecting data integrity even if application code is bypassed:

1. **`trg_validate_payment_allocation` (`fn_validate_payment_allocation`)**:
   - Blocks allocations unless `payments.status = 'confirmed'`.
   - Blocks cross-client allocations (`payment.client_id != invoice.client_id`).
   - Blocks over-allocation beyond `payment.amount` or `invoice.total`.
2. **`trg_validate_receipt_generation` (`fn_validate_receipt_generation`)**:
   - Blocks linking a receipt to an unconfirmed payment (`payment.status != 'confirmed'`).
3. **`trg_protect_immutable_financial_docs` (`fn_protect_immutable_financial_docs`)**:
   - Blocks modifying monetary fields (`subtotal`, `discount_total`, `tax_total`, `total`, `client_id`) on finalized/issued `invoices` and `receipts`.
4. **`trg_protect_audit_logs_immutable` (`fn_prevent_audit_log_mutation` — `SEC-06`)**:
   - Blocks any `UPDATE` or `DELETE` operation on `public.audit_logs` (`BEFORE UPDATE OR DELETE ON public.audit_logs FOR EACH ROW`), guaranteeing an append-only forensic audit trail.

## 3. Sensitive Data Minimization & Hashing

- **No Raw Payment Card Data**: PCI-sensitive fields (`card_number`, `pan`, `cvv`, `cvc`, `pin`) are rejected at API input validation and redacted in `sanitize_audit_dict()`.
- **IP Address Privacy**: Visitor IP addresses in `public.verify_attempts` and `public.audit_logs` are hashed with `SHA-256` (`ip_hash`) rather than storing raw personal IP addresses.
- **Reset Token Hashing**: Password reset tokens in `public.password_reset_tokens` store only `SHA-256` digests (`token_hash`).
