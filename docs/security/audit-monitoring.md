# IBMS Security Audit Logging & Monitoring (`MP-17`)

## 1. Immutable Forensic Audit Trail (`public.audit_logs`)

Every security-sensitive and financial state transition is recorded in `public.audit_logs` via `record_audit_event()` (`fastapi_service/core/security.py`) and `logAudit()` (`src/lib/server/services.ts`):

- **Schema Attributes**:
  - `id`: UUID primary key
  - `actor_user_id`: Nullable UUID linking to `public.users.id`
  - `action`: Canonical dotted action identifier (e.g., `auth.login`, `auth.login_failed`, `auth.password_reset_completed`, `user.deactivated`, `invoice.issued`, `payment.confirmed`, `payment.allocated`, `payment.refunded`, `payment.reversed`, `receipt.generated`, `receipt.cancelled`, `receipt.print`, `company.updated`, `file.uploaded`)
  - `entity_type` & `entity_id`: Target entity type and identifier
  - `request_id`: Correlation ID (`X-Request-ID`)
  - `ip_hash`: `SHA-256` hash of caller IP address (privacy-preserving forensic correlation)
  - `user_agent`: Truncated client User-Agent (`<= 255` chars)
  - `metadata_json`: JSONB payload containing `before`, `after`, and contextual fields with secrets redacted via `sanitize_audit_dict()`
  - `created_at`: UTC timestamp (`timestamptz`)

## 2. Database-Level Append-Only Protection (`SEC-06`)

Alembic migration `20261116_0002_mp17_security_hardening.py` installs PL/pgSQL trigger `trg_protect_audit_logs_immutable` (`fn_prevent_audit_log_mutation`):
- Any `UPDATE` or `DELETE` statement targeting `public.audit_logs` raises a PostgreSQL exception (`audit_logs rows are immutable and cannot be modified or deleted`), preventing insider tampering or accidental erasure.

## 3. Security Event Monitoring & Alerting Thresholds

| Event Pattern | Query / Signal in `public.audit_logs` / `verify_attempts` | Alert Threshold | Automated / Operational Action |
| :--- | :--- | :--- | :--- |
| **Credential Brute Force** | `action = 'auth.login_failed'` grouped by `ip_hash` | `>= 10` within `15 min` | Automatically blocked with `429 RATE_LIMITED` via `check_db_auth_rate_limit()` |
| **Public Verification Scraping** | `public.verify_attempts` grouped by `ip_hash` or `identifier` | `>= 30/hr` (IP) or `>= 10/10m` (code) | Automatically blocked with `429 RATE_LIMITED` |
| **Privileged Financial Reversals** | `action IN ('payment.refunded', 'payment.reversed', 'receipt.cancelled', 'invoice.cancelled')` | Any occurrence | Logged with mandatory `reason`, `before`/`after` snapshots, and `actor_user_id` for daily finance audit review |
| **Staff Account Lifecycle Changes** | `action IN ('user.created', 'user.updated', 'user.deactivated')` | Any occurrence | Immediate session revocation (`DELETE FROM public.sessions`) on deactivation |
