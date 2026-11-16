# MP-15 · Error Handling & Status Code Conventions (`docs/api/error-handling.md`)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-15

---

## 1. Standardized Error Envelope

All error responses return a consistent JSON structure with an appropriate HTTP status code and the correlation `request_id`:

```json
{
  "error": {
    "code": "INVOICE_OVER_ALLOCATION",
    "message": "Allocation amount (55000.00) exceeds invoice outstanding balance (50000.00)",
    "details": {}
  },
  "message": "Allocation amount (55000.00) exceeds invoice outstanding balance (50000.00)",
  "request_id": "req-9a8b7c6d5e4f"
}
```

> **Security Guarantee:** Stack traces, raw SQL queries, internal file paths, and database connection strings are never exposed in error payloads.

---

## 2. HTTP Status Codes & Domain Error Codes

| HTTP Status | Standard Error Code(s) | When Used |
|---:|---|---|
| `400` | `BAD_REQUEST`, `INVALID_SORT_FIELD`, `UNSUPPORTED_FILE_TYPE`, `INVALID_FILE_SIGNATURE`, `FILE_TOO_LARGE` | Malformed parameters, unapproved sort column, or rejected file upload. |
| `401` | `UNAUTHENTICATED` | Missing, invalid, or expired session token. |
| `403` | `FORBIDDEN` | Authenticated user lacks the required role or `module:action` permission, or account is deactivated. |
| `404` | `RESOURCE_NOT_FOUND` | Requested entity UUID does not exist. |
| `409` | `STATE_CONFLICT`, `IMMUTABLE_INVOICE`, `IMMUTABLE_RECEIPT`, `UNCONFIRMED_PAYMENT_ALLOCATION`, `UNCONFIRMED_PAYMENT_RECEIPT_FORBIDDEN`, `INVOICE_OVER_ALLOCATION`, `PAYMENT_OVER_ALLOCATION`, `DOUBLE_RECEIPTING_PREVENTED`, `IDEMPOTENCY_KEY_CONFLICT`, `DUPLICATE_RECORD` | Invalid lifecycle state transition, attempt to mutate a finalized document, over-allocation, double-receipting, or conflicting `Idempotency-Key` reuse. |
| `422` | `VALIDATION_FAILURE` | Pydantic schema validation failure (e.g., extra undeclared fields, binary float money, negative price, or card PAN detected). |
| `429` | `RATE_LIMIT_EXCEEDED` | Caller exceeded rate limit on login, password reset, or public verification. |
| `500` | `INTERNAL_SERVER_ERROR`, `DATABASE_ERROR` | Unexpected server error (logged with correlation ID). |
