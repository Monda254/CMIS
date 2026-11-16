# MP-15 · IBMS Backend API Overview (`docs/api/api-overview.md`)

**Project:** Integrated Business Management System (IBMS) — Ledgerly / Folio  
**Prompt ID:** MP-15  
**Base Versioned Prefix:** `/api/v1`  
**Backend Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.x, Pydantic v2, Alembic, PostgreSQL

---

## 1. Architectural Overview (Modular Monolith)

The IBMS API is engineered as a **Modular Monolith** under `fastapi_service/` where each domain module owns its routes, Pydantic v2 request/response contracts, and business workflows while sharing a single canonical PostgreSQL schema (`MP-14`, `37` tables in `public`).

```text
fastapi_service/
├── main.py                      # FastAPI application entry point, middleware, health & readiness probes
├── database.py                  # SQLAlchemy 2.x DeclarativeBase, engine builders & get_db() session dependency
├── api/
│   └── router.py                # Aggregates all 14 domain routers under /api/v1
├── core/
│   ├── config.py                # Environment-driven configuration
│   ├── exceptions.py            # Domain exception hierarchy & standardized error handlers
│   ├── logging.py               # Structured application logging
│   ├── middleware.py            # X-Request-ID correlation, latency logging & security headers
│   ├── pagination.py            # ApiResponse, PaginatedResponse, PaginationParams & Decimal validators
│   ├── pdf_generator.py         # Server-side A4 PDF generation (ReportLab) for Quotes, Invoices & Receipts
│   ├── permissions.py           # RBAC & granular module:action permission dependencies
│   └── security.py              # scrypt password hashing, SHA-256 token digests, rate limiting, idempotency & audit logs
├── models/                      # Canonical 37 SQLAlchemy 2.x ORM models (MP-14)
├── modules/
│   ├── auth.py                  # /api/v1/auth
│   ├── users.py                 # /api/v1/users
│   ├── company.py               # /api/v1/company
│   ├── crm.py                   # /api/v1/clients
│   ├── quotations.py            # /api/v1/quotations
│   ├── invoices.py              # /api/v1/invoices
│   ├── payments.py              # /api/v1/payments
│   ├── receipts.py              # /api/v1/receipts
│   ├── verification.py          # /api/v1/verification (Public, rate-limited)
│   ├── communications.py        # /api/v1/communications
│   ├── reconciliation.py        # /api/v1/reconciliation
│   ├── taxation.py              # /api/v1/taxes
│   ├── dashboard.py             # /api/v1/dashboard & /api/v1/reports
│   └── audit.py                 # /api/v1/audit
└── services/
    └── financial_service.py     # Authoritative Decimal line math, snapshots, numbering & derived ledger queries
```

---

## 2. API Versioning Policy

- All primary domain endpoints are mounted under `/api/v1`.
- Non-breaking additions (optional query parameters, new endpoints, new optional response fields) may be introduced within `/api/v1`.
- Any breaking contract change requires introducing `/api/v2` while maintaining `/api/v1` during the deprecation window.
- Legacy Next.js companion routes (`/health`, `/api/v1/dashboard-stats`, `/api/v1/reports`) are preserved for zero-downtime compatibility with the Next.js App Router frontend.
