"""
Dashboard & Financial Reporting Module (Section 10.12).
Strictly separates:
- Invoiced value (`invoices` in `issued`, `partially_paid`, `paid`, `overdue`)
- Confirmed cash collections (`payments` in `confirmed`, `partially_refunded`, `refunded`)
- Refunds (`payment_refunds` completed)
- Net collections (`confirmed_payments - refunds`)
- Receipted acknowledgments (`receipts` finalized)
- Outstanding receivables (`invoices.balance_due`)
Never double-counts a payment and its receipt as two revenue events.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi_service.core.pagination import ApiResponse
from fastapi_service.core.permissions import AuthenticatedUser, require_permission
from fastapi_service.database import get_db
from fastapi_service.services.financial_service import ensure_company_settings

router = APIRouter(tags=["Dashboard & Financial Reports"])


@router.get("/dashboard/summary", response_model=ApiResponse[dict[str, Any]])
def get_dashboard_summary(
    user: AuthenticatedUser = Depends(require_permission("dashboard:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    settings_row = ensure_company_settings(db)
    is_admin_or_finance = user.has_permission("reports:read")

    row = db.execute(
        text(
            """
            SELECT
                (SELECT count(*) FROM public.clients WHERE status = 'active') AS active_clients,
                (SELECT count(*) FROM public.quotes WHERE status NOT IN ('cancelled')) AS total_quotations,
                (SELECT count(*) FROM public.invoices WHERE status IN ('issued', 'partially_paid', 'paid', 'overdue')) AS total_invoices,
                (SELECT COALESCE(SUM(total), 0.00) FROM public.invoices WHERE status IN ('issued', 'partially_paid', 'paid', 'overdue')) AS invoiced_value,
                (SELECT COALESCE(SUM(balance_due), 0.00) FROM public.invoices WHERE status IN ('issued', 'partially_paid', 'overdue')) AS outstanding_receivables,
                (SELECT count(*) FROM public.invoices WHERE status = 'overdue' OR (status IN ('issued', 'partially_paid') AND due_date < CURRENT_DATE)) AS overdue_invoices_count,
                (SELECT count(*) FROM public.payments WHERE status IN ('confirmed', 'partially_refunded', 'refunded')) AS confirmed_payments_count,
                (SELECT COALESCE(SUM(amount), 0.00) FROM public.payments WHERE status IN ('confirmed', 'partially_refunded', 'refunded')) AS gross_payments_received,
                (SELECT COALESCE(SUM(amount_refunded), 0.00) FROM public.payments WHERE status IN ('confirmed', 'partially_refunded', 'refunded')) AS total_refunds,
                (SELECT COALESCE(SUM(amount - amount_refunded), 0.00) FROM public.payments WHERE status IN ('confirmed', 'partially_refunded', 'refunded')) AS net_collections,
                (SELECT COALESCE(SUM(amount - amount_refunded), 0.00) FROM public.payments WHERE status IN ('confirmed', 'partially_refunded', 'refunded') AND payment_date >= date_trunc('day', now())) AS daily_revenue,
                (SELECT COALESCE(SUM(amount - amount_refunded), 0.00) FROM public.payments WHERE status IN ('confirmed', 'partially_refunded', 'refunded') AND payment_date >= date_trunc('week', now())) AS weekly_revenue,
                (SELECT COALESCE(SUM(amount - amount_refunded), 0.00) FROM public.payments WHERE status IN ('confirmed', 'partially_refunded', 'refunded') AND payment_date >= date_trunc('month', now())) AS monthly_revenue,
                (SELECT count(*) FROM public.receipts WHERE status = 'finalized') AS finalized_receipts_count,
                (SELECT COALESCE(SUM(amount_paid), 0.00) FROM public.receipts WHERE status = 'finalized') AS total_receipted_amount
            """
        )
    ).mappings().one()

    method_rows = db.execute(
        text(
            """
            SELECT
                payment_method,
                count(*) AS payment_count,
                COALESCE(SUM(amount - amount_refunded), 0.00) AS net_amount
            FROM public.payments
            WHERE status IN ('confirmed', 'partially_refunded', 'refunded')
            GROUP BY payment_method
            ORDER BY net_amount DESC
            """
        )
    ).mappings().all()

    return ApiResponse(
        data={
            "currency": settings_row.currency,
            "company_name": settings_row.name,
            "counts": {
                "active_clients": int(row["active_clients"]),
                "total_quotations": int(row["total_quotations"]),
                "total_invoices": int(row["total_invoices"]),
                "overdue_invoices": int(row["overdue_invoices_count"]),
                "confirmed_payments": int(row["confirmed_payments_count"]),
                "finalized_receipts": int(row["finalized_receipts_count"]),
            },
            "financials": {
                "invoiced_value": f"{Decimal(str(row['invoiced_value'])):.2f}" if is_admin_or_finance else None,
                "outstanding_receivables": f"{Decimal(str(row['outstanding_receivables'])):.2f}" if is_admin_or_finance else None,
                "gross_payments_received": f"{Decimal(str(row['gross_payments_received'])):.2f}" if is_admin_or_finance else None,
                "total_refunds": f"{Decimal(str(row['total_refunds'])):.2f}" if is_admin_or_finance else None,
                "net_collections": f"{Decimal(str(row['net_collections'])):.2f}" if is_admin_or_finance else None,
                "total_receipted_amount": f"{Decimal(str(row['total_receipted_amount'])):.2f}" if is_admin_or_finance else None,
                "daily_revenue": f"{Decimal(str(row['daily_revenue'])):.2f}" if is_admin_or_finance else None,
                "weekly_revenue": f"{Decimal(str(row['weekly_revenue'])):.2f}" if is_admin_or_finance else None,
                "monthly_revenue": f"{Decimal(str(row['monthly_revenue'])):.2f}" if is_admin_or_finance else None,
            },
            "payment_method_breakdown": [
                {
                    "payment_method": r["payment_method"],
                    "payment_count": int(r["payment_count"]),
                    "net_amount": f"{Decimal(str(r['net_amount'])):.2f}",
                }
                for r in method_rows
            ]
            if is_admin_or_finance
            else [],
        },
        message="Dashboard summary retrieved successfully",
    )


@router.get("/reports/revenue", response_model=ApiResponse[dict[str, Any]])
def get_revenue_report(
    from_date: date = Query(default_factory=lambda: date(date.today().year, 1, 1)),
    to_date: date = Query(default_factory=date.today),
    _user: AuthenticatedUser = Depends(require_permission("reports:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    """
    Authoritative Revenue & Collections Report (Section 10.12 & Section 14).
    Separates billed invoice value, confirmed cash payments, refunds, net collections,
    and receipt acknowledgments without ever double-counting payments and receipts.
    """
    settings_row = ensure_company_settings(db)
    start_ts = datetime(from_date.year, from_date.month, from_date.day, 0, 0, 0, tzinfo=timezone.utc)
    end_ts = datetime(to_date.year, to_date.month, to_date.day, 23, 59, 59, 999999, tzinfo=timezone.utc)

    agg = db.execute(
        text(
            """
            SELECT
                (SELECT COALESCE(SUM(total), 0.00)
                 FROM public.invoices
                 WHERE status IN ('issued', 'partially_paid', 'paid', 'overdue')
                   AND issue_date BETWEEN :from_d AND :to_d) AS total_invoiced,
                (SELECT COALESCE(SUM(amount), 0.00)
                 FROM public.payments
                 WHERE status IN ('confirmed', 'partially_refunded', 'refunded')
                   AND payment_date BETWEEN :start_ts AND :end_ts) AS gross_confirmed_payments,
                (SELECT COALESCE(SUM(amount), 0.00)
                 FROM public.payment_refunds
                 WHERE status = 'completed'
                   AND refunded_at BETWEEN :start_ts AND :end_ts) AS total_refunds,
                (SELECT COALESCE(SUM(amount_paid), 0.00)
                 FROM public.receipts
                 WHERE status = 'finalized'
                   AND finalized_at BETWEEN :start_ts AND :end_ts) AS total_receipted_acknowledgments
            """
        ),
        {"from_d": from_date, "to_d": to_date, "start_ts": start_ts, "end_ts": end_ts},
    ).mappings().one()

    gross_pay = Decimal(str(agg["gross_confirmed_payments"]))
    refunds = Decimal(str(agg["total_refunds"]))
    net_collections = gross_pay - refunds

    by_method = db.execute(
        text(
            """
            SELECT
                payment_method,
                count(*) AS count,
                COALESCE(SUM(amount), 0.00) AS gross_amount,
                COALESCE(SUM(amount_refunded), 0.00) AS refunded_amount,
                COALESCE(SUM(amount - amount_refunded), 0.00) AS net_amount
            FROM public.payments
            WHERE status IN ('confirmed', 'partially_refunded', 'refunded')
              AND payment_date BETWEEN :start_ts AND :end_ts
            GROUP BY payment_method
            ORDER BY net_amount DESC
            """
        ),
        {"start_ts": start_ts, "end_ts": end_ts},
    ).mappings().all()

    return ApiResponse(
        data={
            "period": {"from_date": from_date.isoformat(), "to_date": to_date.isoformat()},
            "currency": settings_row.currency,
            "metrics": {
                "invoiced_amount": f"{Decimal(str(agg['total_invoiced'])):.2f}",
                "gross_confirmed_payments": f"{gross_pay:.2f}",
                "total_refunds": f"{refunds:.2f}",
                "net_collections": f"{net_collections:.2f}",
                "receipted_acknowledgments": f"{Decimal(str(agg['total_receipted_acknowledgments'])):.2f}",
            },
            "by_payment_method": [
                {
                    "payment_method": m["payment_method"],
                    "count": int(m["count"]),
                    "gross_amount": f"{Decimal(str(m['gross_amount'])):.2f}",
                    "refunded_amount": f"{Decimal(str(m['refunded_amount'])):.2f}",
                    "net_amount": f"{Decimal(str(m['net_amount'])):.2f}",
                }
                for m in by_method
            ],
        },
        message="Revenue and collections report generated successfully",
    )


@router.get("/reports/receivables", response_model=ApiResponse[dict[str, Any]])
def get_receivables_report(
    _user: AuthenticatedUser = Depends(require_permission("reports:read")),
    db: Session = Depends(get_db),
) -> ApiResponse[dict[str, Any]]:
    settings_row = ensure_company_settings(db)
    open_invoices = db.execute(
        text(
            """
            SELECT
                i.id::text AS invoice_id,
                i.invoice_number,
                i.client_id::text AS client_id,
                c.name AS client_name,
                i.status,
                i.issue_date,
                i.due_date,
                i.total,
                i.amount_allocated,
                i.balance_due
            FROM public.invoices i
            JOIN public.clients c ON c.id = i.client_id
            WHERE i.status IN ('issued', 'partially_paid', 'overdue')
              AND i.balance_due > 0
            ORDER BY COALESCE(i.due_date, i.issue_date) ASC
            LIMIT 500
            """
        )
    ).mappings().all()

    total_outstanding = sum((Decimal(str(r["balance_due"])) for r in open_invoices), Decimal("0.00"))
    return ApiResponse(
        data={
            "currency": settings_row.currency,
            "total_open_invoices": len(open_invoices),
            "total_outstanding_receivables": f"{total_outstanding:.2f}",
            "invoices": [
                {
                    "invoice_id": r["invoice_id"],
                    "invoice_number": r["invoice_number"],
                    "client_id": r["client_id"],
                    "client_name": r["client_name"],
                    "status": r["status"],
                    "issue_date": r["issue_date"].isoformat(),
                    "due_date": r["due_date"].isoformat() if r["due_date"] else None,
                    "total": f"{Decimal(str(r['total'])):.2f}",
                    "amount_allocated": f"{Decimal(str(r['amount_allocated'])):.2f}",
                    "balance_due": f"{Decimal(str(r['balance_due'])):.2f}",
                }
                for r in open_invoices
            ],
        },
        message="Accounts receivable aging & open balances report generated successfully",
    )
