"""
Aggregates all modular domain routers under `/api/v1` (Sections 4 & 5).
"""

from __future__ import annotations

from fastapi import APIRouter

from fastapi_service.modules import (
    audit,
    auth,
    communications,
    company,
    crm,
    dashboard,
    invoices,
    payments,
    quotations,
    receipts,
    reconciliation,
    taxation,
    users,
    verification,
)

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(auth.router)
api_v1_router.include_router(users.router)
api_v1_router.include_router(company.router)
api_v1_router.include_router(crm.router)
api_v1_router.include_router(quotations.router)
api_v1_router.include_router(invoices.router)
api_v1_router.include_router(payments.router)
api_v1_router.include_router(receipts.router)
api_v1_router.include_router(verification.router)
api_v1_router.include_router(communications.router)
api_v1_router.include_router(reconciliation.router)
api_v1_router.include_router(taxation.router)
api_v1_router.include_router(dashboard.router)
api_v1_router.include_router(audit.router)
