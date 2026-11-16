# IBMS Security Architecture (`MP-17`)

## 1. Defense-in-Depth Architecture Overview

The Integrated Business Management System (**IBMS / Ledgerly**) implements a 5-layer defense-in-depth security model across its Next.js 15 App Router frontend, FastAPI modular monolith backend (`fastapi_service`), and PostgreSQL 17 database (`public` schema):

1. **Edge & Transport Layer**:
   - Strict HTTP Security Headers enforced on both Next.js (`next.config.ts`) and FastAPI (`SecurityAndObservabilityMiddleware` in `fastapi_service/core/middleware.py`):
     - `Content-Security-Policy`
     - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
     - `X-Content-Type-Options: nosniff`
     - `X-Frame-Options: DENY`
     - `Referrer-Policy: strict-origin-when-cross-origin`
     - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
   - Correlation tracking via `X-Request-ID` propagated from client/proxy through FastAPI into `public.audit_logs`.
2. **Authentication & Session Layer**:
   - Passwords hashed exclusively with `scrypt` (`n=16384, r=8, p=1`, 16-byte cryptographic salt, 64-byte derived key) and verified via `hmac.compare_digest` / `timingSafeEqual`.
   - Server-managed session records stored in `public.sessions` (`id`, `user_id`, `expires_at`) and delivered to browsers via `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookies (`ledgerly_session`).
   - Dual-layer authentication rate limiting: in-memory sliding-window limiter plus PostgreSQL-backed failed-login window (`check_db_auth_rate_limit` inspecting `auth.login_failed` events by `SHA-256` IP hash in `public.audit_logs`).
   - Immediate session revocation (`DELETE FROM public.sessions`) upon logout, password change/reset, or user deactivation.
3. **Authorization Layer (RBAC + Object-Level Guards)**:
   - Backend route dependencies (`get_current_user`, `require_roles`, `require_permissions`) resolve the caller's live `users.active` status, legacy role (`admin`, `cashier`), and normalized RBAC roles/permissions (`roles`, `permissions`, `role_permissions`, `user_roles`).
   - Object-level ownership and cross-tenant/cross-client integrity checks block horizontal privilege escalation (e.g., preventing a payment owned by Client A from being allocated to an invoice owned by Client B).
4. **Application & Financial Integrity Layer**:
   - Strict Pydantic v2 schemas (`StrictInputModel` with `extra="forbid"`) and Zod route validators reject mass assignment and unexpected fields.
   - All monetary inputs (`MoneyDecimal`) reject IEEE-754 binary floats (`isinstance(v, float)`) and enforce exact `Decimal` arithmetic (`NUMERIC(15,2)`).
   - Server-side authoritative calculation in `fastapi_service/services/financial_service.py` and `src/lib/server/services.ts` ignores client-calculated totals.
   - Row-level locking (`SELECT ... FOR UPDATE`) and `Idempotency-Key` replay protection guard payment confirmations, allocations, receipt generation, refunds, and reversals.
5. **Database & Storage Layer**:
   - Row-Level Security (`ENABLE ROW LEVEL SECURITY`) enabled on all 37 tables in `public`.
   - PL/pgSQL financial integrity triggers (`trg_validate_payment_allocation`, `trg_validate_receipt_generation`, `trg_protect_immutable_financial_docs`) and audit log immutability trigger (`trg_protect_audit_logs_immutable`) enforce invariants even against direct SQL mutations.

## 2. Trust Boundaries

| Boundary | Source | Target | Security Controls Applied |
| :--- | :--- | :--- | :--- |
| **TB-1: Public Internet → Next.js / FastAPI** | Unauthenticated Browser / Verifier | `/verify/[token]`, `/api/public/verify`, `/api/v1/public/verify/*`, `/api/v1/auth/*` | Sliding-window & DB-backed rate limiting (`verify_attempts`, `audit_logs`), `SHA-256` IP hashing, generic error messages, zero internal PII disclosure |
| **TB-2: Authenticated Browser → Next.js Proxy / API** | Staff User (`admin`, `cashier`, `finance`, `auditor`) | `/api/*`, `/api/v1/[...path]` | `HttpOnly` `ledgerly_session` cookie validation, live `users.active` check, RBAC permission verification, CSRF mitigation via `SameSite=Lax` + JSON `Content-Type` |
| **TB-3: Next.js Server → FastAPI Service** | Next.js App Router Proxy (`src/app/api/v1/[...path]/route.ts`) | `http://127.0.0.1:8000/api/v1/*` | Translates `ledgerly_session` cookie into `Authorization: Bearer <token>`, forwards `X-Forwarded-For` and `Idempotency-Key`, strips hop-by-hop headers |
| **TB-4: Application Services → PostgreSQL** | SQLAlchemy 2.x / Drizzle ORM | Supabase / PostgreSQL `public` schema | TLS-encrypted connection pool, parameterized SQL queries, transactional locks (`FOR UPDATE`), database triggers, append-only `audit_logs` |
| **TB-5: File Upload / Storage → Browser Download** | Authenticated Staff | `public.stored_files` / `public/uploads/branding` | Extension allowlist, MIME allowlist, binary magic-byte verification (`PDF`, `PNG`, `JPEG`, `WEBP`), path traversal sanitization, `X-Content-Type-Options: nosniff`, sandboxed CSP |
