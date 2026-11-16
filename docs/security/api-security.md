# IBMS API Security Architecture (`MP-17`)

## 1. Input Validation & Mass Assignment Prevention

- **Strict Schema Validation**: Every FastAPI input model inherits from `StrictInputModel` (`ConfigDict(extra="forbid", str_strip_whitespace=True)`), rejecting unexpected or injected properties (`is_superuser`, `balance_due`, `total`, `created_by`) with `422 VALIDATION_ERROR`.
- **Type & Precision Guards**:
  - `MoneyDecimal`: Rejects IEEE-754 `float` types (`isinstance(v, float)`) and enforces `NUMERIC(15, 2)` precision (`<= 2` decimal places, `>= 0.00`).
  - `QuantityDecimal`: Enforces `NUMERIC(12, 3)` (`> 0.000`).
  - `TaxRateDecimal`: Enforces `0.0000%` to `100.0000%`.
- **Sort-Field Whitelisting (`apply_sorting`)**: `fastapi_service/core/pagination.py` validates `sort_by` strictly against an explicit per-endpoint `allowed_fields` dictionary. Any unlisted field or SQL expression returns `400 INVALID_SORT_FIELD`.

## 2. Rate Limiting & Abuse Controls

| Endpoint Category | Rate Limit Window | Backing Store | Error Response |
| :--- | :--- | :--- | :--- |
| `POST /api/v1/auth/login` | `20 / 10 min` per IP + `8 / 10 min` per email + `10 failed / 15 min` DB | In-Memory + PostgreSQL `audit_logs` (`SEC-07`) | `429 RATE_LIMITED` |
| `POST /api/auth/login` | `10 / 10 min` per IP hash | Sliding-window (`enforceAuthRateLimit` — `SEC-02`) | `429` |
| `POST /api/auth/forgot-password` & `/reset-password` | `5 / 15 min` per IP hash | Sliding-window (`enforceAuthRateLimit` — `SEC-02`) | `429` |
| `GET/POST /api/v1/public/verify/*` & `/api/public/verify` | `30 / 60 min` per IP hash + `10 / 10 min` per identifier | PostgreSQL `public.verify_attempts` | `429 RATE_LIMITED` |

## 3. Error Sanitization & Security Headers (`SEC-04`, `SEC-05`)

- **Standardized Error Envelope**: All `4xx` and `5xx` responses return `{"success": false, "error": {"code": "...", "message": "...", "details": ...}, "meta": {"request_id": "...", "timestamp": "..."}}`.
- **Zero Internal Leakage (`SEC-04`)**: Unhandled `500` exceptions in both FastAPI (`register_exception_handlers`) and Next.js (`handleApiError` in `src/lib/server/http.ts`) log full stack traces server-side with `request_id` while returning only `"An unexpected internal server error occurred."` to the caller.
- **HTTP Security Headers (`SEC-05`)**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
  - `Content-Security-Policy` restricting script, frame, object, and base-uri sources.
