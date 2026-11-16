"""
IBMS · Ledgerly Modular Monolith FastAPI Application Entry Point (MP-15).
Integrates:
- All 13 IBMS functional modules under `/api/v1`
- Standardized Request/Response/Error contracts & OpenAPI documentation
- RBAC & Permission enforcement + Audit logging
- Idempotency & Rate limiting
- Backward-compatible Next.js companion endpoints (`/health`, `/api/v1/dashboard-stats`, `/api/v1/reports`)
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Optional

import asyncpg
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi_service.api.router import api_v1_router
from fastapi_service.core.config import settings
from fastapi_service.core.exceptions import register_exception_handlers
from fastapi_service.core.logging import configure_logging
from fastapi_service.core.middleware import RequestContextMiddleware
from fastapi_service.core.pagination import ApiResponse
from fastapi_service.database import get_db
from fastapi_service.services.financial_service import ensure_company_settings

load_dotenv()
configure_logging()

DATABASE_URL = os.getenv("DATABASE_URL", "")
INTERNAL_SECRET = os.getenv("FASTAPI_INTERNAL_SECRET", "ledgerly-internal-dev-secret")

pool: Optional[asyncpg.Pool] = None

OPENAPI_TAGS = [
    {"name": "Authentication", "description": "Staff login, logout, current user session, and password recovery."},
    {"name": "Users & RBAC", "description": "User management, role definitions, and granular permission assignments."},
    {"name": "Company Settings & Files", "description": "Organization profile, document templates, and secure file uploads/downloads."},
    {"name": "CRM & Clients", "description": "Canonical clients, corporate contacts, categories, tags, interactions, documents, and derived client ledgers."},
    {"name": "Quotations", "description": "Commercial quotations, lifecycle transitions, invoice conversion, and PDF generation."},
    {"name": "Invoices & Receivables", "description": "Accounts receivable billing, issuance, cancellation, and PDF generation."},
    {"name": "Payments & Allocations", "description": "Payment recording, controlled confirmation, partial/multi-invoice allocations, reversals, and refunds."},
    {"name": "Receipts", "description": "Idempotent receipt generation from confirmed payments, reprinting, cancellation, and PDF generation."},
    {"name": "Public Verification", "description": "Isolated, rate-limited public receipt verification by verification code or receipt number."},
    {"name": "Communications", "description": "Email and SMS notification templates and delivery state logs."},
    {"name": "Reconciliation", "description": "External bank/M-Pesa statement imports, match suggestions, confirmations, and rejections."},
    {"name": "Tax Configuration", "description": "Configurable tax codes, rates, effective dates, and inclusive/exclusive rules."},
    {"name": "Dashboard & Financial Reports", "description": "Executive KPIs, revenue/collections reports, and accounts receivable aging."},
    {"name": "Audit Logs", "description": "Immutable security and financial audit trail inspection."},
]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    if DATABASE_URL:
        try:
            pool = await asyncpg.create_pool(
                DATABASE_URL, min_size=1, max_size=8, statement_cache_size=0
            )
        except Exception:
            pool = None
    yield
    if pool:
        await pool.close()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Production-grade modular monolith API for the Integrated Business Management System (IBMS). "
        "Enforces authoritative Decimal money arithmetic, transactional payment/receipt separation, "
        "RBAC authorization, idempotency, and immutable historical document snapshots."
    ),
    openapi_tags=OPENAPI_TAGS,
    lifespan=lifespan,
)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID", "X-Session-Token"],
)

register_exception_handlers(app)


@app.get("/health", tags=["Health & Observability"])
async def health() -> dict[str, Any]:
    """Liveness check distinguishing application process health from database readiness."""
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "database_pool_initialized": pool is not None,
    }


@app.get("/health/ready", response_model=ApiResponse[dict[str, Any]], tags=["Health & Observability"])
def readiness_check(db: Session = Depends(get_db)) -> ApiResponse[dict[str, Any]]:
    """Readiness probe verifying active PostgreSQL connectivity without leaking sensitive configuration."""
    db.execute(text("SELECT 1"))
    return ApiResponse(
        data={"status": "ready", "database": "connected"},
        message="Application and PostgreSQL database are ready",
    )


def verify_internal(secret: Optional[str], active: Optional[str]) -> None:
    if secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized internal request")
    if active != "true":
        raise HTTPException(status_code=403, detail="Active staff account required")


@app.get("/api/v1/dashboard-stats", tags=["Dashboard & Financial Reports"])
def dashboard_stats_compat(
    x_internal_secret: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    x_user_active: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Preserved backward-compatible companion endpoint for Next.js `/api/dashboard`."""
    verify_internal(x_internal_secret, x_user_active)
    is_admin = x_user_role == "admin"
    ensure_company_settings(db)

    counts = db.execute(
        text(
            """
            SELECT
              (SELECT count(*) FROM public.clients) AS clients,
              (SELECT count(*) FROM public.clients WHERE created_at >= date_trunc('month', now())) AS new_clients_month,
              (SELECT coalesce(currency, 'KES') FROM public.company_settings WHERE id = 1) AS currency,
              (SELECT coalesce(name, 'Northstar Studio') FROM public.company_settings WHERE id = 1) AS company_name,
              count(*) FILTER (WHERE status = 'finalized') AS issued,
              count(*) FILTER (WHERE status = 'draft') AS drafts,
              count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
              coalesce(sum(total) FILTER (WHERE status = 'finalized'), 0) AS value_total,
              count(*) FILTER (WHERE status = 'finalized' AND finalized_at >= date_trunc('day', now())) AS today_count,
              coalesce(sum(total) FILTER (WHERE status = 'finalized' AND finalized_at >= date_trunc('day', now())), 0) AS today_value,
              count(*) FILTER (WHERE status = 'finalized' AND finalized_at >= date_trunc('month', now())) AS month_count,
              coalesce(sum(total) FILTER (WHERE status = 'finalized' AND finalized_at >= date_trunc('month', now())), 0) AS month_value
            FROM public.receipts
            """
        )
    ).mappings().one()

    verify_agg = db.execute(
        text(
            """
            SELECT
              count(*) AS total,
              count(*) FILTER (WHERE result = 'valid') AS valid,
              count(*) FILTER (WHERE result <> 'valid') AS invalid
            FROM public.verify_attempts
            """
        )
    ).mappings().one()

    recent_verify = db.execute(
        text(
            """
            SELECT id, identifier, result, created_at
            FROM public.verify_attempts
            ORDER BY created_at DESC
            LIMIT 6
            """
        )
    ).mappings().all()

    recent_clients = db.execute(
        text(
            """
            SELECT
              c.id::text AS id,
              c.name,
              c.phone,
              c.address,
              count(r.id) FILTER (WHERE r.status = 'finalized') AS receipt_count,
              coalesce(sum(r.total) FILTER (WHERE r.status = 'finalized'), 0)::float8 AS total_spending
            FROM public.clients c
            LEFT JOIN public.receipts r ON r.client_id = c.id
            GROUP BY c.id
            ORDER BY coalesce(max(r.created_at), c.created_at) DESC
            LIMIT 6
            """
        )
    ).mappings().all()

    daily = None
    if is_admin:
        daily_rows = db.execute(
            text(
                """
                SELECT
                  d::date::text AS day,
                  coalesce(sum(r.total), 0)::float8 AS value,
                  count(r.id)::int AS count
                FROM generate_series(
                  date_trunc('day', now()) - interval '13 days',
                  date_trunc('day', now()),
                  interval '1 day'
                ) d
                LEFT JOIN public.receipts r
                  ON r.status = 'finalized'
                 AND r.finalized_at >= d
                 AND r.finalized_at < d + interval '1 day'
                GROUP BY d
                ORDER BY d ASC
                """
            )
        ).mappings().all()
        daily = [dict(r) for r in daily_rows]

    return {
        "currency": counts["currency"] or "KES",
        "company_name": counts["company_name"] or "Northstar Studio",
        "clients": int(counts["clients"]),
        "new_clients_month": int(counts["new_clients_month"]),
        "issued": int(counts["issued"]),
        "drafts": int(counts["drafts"]),
        "cancelled": int(counts["cancelled"]),
        "value_total": float(counts["value_total"]) if is_admin else None,
        "today_count": int(counts["today_count"]),
        "today_value": float(counts["today_value"]) if is_admin else None,
        "month_count": int(counts["month_count"]),
        "month_value": float(counts["month_value"]) if is_admin else None,
        "daily": daily,
        "verify_stats": {
            "total": int(verify_agg["total"]) if verify_agg else 0,
            "valid": int(verify_agg["valid"]) if verify_agg else 0,
            "invalid": int(verify_agg["invalid"]) if verify_agg else 0,
            "recent": [
                {
                    "id": int(v["id"]),
                    "identifier": v["identifier"],
                    "result": v["result"],
                    "created_at": v["created_at"].isoformat(),
                }
                for v in recent_verify
            ],
        },
        "recent_clients": [
            {
                "id": c["id"],
                "name": c["name"],
                "phone": c["phone"],
                "address": c["address"],
                "receipt_count": int(c["receipt_count"]),
                "total_spending": float(c["total_spending"]) if is_admin else None,
            }
            for c in recent_clients
        ],
    }


