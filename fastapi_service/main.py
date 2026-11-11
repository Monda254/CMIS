"""
Ledgerly FastAPI Data-Fetching & Analytics Service
Provides high-speed asyncpg connection-pooled endpoints for dashboard KPIs,
receipt registers, date-range reports, and public verification.
"""

from __future__ import annotations

import hashlib
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, Request

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
INTERNAL_SECRET = os.getenv("FASTAPI_INTERNAL_SECRET", "ledgerly-internal-dev-secret")

pool: Optional[asyncpg.Pool] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    if DATABASE_URL:
        pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=12)
    yield
    if pool:
        await pool.close()


app = FastAPI(
    title="Ledgerly FastAPI Data Service",
    version="1.0.0",
    lifespan=lifespan,
)


def verify_internal(secret: Optional[str], active: Optional[str]) -> None:
    if secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized internal request")
    if active != "true":
        raise HTTPException(status_code=403, detail="Active staff account required")


def require_pool() -> asyncpg.Pool:
    if pool is None:
        raise HTTPException(status_code=503, detail="Database pool not initialized")
    return pool


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "database_connected": pool is not None}


@app.get("/api/v1/dashboard-stats")
async def dashboard_stats(
    x_internal_secret: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    x_user_active: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    verify_internal(x_internal_secret, x_user_active)
    db_pool = require_pool()
    is_admin = x_user_role == "admin"

    async with db_pool.acquire() as conn:
        counts = await conn.fetchrow(
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

        verify_agg = await conn.fetchrow(
            """
            SELECT
              count(*) AS total,
              count(*) FILTER (WHERE result = 'valid') AS valid,
              count(*) FILTER (WHERE result <> 'valid') AS invalid
            FROM public.verify_attempts
            """
        )

        recent_verify = await conn.fetch(
            """
            SELECT id, identifier, result, created_at
            FROM public.verify_attempts
            ORDER BY created_at DESC
            LIMIT 6
            """
        )

        recent_clients = await conn.fetch(
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

        daily = None
        if is_admin:
            daily_rows = await conn.fetch(
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


@app.get("/api/v1/receipts")
async def list_receipts(
    client: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=300, ge=1, le=1000),
    x_internal_secret: Optional[str] = Header(default=None),
    x_user_active: Optional[str] = Header(default=None),
) -> list[dict[str, Any]]:
    verify_internal(x_internal_secret, x_user_active)
    db_pool = require_pool()

    clauses: list[str] = []
    args: list[Any] = []
    if client:
        args.append(client)
        clauses.append(f"r.client_id = ${len(args)}::uuid")
    if status in ("draft", "finalized", "cancelled"):
        args.append(status)
        clauses.append(f"r.status = ${len(args)}::public.receipt_status")

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    args.append(limit)

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
              r.id::text,
              r.status::text,
              r.receipt_number,
              r.verification_code,
              r.client_id::text,
              r.customer_name,
              r.total::text,
              r.currency,
              r.finalized_at,
              r.created_at,
              r.print_count,
              c.name AS client_name
            FROM public.receipts r
            LEFT JOIN public.clients c ON c.id = r.client_id
            {where_sql}
            ORDER BY r.created_at DESC
            LIMIT ${len(args)}
            """,
            *args,
        )
        return [
            {
                "id": r["id"],
                "status": r["status"],
                "receipt_number": r["receipt_number"],
                "verification_code": r["verification_code"],
                "client_id": r["client_id"],
                "customer_name": r["customer_name"],
                "total": r["total"],
                "currency": r["currency"],
                "finalized_at": r["finalized_at"].isoformat() if r["finalized_at"] else None,
                "created_at": r["created_at"].isoformat(),
                "print_count": r["print_count"],
                "clients": {"name": r["client_name"]} if r["client_name"] else None,
            }
            for r in rows
        ]


@app.get("/api/v1/reports")
async def reports_query(
    from_date: str = Query(alias="from"),
    to_date: str = Query(alias="to"),
    status: str = Query(default="finalized"),
    x_internal_secret: Optional[str] = Header(default=None),
    x_user_role: Optional[str] = Header(default=None),
    x_user_active: Optional[str] = Header(default=None),
) -> list[dict[str, Any]]:
    verify_internal(x_internal_secret, x_user_active)
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    db_pool = require_pool()
    dt_from = datetime.fromisoformat(f"{from_date}T00:00:00+00:00")
    dt_to = datetime.fromisoformat(f"{to_date}T23:59:59.999999+00:00")

    status_clause = "AND r.status <> 'draft'"
    if status == "finalized":
        status_clause = "AND r.status = 'finalized'"
    elif status == "cancelled":
        status_clause = "AND r.status = 'cancelled'"

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
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
            WHERE r.finalized_at >= $1 AND r.finalized_at <= $2
            {status_clause}
            ORDER BY r.finalized_at DESC
            LIMIT 10000
            """,
            dt_from,
            dt_to,
        )
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
