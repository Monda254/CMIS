# IBMS Secrets & Configuration Management (`MP-17`)

## 1. Environment Variable Inventory

All sensitive credentials and environment-specific settings are loaded exclusively from environment variables (`.env` locally, secret manager in staging/production) and validated at startup via `fastapi_service/core/config.py` and `src/lib/db/index.ts`:

| Variable | Scope | Purpose | Security Requirement |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Backend Only (`Next.js Server` & `FastAPI`) | PostgreSQL connection string (`postgresql://...`) | Never prefixed with `NEXT_PUBLIC_`; TLS required in production |
| `FASTAPI_URL` | Next.js Server Only | Internal URL of companion FastAPI service (`http://127.0.0.1:8000`) | Internal loopback/private VPC network only |
| `NODE_ENV` / `ENVIRONMENT` | Runtime | Controls `Secure` cookie flag, HSTS, and debug modes | Must be `"production"` in deployed environments |
| `CORS_ORIGINS` | FastAPI Middleware | Allowed cross-origin origins | Restricted to explicit application origin(s); wildcard `*` prohibited with credentials |

## 2. Secret Protection Controls

- **Zero Client Bundle Exposure**: No secret or database URL uses the `NEXT_PUBLIC_` prefix. Only `NEXT_PUBLIC_FASTAPI_URL` (optional public API base override) is exposed to browser code; by default the browser uses the same-origin `/api/v1/[...path]` proxy.
- **Git Hygiene (`.gitignore`)**: `.env*` files, `.venv/`, local SQLite/dump files, and uploaded runtime artifacts are excluded from version control.
- **No Hardcoded Credentials (`SEC-08`)**: Static fallback passwords (`"WelcomeFolio2026!"`) have been removed from user creation routes and replaced with `crypto.randomBytes(16).toString("base64url")` cryptographic random generation when an admin provisions a user without specifying an initial password.
- **Audit Log Redaction (`REDACT_KEYS`)**: `sanitize_audit_dict()` in `fastapi_service/core/security.py` recursively scrubs `password`, `password_hash`, `new_password`, `current_password`, `token`, `access_token`, `refresh_token`, `reset_token`, `secret`, `card_number`, `pan`, `cvv`, and `cvc` before writing JSON metadata to `public.audit_logs`.
