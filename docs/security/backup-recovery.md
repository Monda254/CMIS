# IBMS Backup, Disaster Recovery & Restoration Verification (`MP-17`)

## 1. Recovery Objectives & Scope

- **Recovery Point Objective (`RPO`)**: `<= 15 minutes` (continuous WAL archiving / Supabase Point-in-Time Recovery + scheduled logical snapshots).
- **Recovery Time Objective (`RTO`)**: `<= 60 minutes` for full database + application service restoration.
- **In-Scope Persistent State**:
  1. PostgreSQL `public` schema (`37` tables, `1` view `v_client_ledger_summary`, `4` PL/pgSQL integrity/immutability triggers, `alembic_version`).
  2. Uploaded branding and attachment objects (`public.stored_files` metadata + `public/uploads/branding` files).

## 2. Secure Backup Procedures

1. **Logical Full Schema & Data Backup (`pg_dump`)**:
   ```bash
   pg_dump "$DATABASE_URL" \
     --format=custom \
     --no-owner \
     --no-privileges \
     --schema=public \
     --file="backups/ibms_$(date -u +%Y%m%dT%H%M%SZ).dump"
   ```
2. **Encryption & Storage**:
   - Backup archives must be encrypted at rest (`AES-256`) and never committed to Git (`backups/` and `*.dump` excluded).
   - Access to backup archives is restricted strictly to Database Administrators and Incident Commanders.

## 3. Restoration & Integrity Verification Drill

Every backup cycle must be validated by restoring into an isolated verification schema/database or temporary verification table and running:
1. `alembic upgrade head` verification (`alembic_version.version_num = '20261116_0002'`).
2. Row count and `NUMERIC(15,2)` ledger balance verification across `company_settings`, `numbering_sequences`, `invoices`, `payments`, `payment_allocations`, `receipts`, and `audit_logs`.
3. Automated drill verification is codified in `tests/test_mp17_security.py::test_19_7_backup_and_restore_drill_verification`.