@app.get("/api/v1/reports", tags=["Dashboard & Financial Reports"])
def reports_query_compat(
    from_date: str = Query(alias="from"),
    to_date: str = Query(alias="to"),
    status: str = Query(default="finalized"),
    x_internal_secret: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    x_user_active: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Preserved backward-compatible companion endpoint for Next.js `/api/reports`."""
    verify_internal(x_internal_secret, x_user_active)
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    dt_from = datetime.fromisoformat(f"{from_date}T00:00:00+00:00")
    dt_to = datetime.fromisoformat(f"{to_date}T23:59:59.999999+00:00")

    status_clause = "AND r.status <> 'draft'"
    if status == "finalized":
        status_clause = "AND r.status = 'finalized'"
    elif status == "cancelled":
        status_clause = "AND r.status = 'cancelled'"

    rows = db.execute(
        text(
            f"""
            SELECT
              r.id::text,
              r.status::text,
              r.receipt_number,
              r.customer_name,
              r.total::text,
              r.currency,
              r.finalized_at,
              r.print_count,
              c.name AS client_name
            FROM public.receipts r
            LEFT JOIN public.clients c ON c.id = r.client_id
            WHERE r.finalized_at >= :dt_from AND r.finalized_at <= :dt_to
            {status_clause}
            ORDER BY r.finalized_at DESC
            LIMIT 10000
            """
        ),
        {"dt_from": dt_from, "dt_to": dt_to},
    ).mappings().all()

    return [
        {
            "id": r["id"],
            "status": r["status"],
            "receipt_number": r["receipt_number"],
            "customer_name": r["customer_name"],
            "total": r["total"],
            "currency": r["currency"],
            "finalized_at": r["finalized_at"].isoformat() if r["finalized_at"] else None,
            "print_count": r["print_count"],
            "clients": {"name": r["client_name"]} if r["client_name"] else None,
        }
        for r in rows
    ]


app.include_router(api_v1_router)
