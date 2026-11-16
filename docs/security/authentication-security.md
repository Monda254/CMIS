# Authentication & Session Security (`MP-17`)

## 1. Password Hashing & Credential Policy

- **Algorithm**: `scrypt` (`N=16384, r=8, p=1`, 64-byte key length) with a 16-byte cryptographically random salt (`os.urandom(16)` / `crypto.randomBytes(16)`).
- **Storage Format**: `scrypt$<hex_salt>$<hex_derived_key>` stored in `public.users.password_hash` (shared seamlessly between Next.js and FastAPI).
- **Verification**: Constant-time digest comparison via Python `hmac.compare_digest()` and Node.js `crypto.timingSafeEqual()`.
- **Minimum Password Complexity**: Minimum 8 characters (up to 128 characters); rotation requires verifying `current_password`.
- **No Default Static Passwords**: Admin user provisioning (`POST /api/users` and `POST /api/v1/users`) never uses static fallback passwords (`SEC-08`).

## 2. Session Lifecycle Management

- **Session Token Generation**: 24-byte (`192-bit`) cryptographically random `base64url` token stored in `public.sessions.id`.
- **Cookie Security Attributes**:
  - Name: `ledgerly_session`
  - `HttpOnly: true` (inaccessible to `document.cookie` / XSS)
  - `SameSite: lax` (protects state-changing requests from cross-site CSRF)
  - `Secure: true` in production (`NODE_ENV === "production"`)
  - `Path: /`
  - Default TTL: `14 days` (`SESSION_TTL_DAYS = 14`), with explicit expiration checked on every request (`sessions.expires_at <= now()`).
- **Immediate Session Revocation (`SEC-01`)**:
  - **Logout** (`POST /api/auth/logout`, `POST /api/v1/auth/logout`): Deletes the current session row from `public.sessions`.
  - **Password Change** (`POST /api/v1/auth/change-password`): Deletes all other active sessions for that user (`SessionRecord.id != current_token`).
  - **Password Reset** (`POST /api/auth/reset-password`, `POST /api/v1/auth/reset-password`): Deletes **all** active sessions (`DELETE FROM public.sessions WHERE user_id = :uid`) and marks the reset token `used_at = now()`.
  - **Account Deactivation** (`PATCH /api/users`, `POST /api/v1/users/{id}/deactivate`): Sets `users.active = false` and immediately deletes **all** active rows in `public.sessions` for that user.

## 3. Brute-Force & Enumeration Protection (`SEC-02`, `SEC-07`)

- **Identical Failure Responses**: Unknown email, wrong password, and deactivated account login attempts return identical `401 INVALID_CREDENTIALS` responses on `/api/v1/auth/login` so attackers cannot enumerate registered staff emails.
- **Forgot-Password Enumeration Prevention**: `POST /api/auth/forgot-password` and `POST /api/v1/auth/forgot-password` return the same `200 OK` message regardless of whether the email exists. Reset tokens are stored as `SHA-256` hashes in `public.password_reset_tokens` with a 30-minute expiry.
- **Multi-Layer Rate Limiting**:
  - Next.js Auth Routes: `enforceAuthRateLimit()` limits `/api/auth/login` (`10 / 10 min`), `/api/auth/forgot-password` (`5 / 15 min`), and `/api/auth/reset-password` (`5 / 15 min`).
  - FastAPI Auth Routes: In-memory `rate_limiter` (`20 / 10 min` per IP hash, `8 / 10 min` per email) **plus** PostgreSQL-backed `check_db_auth_rate_limit()` (`10 failed logins / 15 min` per `ip_hash` across `public.audit_logs`), ensuring multi-worker deployments enforce shared lockout thresholds.
