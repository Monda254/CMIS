# IBMS Security Testing & Verification Guide (`MP-17`)

## 1. Automated Security Test Suites

IBMS includes three layers of automated security and integrity tests executed against live PostgreSQL and the full ASGI/React stack:

1. **MP-17 Dedicated Security Hardening Suite (`tests/test_mp17_security.py` — `19` tests)**:
   - **19.1 Authentication (`5` tests)**: Invalid login & enumeration resistance, expired/forged session rejection, deactivated user login block & immediate session revocation (`SEC-01`), sliding-window + PostgreSQL-backed brute-force rate limiting (`SEC-02`, `SEC-07`), and password change session invalidation.
   - **19.2 Authorization (`3` tests)**: Unauthenticated `401` across all 12 protected module routers, cashier vertical privilege escalation blocking (`403`), and cross-client payment allocation horizontal escalation blocking (`409 CLIENT_MISMATCH`).
   - **19.3 API Security (`3` tests)**: SQL injection & sort-field whitelist enforcement (`400 INVALID_SORT_FIELD`), mass-assignment rejection (`422`), and HTTP security headers + stack-trace suppression (`SEC-04`, `SEC-05`).
   - **19.4 Financial Security (`4` tests)**: Binary float and client-supplied `total` rejection (`422`), unconfirmed payment allocation/receipting guard (`409`), over-allocation & duplicate receipting guard (`409 DUPLICATE_RECEIPT`), and issued document immutability + cashier refund/void blocking (`403`/`409`).
   - **19.5 File Security (`1` comprehensive multi-vector test)**: Executable `.sh` extension rejection (`400 UNSAFE_FILE_EXTENSION`), spoofed PNG/WebP magic-byte rejection (`400 INVALID_FILE_SIGNATURE`), path traversal stripping (`../../etc/passwd`), and `X-Content-Type-Options: nosniff` on download (`SEC-03`).
   - **19.6 & 19.7 Frontend Hardening, Audit Immutability & Backup Drill (`3` tests)**: Next.js config & route hardening assertions (`SEC-08`), PostgreSQL `trg_protect_audit_logs_immutable` `UPDATE`/`DELETE` rejection (`SEC-06`), and non-destructive backup/restore verification drill.
2. **MP-14 Database Integrity & RLS Suite (`tests/test_mp14_database.py` — `25` tests)**:
   - Validates all 37 tables, `ROW LEVEL SECURITY` enabled on all 37 tables, PL/pgSQL financial triggers, and concurrent `ThreadPoolExecutor` race-condition protection.
3. **MP-15 API Security & Workflow Suite (`tests/test_mp15_api.py` — `33` tests)** & **MP-16 Frontend Suite (`src/test/app-routing.test.tsx` — `9` tests)**:
   - Validates end-to-end financial workflows, CSV/Excel formula injection neutralization, integer-cent preview math, and RBAC permission helpers.

## 2. How to Run Security Verification

```bash
# 1. Apply all database migrations (including 20261116_0002 audit log immutability trigger)
./.venv/bin/alembic -c fastapi_service/alembic.ini upgrade head

# 2. Execute backend & database security suites
./.venv/bin/pytest tests/test_mp17_security.py tests/test_mp14_database.py tests/test_mp15_api.py -v

# 3. Execute frontend static type check, linter, and Vitest security tests
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src
./node_modules/.bin/vitest run
```
