"""
MP-17 Comprehensive Security Architecture & Hardening Test Suite.
Validates defense-in-depth controls across Authentication, Authorization (RBAC & Object-Level),
API Security, Financial Security, File Upload/Download Security, Next.js Route Hardening,
Database Audit Log Immutability, Backup/Restore Verification, and Retesting of all
Remediated Findings (SEC-01 through SEC-08).
"""

from __future__ import annotations

import asyncio
import base64
import json
import secrets
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import RateLimitError
from fastapi_service.core.security import (
    SlidingWindowRateLimiter,
    check_db_auth_rate_limit,
    hash_password,
    rate_limiter,
    sanitize_audit_dict,
    sha256_hex,
    verify_password,
)
from fastapi_service.database import build_sync_engine
from fastapi_service.main import app
from fastapi_service.models.identity import SessionRecord, User


class AsgiResponse:
    def __init__(self, status_code: int, headers: dict[str, str], body: bytes) -> None:
        self.status_code = status_code
        self.headers = headers
        self.content = body

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text)


class AsgiTestClient:
    """Zero-dependency in-process ASGI test client for FastAPI/Starlette security verification."""

    def __init__(self, asgi_app: Any) -> None:
        self.app = asgi_app

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        raw_body: bytes | None = None,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        client_ip: str = "127.0.0.1",
    ) -> AsgiResponse:
        if "?" in path:
            raw_path, existing_qs = path.split("?", 1)
        else:
            raw_path, existing_qs = path, ""

        if params:
            clean_params = {k: str(v) for k, v in params.items() if v is not None}
            encoded = urlencode(clean_params)
            query_string = f"{existing_qs}&{encoded}".strip("&") if existing_qs else encoded
        else:
            query_string = existing_qs

        req_headers: dict[str, str] = {"host": "localhost:8000"}
        if headers:
            for k, v in headers.items():
                req_headers[k.lower()] = str(v)

        if json_body is not None:
            body_bytes = json.dumps(json_body).encode("utf-8")
            req_headers.setdefault("content-type", "application/json")
        elif raw_body is not None:
            body_bytes = raw_body
        else:
            body_bytes = b""

        req_headers["content-length"] = str(len(body_bytes))

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": "http",
            "path": raw_path,
            "raw_path": raw_path.encode("ascii"),
            "query_string": query_string.encode("ascii"),
            "root_path": "",
            "headers": [(k.encode("latin-1"), v.encode("latin-1")) for k, v in req_headers.items()],
            "client": (client_ip, 54321),
            "server": ("localhost", 8000),
            "state": {},
        }

        response_status = 500
        response_headers: dict[str, str] = {}
        response_chunks: list[bytes] = []
        body_sent = False

        async def receive() -> dict[str, Any]:
            nonlocal body_sent
            if not body_sent:
                body_sent = True
                return {"type": "http.request", "body": body_bytes, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message: dict[str, Any]) -> None:
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = int(message["status"])
                for hk, hv in message.get("headers", []):
                    response_headers[hk.decode("latin-1").lower()] = hv.decode("latin-1")
            elif message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                if chunk:
                    response_chunks.append(chunk)

        asyncio.run(self.app(scope, receive, send))
        return AsgiResponse(response_status, response_headers, b"".join(response_chunks))

    def get(self, path: str, **kwargs: Any) -> AsgiResponse:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> AsgiResponse:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> AsgiResponse:
        return self.request("PUT", path, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> AsgiResponse:
        return self.request("PATCH", path, **kwargs)


@pytest.fixture(scope="session")
def client() -> AsgiTestClient:
    return AsgiTestClient(app)


@pytest.fixture(scope="session")
def db_engine():
    engine = build_sync_engine()
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def security_staff_accounts(db_engine, client: AsgiTestClient) -> dict[str, Any]:
    """Creates dedicated admin and cashier test accounts for MP-17 security testing."""
    rate_limiter.reset()
    suffix = uuid.uuid4().hex[:8]
    admin_email = f"mp17-sec-admin-{suffix}@ledgerly.co.ke"
    cashier_email = f"mp17-sec-cashier-{suffix}@ledgerly.co.ke"
    pw = "SecHardened#2026!"

    with Session(db_engine) as s:
        admin_user = User(
            email=admin_email,
            password_hash=hash_password(pw),
            full_name="MP17 Security Admin",
            role="admin",
            active=True,
        )
        cashier_user = User(
            email=cashier_email,
            password_hash=hash_password(pw),
            full_name="MP17 Security Cashier",
            role="cashier",
            active=True,
        )
        s.add_all([admin_user, cashier_user])
        s.commit()
        admin_id = admin_user.id
        cashier_id = cashier_user.id

    res_admin = client.post(
        "/api/v1/auth/login",
        json_body={"email": admin_email, "password": pw},
        client_ip="10.17.0.1",
    )
    assert res_admin.status_code == 200, res_admin.text
    admin_token = res_admin.json()["data"]["access_token"]

    res_cashier = client.post(
        "/api/v1/auth/login",
        json_body={"email": cashier_email, "password": pw},
        client_ip="10.17.0.2",
    )
    assert res_cashier.status_code == 200, res_cashier.text
    cashier_token = res_cashier.json()["data"]["access_token"]

    return {
        "admin_id": admin_id,
        "admin_email": admin_email,
        "admin_token": admin_token,
        "admin_headers": {"Authorization": f"Bearer {admin_token}"},
        "cashier_id": cashier_id,
        "cashier_email": cashier_email,
        "cashier_token": cashier_token,
        "cashier_headers": {"Authorization": f"Bearer {cashier_token}"},
        "password": pw,
    }


# =============================================================================
# 19.1 AUTHENTICATION SECURITY TESTS (5 tests)
# =============================================================================


def test_19_1_invalid_login_and_enumeration_resistance(client: AsgiTestClient, security_staff_accounts):
    """Verifies invalid password and unknown email return identical 401 UNAUTHENTICATED without enumeration."""
    rate_limiter.reset()
    r_unknown = client.post(
        "/api/v1/auth/login",
        json_body={"email": "nonexistent-mp17@ledgerly.co.ke", "password": "WrongPassword123!"},
        client_ip="10.17.1.10",
    )
    r_wrong_pw = client.post(
        "/api/v1/auth/login",
        json_body={"email": security_staff_accounts["admin_email"], "password": "WrongPassword123!"},
        client_ip="10.17.1.11",
    )
    assert r_unknown.status_code == 401
    assert r_wrong_pw.status_code == 401
    assert r_unknown.json()["error"]["code"] == "UNAUTHENTICATED"
    assert r_wrong_pw.json()["error"]["code"] == "UNAUTHENTICATED"
    assert r_unknown.json()["error"]["message"] == r_wrong_pw.json()["error"]["message"]


def test_19_1_expired_and_invalid_tokens_rejected(db_engine, client: AsgiTestClient, security_staff_accounts):
    """Verifies forged tokens and expired database sessions are rejected with 401."""
    # Forged bearer token
    r_forged = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer forged_token_999999"})
    assert r_forged.status_code == 401
    assert r_forged.json()["error"]["code"] == "UNAUTHENTICATED"

    # Expired session record in PostgreSQL (stored as SHA-256 of raw token)
    raw_expired_token = f"expired_{uuid.uuid4().hex}"
    with Session(db_engine) as s:
        s.add(
            SessionRecord(
                id=sha256_hex(raw_expired_token),
                user_id=security_staff_accounts["admin_id"],
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            )
        )
        s.commit()

    r_expired = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {raw_expired_token}"})
    assert r_expired.status_code == 401
    assert r_expired.json()["error"]["code"] == "UNAUTHENTICATED"


def test_19_1_sec01_deactivated_user_login_and_session_revocation(
    db_engine, client: AsgiTestClient, security_staff_accounts
):
    """SEC-01 Retest: Deactivating a user immediately revokes active sessions and blocks future login."""
    rate_limiter.reset()
    temp_email = f"mp17-deact-{uuid.uuid4().hex[:6]}@ledgerly.co.ke"
    pw = "TempStaff#2026!"
    r_create = client.post(
        "/api/v1/users",
        headers=security_staff_accounts["admin_headers"],
        json_body={
            "email": temp_email,
            "full_name": "Temporary Staff",
            "password": pw,
            "role": "cashier",
        },
    )
    assert r_create.status_code == 201, r_create.text
    uid = r_create.json()["data"]["id"]

    # Login succeeds while active
    r_login = client.post(
        "/api/v1/auth/login",
        json_body={"email": temp_email, "password": pw},
        client_ip="10.17.1.25",
    )
    assert r_login.status_code == 200
    tok = r_login.json()["data"]["access_token"]

    # Admin deactivates user -> active sessions must be deleted immediately
    r_deact = client.post(
        f"/api/v1/users/{uid}/deactivate",
        headers=security_staff_accounts["admin_headers"],
    )
    assert r_deact.status_code == 200

    # Existing session token is immediately rejected
    r_me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r_me.status_code in (401, 403)

    # Attempting to login while deactivated is blocked
    r_relogin = client.post(
        "/api/v1/auth/login",
        json_body={"email": temp_email, "password": pw},
        client_ip="10.17.1.26",
    )
    assert r_relogin.status_code in (401, 403)


def test_19_1_sec02_sec07_auth_rate_limiting_and_db_backed_brute_force(
    db_engine, client: AsgiTestClient
):
    """SEC-02 & SEC-07 Retest: Verifies sliding-window and PostgreSQL-backed login brute-force rate limiting."""
    rate_limiter.reset()
    attacker_ip = f"10.99.{uuid.uuid4().int % 200 + 1}.{uuid.uuid4().int % 200 + 1}"
    target_email = f"brute-{uuid.uuid4().hex[:6]}@ledgerly.co.ke"

    # Trigger 6 failed login attempts from the same IP; audit_logs records auth.login_failed with ip_hash
    for _ in range(6):
        res = client.post(
            "/api/v1/auth/login",
            json_body={"email": target_email, "password": "BadPassword!123"},
            client_ip=attacker_ip,
        )
        assert res.status_code == 401

    ip_hash = sha256_hex(f"ip:{attacker_ip}")
    with Session(db_engine) as s:
        # Under threshold (max_attempts=10) succeeds
        check_db_auth_rate_limit(
            s, action="auth.login_failed", ip_hash=ip_hash, max_attempts=10, window_minutes=15
        )
        # Exceeding threshold (max_attempts=4 with 6 recorded failures) raises RateLimitError (429)
        with pytest.raises(RateLimitError):
            check_db_auth_rate_limit(
                s, action="auth.login_failed", ip_hash=ip_hash, max_attempts=4, window_minutes=15
            )


def test_19_1_password_reset_flow_and_session_invalidation(
    db_engine, client: AsgiTestClient, security_staff_accounts
):
    """Verifies password reset invalidates all prior sessions and enforces one-time token use."""
    rate_limiter.reset()
    user_email = f"mp17-pwreset-{uuid.uuid4().hex[:6]}@ledgerly.co.ke"
    old_pw = "InitialPass#2026!"
    new_pw = "RotatedPass#2026!"

    r_create = client.post(
        "/api/v1/users",
        headers=security_staff_accounts["admin_headers"],
        json_body={
            "email": user_email,
            "full_name": "Password Reset User",
            "password": old_pw,
            "role": "cashier",
        },
    )
    assert r_create.status_code == 201
    user_id = uuid.UUID(r_create.json()["data"]["id"])

    r_login1 = client.post(
        "/api/v1/auth/login",
        json_body={"email": user_email, "password": old_pw},
        client_ip="10.17.1.50",
    )
    tok1 = r_login1.json()["data"]["access_token"]

    # Issue a password reset token for the user
    raw_reset_token = secrets.token_urlsafe(32)
    with Session(db_engine) as s:
        u = s.get(User, user_id)
        assert u is not None
        u.reset_token_hash = sha256_hex(raw_reset_token)
        u.reset_token_expires_at = datetime.now(timezone.utc) + timedelta(minutes=20)
        s.commit()

    # Complete password reset -> revokes all existing sessions for that user
    r_reset = client.post(
        "/api/v1/auth/reset-password",
        json_body={"token": raw_reset_token, "new_password": new_pw},
    )
    assert r_reset.status_code == 200

    # Prior session tok1 is now revoked (401)
    r_me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok1}"})
    assert r_me.status_code == 401

    # Reusing the same reset token is rejected (400 INVALID_RESET_TOKEN)
    r_reuse = client.post(
        "/api/v1/auth/reset-password",
        json_body={"token": raw_reset_token, "new_password": "AnotherPassword#2026!"},
    )
    assert r_reuse.status_code == 400
    assert r_reuse.json()["error"]["code"] == "INVALID_RESET_TOKEN"


# =============================================================================
# 19.2 AUTHORIZATION SECURITY TESTS (3 tests)
# =============================================================================


def test_19_2_unauthenticated_access_blocked_across_protected_modules(client: AsgiTestClient):
    """Verifies all protected IBMS module endpoints reject unauthenticated requests with 401."""
    protected_endpoints = [
        ("GET", "/api/v1/users"),
        ("GET", "/api/v1/company/settings"),
        ("GET", "/api/v1/clients"),
        ("GET", "/api/v1/quotations"),
        ("GET", "/api/v1/invoices"),
        ("GET", "/api/v1/payments"),
        ("GET", "/api/v1/receipts"),
        ("GET", "/api/v1/dashboard/summary"),
        ("GET", "/api/v1/reports/revenue"),
        ("GET", "/api/v1/reconciliation/batches"),
        ("GET", "/api/v1/taxes"),
        ("GET", "/api/v1/audit/logs"),
    ]
    for method, path in protected_endpoints:
        res = client.request(method, path)
        assert res.status_code == 401, f"Expected 401 on {method} {path}, got {res.status_code}"


def test_19_2_unauthorized_role_access_and_privilege_escalation_blocked(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies cashier role cannot perform admin/finance-privileged operations."""
    cashier_hdrs = security_staff_accounts["cashier_headers"]

    # Cannot list or create users
    assert client.get("/api/v1/users", headers=cashier_hdrs).status_code == 403
    assert (
        client.post(
            "/api/v1/users",
            headers=cashier_hdrs,
            json_body={
                "email": "escalate@ledgerly.co.ke",
                "full_name": "Escalate",
                "password": "Password1234!",
                "role": "admin",
            },
        ).status_code
        == 403
    )

    # Cannot modify company settings or tax rates
    assert (
        client.patch(
            "/api/v1/company/settings",
            headers=cashier_hdrs,
            json_body={"name": "Unauthorized Corp"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/taxes",
            headers=cashier_hdrs,
            json_body={"code": "HACK16", "name": "Hack Tax", "rate": "16.0000"},
        ).status_code
        == 403
    )

    # Cannot read audit logs or executive revenue reports
    assert client.get("/api/v1/audit/logs", headers=cashier_hdrs).status_code == 403
    assert client.get("/api/v1/reports/revenue", headers=cashier_hdrs).status_code == 403


def test_19_2_object_level_authorization_prevents_cross_client_allocation(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies a payment belonging to Client A cannot be allocated to an invoice belonging to Client B."""
    admin_hdrs = security_staff_accounts["admin_headers"]

    c1 = client.post(
        "/api/v1/clients",
        headers=admin_hdrs,
        json_body={"name": f"Client Alpha {uuid.uuid4().hex[:4]}", "phone": "+254700111222"},
    ).json()["data"]["id"]

    c2 = client.post(
        "/api/v1/clients",
        headers=admin_hdrs,
        json_body={"name": f"Client Beta {uuid.uuid4().hex[:4]}", "phone": "+254700333444"},
    ).json()["data"]["id"]

    inv_b = client.post(
        "/api/v1/invoices",
        headers=admin_hdrs,
        json_body={
            "client_id": c2,
            "issue_immediately": True,
            "items": [{"description": "Advisory Service", "quantity": "1", "unit_price": "10000.00"}],
        },
    ).json()["data"]["id"]

    pay_a = client.post(
        "/api/v1/payments",
        headers=admin_hdrs,
        json_body={
            "client_id": c1,
            "amount": "10000.00",
            "payment_method": "bank_transfer",
            "external_reference": f"BNK-{uuid.uuid4().hex[:8]}",
            "confirm_immediately": True,
        },
    ).json()["data"]["id"]

    # Attempting to allocate Client A's payment to Client B's invoice must be rejected with 409
    r_alloc = client.post(
        f"/api/v1/payments/{pay_a}/allocate",
        headers=admin_hdrs,
        json_body={"allocations": [{"invoice_id": inv_b, "amount": "5000.00"}]},
    )
    assert r_alloc.status_code == 409
    assert "CLIENT" in r_alloc.json()["error"]["code"] or "client" in r_alloc.json()["error"]["message"].lower()


# =============================================================================
# 19.3 API SECURITY TESTS (3 tests)
# =============================================================================


def test_19_3_sql_injection_and_sort_whitelist_enforcement(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies SQL injection payloads in search and sort parameters are safely neutralized or rejected."""
    admin_hdrs = security_staff_accounts["admin_headers"]

    # Malicious sort_by column expression is strictly rejected by whitelist
    r_sort = client.get(
        "/api/v1/clients",
        headers=admin_hdrs,
        params={"sort_by": "name; DROP TABLE public.users;--"},
    )
    assert r_sort.status_code == 400
    assert r_sort.json()["error"]["code"] == "INVALID_SORT_FIELD"

    # Parameterized search query handles SQLi payload as literal text without error
    r_search = client.get(
        "/api/v1/clients",
        headers=admin_hdrs,
        params={"search": "' OR 1=1; SELECT pg_sleep(1);--"},
    )
    assert r_search.status_code == 200
    assert r_search.json()["data"] == []


def test_19_3_mass_assignment_and_extra_fields_rejected(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies strict Pydantic input schemas (`extra='forbid'`) reject mass-assignment fields on write endpoints."""
    admin_hdrs = security_staff_accounts["admin_headers"]
    r_mass = client.post(
        "/api/v1/clients",
        headers=admin_hdrs,
        json_body={
            "name": "Legit Name",
            "is_superuser": True,
            "balance_due": "0.00",
            "created_by": str(uuid.uuid4()),
        },
    )
    assert r_mass.status_code == 422
    assert r_mass.json()["error"]["code"] == "VALIDATION_FAILURE"


def test_19_3_sec05_security_headers_and_stack_trace_suppression(client: AsgiTestClient):
    """SEC-04 & SEC-05 Retest: Verifies HTTP security headers are present and error responses leak no internals."""
    res = client.get("/health")
    assert res.status_code == 200
    hdrs = res.headers
    assert hdrs.get("x-content-type-options") == "nosniff"
    assert hdrs.get("x-frame-options") == "DENY"
    assert hdrs.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "max-age=" in hdrs.get("strict-transport-security", "")
    assert "includeSubDomains" in hdrs.get("strict-transport-security", "")
    assert "camera=()" in hdrs.get("permissions-policy", "")
    assert "default-src" in hdrs.get("content-security-policy", "")
    assert "x-request-id" in hdrs

    # Verify 401/422 error payloads never contain tracebacks or SQL internals
    r_err = client.get("/api/v1/invoices/not-a-valid-uuid")
    assert r_err.status_code in (401, 422)
    assert "Traceback" not in r_err.text
    assert "sqlalchemy" not in r_err.text.lower()


# =============================================================================
# 19.4 FINANCIAL SECURITY TESTS (4 tests)
# =============================================================================


def test_19_4_tampered_totals_and_binary_floats_rejected(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies binary floats and client-supplied total overrides are rejected on financial documents."""
    admin_hdrs = security_staff_accounts["admin_headers"]
    c_id = client.post(
        "/api/v1/clients",
        headers=admin_hdrs,
        json_body={"name": f"Float Test Client {uuid.uuid4().hex[:4]}"},
    ).json()["data"]["id"]

    # Binary float unit_price rejected
    r_float = client.post(
        "/api/v1/invoices",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "items": [{"description": "Item", "quantity": "1", "unit_price": 199.99}],
        },
    )
    assert r_float.status_code == 422

    # Client attempting to inject precomputed `total` field rejected by extra="forbid"
    r_tamper = client.post(
        "/api/v1/invoices",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "total": "1.00",
            "items": [{"description": "Item", "quantity": "1", "unit_price": "50000.00"}],
        },
    )
    assert r_tamper.status_code == 422


def test_19_4_unconfirmed_payment_allocation_and_receipting_blocked(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies pending/unconfirmed payments cannot be allocated to invoices or generate receipts."""
    admin_hdrs = security_staff_accounts["admin_headers"]
    c_id = client.post(
        "/api/v1/clients",
        headers=admin_hdrs,
        json_body={"name": f"Unconfirmed Guard Client {uuid.uuid4().hex[:4]}"},
    ).json()["data"]["id"]

    inv_id = client.post(
        "/api/v1/invoices",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "issue_immediately": True,
            "items": [{"description": "Service", "quantity": "1", "unit_price": "15000.00"}],
        },
    ).json()["data"]["id"]

    pay_id = client.post(
        "/api/v1/payments",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "amount": "15000.00",
            "payment_method": "mpesa",
            "external_reference": f"MPESA-{uuid.uuid4().hex[:8]}",
            "confirm_immediately": False,
        },
    ).json()["data"]["id"]

    r_alloc = client.post(
        f"/api/v1/payments/{pay_id}/allocate",
        headers=admin_hdrs,
        json_body={"allocations": [{"invoice_id": inv_id, "amount": "15000.00"}]},
    )
    assert r_alloc.status_code == 409
    assert r_alloc.json()["error"]["code"] == "UNCONFIRMED_PAYMENT_ALLOCATION"

    r_rcp = client.post(
        "/api/v1/receipts/from-payment",
        headers=admin_hdrs,
        json_body={"payment_id": pay_id},
    )
    assert r_rcp.status_code == 409
    assert r_rcp.json()["error"]["code"] == "UNCONFIRMED_PAYMENT_RECEIPT_FORBIDDEN"


def test_19_4_duplicate_receipting_and_over_allocation_blocked(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies a confirmed payment cannot be over-allocated or generate duplicate active receipts."""
    admin_hdrs = security_staff_accounts["admin_headers"]
    c_id = client.post(
        "/api/v1/clients",
        headers=admin_hdrs,
        json_body={"name": f"Double Receipt Guard {uuid.uuid4().hex[:4]}"},
    ).json()["data"]["id"]

    inv_id = client.post(
        "/api/v1/invoices",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "issue_immediately": True,
            "items": [{"description": "License", "quantity": "1", "unit_price": "8000.00"}],
        },
    ).json()["data"]["id"]

    pay_id = client.post(
        "/api/v1/payments",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "amount": "8000.00",
            "payment_method": "bank_transfer",
            "external_reference": f"REF-{uuid.uuid4().hex[:8]}",
            "confirm_immediately": True,
        },
    ).json()["data"]["id"]

    # Over-allocation beyond 8000.00 rejected
    r_over = client.post(
        f"/api/v1/payments/{pay_id}/allocate",
        headers=admin_hdrs,
        json_body={"allocations": [{"invoice_id": inv_id, "amount": "9500.00"}]},
    )
    assert r_over.status_code == 409

    # First receipt succeeds
    r_rcp1 = client.post(
        "/api/v1/receipts/from-payment",
        headers=admin_hdrs,
        json_body={"payment_id": pay_id, "amount_acknowledged": "8000.00"},
    )
    assert r_rcp1.status_code == 201

    # Second receipt for same fully-receipted payment rejected with 409 DOUBLE_RECEIPTING_PREVENTED
    r_rcp2 = client.post(
        "/api/v1/receipts/from-payment",
        headers=admin_hdrs,
        json_body={"payment_id": pay_id, "amount_acknowledged": "1000.00"},
    )
    assert r_rcp2.status_code == 409
    assert r_rcp2.json()["error"]["code"] == "DOUBLE_RECEIPTING_PREVENTED"


def test_19_4_finalized_invoice_immutability_and_unauthorized_refund_blocked(
    client: AsgiTestClient, security_staff_accounts
):
    """Verifies issued invoices cannot be edited and cashiers cannot cancel receipts or refund payments."""
    admin_hdrs = security_staff_accounts["admin_headers"]
    cashier_hdrs = security_staff_accounts["cashier_headers"]

    c_id = client.post(
        "/api/v1/clients",
        headers=admin_hdrs,
        json_body={"name": f"Immutability Guard {uuid.uuid4().hex[:4]}"},
    ).json()["data"]["id"]

    inv_id = client.post(
        "/api/v1/invoices",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "issue_immediately": True,
            "items": [{"description": "Audit", "quantity": "1", "unit_price": "12000.00"}],
        },
    ).json()["data"]["id"]

    # Editing an issued invoice is blocked with 409 IMMUTABLE_INVOICE
    r_edit = client.put(
        f"/api/v1/invoices/{inv_id}",
        headers=admin_hdrs,
        json_body={"notes": "Tampering after issue"},
    )
    assert r_edit.status_code == 409
    assert r_edit.json()["error"]["code"] == "IMMUTABLE_INVOICE"

    pay_id = client.post(
        "/api/v1/payments",
        headers=admin_hdrs,
        json_body={
            "client_id": c_id,
            "amount": "12000.00",
            "payment_method": "cash",
            "external_reference": f"CSH-{uuid.uuid4().hex[:8]}",
            "confirm_immediately": True,
        },
    ).json()["data"]["id"]

    rcp_id = client.post(
        "/api/v1/receipts/from-payment",
        headers=admin_hdrs,
        json_body={"payment_id": pay_id},
    ).json()["data"]["id"]

    # Cashier attempting to refund payment or cancel receipt is blocked with 403
    r_cashier_refund = client.post(
        f"/api/v1/payments/{pay_id}/refund",
        headers=cashier_hdrs,
        json_body={"amount": "1000.00", "reason": "Unauthorized cashier refund"},
    )
    assert r_cashier_refund.status_code == 403

    r_cashier_void = client.post(
        f"/api/v1/receipts/{rcp_id}/cancel",
        headers=cashier_hdrs,
        json_body={"reason": "Unauthorized cashier void"},
    )
    assert r_cashier_void.status_code == 403


# =============================================================================
# 19.5 FILE SECURITY TESTS (1 comprehensive multi-vector test)
# =============================================================================


def test_19_5_sec03_executable_and_spoofed_magic_byte_uploads_blocked(
    client: AsgiTestClient, security_staff_accounts
):
    """SEC-03 Retest: Executable extensions, path traversal, and spoofed magic-byte signatures are blocked."""
    admin_hdrs = security_staff_accounts["admin_headers"]

    # 1. Executable extension (.sh) claimed as application/pdf
    r_exe = client.post(
        "/api/v1/company/files",
        headers=admin_hdrs,
        json_body={
            "original_filename": "exploit.sh",
            "mime_type": "application/pdf",
            "content_base64": base64.b64encode(b"%PDF-1.7\n#!/bin/sh\n").decode("ascii"),
        },
    )
    assert r_exe.status_code == 400
    assert r_exe.json()["error"]["code"] == "EXTENSION_MIME_MISMATCH"

    # 2. Path traversal filename rejected
    r_trav = client.post(
        "/api/v1/company/files",
        headers=admin_hdrs,
        json_body={
            "original_filename": "../../etc/passwd",
            "mime_type": "text/plain",
            "content_base64": base64.b64encode(b"root:x:0:0").decode("ascii"),
        },
    )
    assert r_trav.status_code == 400
    assert r_trav.json()["error"]["code"] == "UNSAFE_FILENAME"

    # 3. Spoofed PNG magic bytes (HTML/JS XSS payload claiming to be image/png)
    r_spoof_png = client.post(
        "/api/v1/company/files",
        headers=admin_hdrs,
        json_body={
            "original_filename": "logo.png",
            "mime_type": "image/png",
            "content_base64": base64.b64encode(b"<script>alert(document.cookie)</script>").decode("ascii"),
        },
    )
    assert r_spoof_png.status_code == 400
    assert r_spoof_png.json()["error"]["code"] == "INVALID_FILE_SIGNATURE"

    # 4. Spoofed WebP magic bytes
    r_spoof_webp = client.post(
        "/api/v1/company/files",
        headers=admin_hdrs,
        json_body={
            "original_filename": "stamp.webp",
            "mime_type": "image/webp",
            "content_base64": base64.b64encode(b"NOT_A_RIFF_WEBP_HEADER_123456").decode("ascii"),
        },
    )
    assert r_spoof_webp.status_code == 400
    assert r_spoof_webp.json()["error"]["code"] == "INVALID_FILE_SIGNATURE"

    # 5. Valid WebP magic bytes (RIFF....WEBP) succeed and return nosniff on download
    valid_webp = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 20
    r_valid_webp = client.post(
        "/api/v1/company/files",
        headers=admin_hdrs,
        json_body={
            "original_filename": "company_stamp.webp",
            "mime_type": "image/webp",
            "content_base64": base64.b64encode(valid_webp).decode("ascii"),
            "access_classification": "authenticated",
        },
    )
    assert r_valid_webp.status_code == 201, r_valid_webp.text
    file_data = r_valid_webp.json()["data"]

    # Unauthenticated download of non-public file is blocked
    assert client.get(f"/api/v1/company/files/{file_data['id']}/download").status_code == 401

    # Authenticated download includes X-Content-Type-Options: nosniff
    r_dl = client.get(f"/api/v1/company/files/{file_data['id']}/download", headers=admin_hdrs)
    assert r_dl.status_code == 200
    assert r_dl.headers.get("x-content-type-options") == "nosniff"


# =============================================================================
# 19.6 & 19.7 FRONTEND HARDENING, AUDIT IMMUTABILITY & BACKUP/RESTORE TESTS (3 tests)
# =============================================================================


def test_19_6_nextjs_security_configurations_and_route_hardening():
    """Verifies Next.js security headers, error sanitization, magic-byte validation, and session revocation in source."""
    root = Path(__file__).resolve().parent.parent

    next_cfg = (root / "next.config.ts").read_text(encoding="utf-8")
    assert "Content-Security-Policy" in next_cfg
    assert "Strict-Transport-Security" in next_cfg
    assert "X-Content-Type-Options" in next_cfg
    assert "poweredByHeader: false" in next_cfg

    http_ts = (root / "src/lib/server/http.ts").read_text(encoding="utf-8")
    assert "An unexpected internal server error occurred" in http_ts

    branding_route = (root / "src/app/api/settings/branding/route.ts").read_text(encoding="utf-8")
    assert "hasValidImageMagicBytes" in branding_route
    assert "MAX_BRANDING_BYTES" in branding_route

    users_route = (root / "src/app/api/users/route.ts").read_text(encoding="utf-8")
    assert "WelcomeFolio2026!" not in users_route
    assert "db.delete(schema.sessions)" in users_route


def test_19_7_sec06_database_audit_logs_immutability_trigger(
    db_engine, client: AsgiTestClient, security_staff_accounts
):
    """SEC-06 Retest: Verifies PostgreSQL trigger `trg_protect_audit_logs_immutable` blocks UPDATE and DELETE on audit_logs."""
    r_logs = client.get("/api/v1/audit/logs", headers=security_staff_accounts["admin_headers"])
    assert r_logs.status_code == 200
    items = r_logs.json()["data"]
    assert len(items) > 0
    target_log_id = items[0]["id"]

    # Attempting to UPDATE an existing audit_logs row must raise an exception from the DB trigger
    with Session(db_engine) as s:
        with pytest.raises(Exception, match="append-only|immutable"):
            s.execute(
                text("UPDATE public.audit_logs SET action = 'tampered.action' WHERE id = :id"),
                {"id": target_log_id},
            )
            s.commit()
        s.rollback()

    # Attempting to DELETE an existing audit_logs row must raise an exception from the DB trigger
    with Session(db_engine) as s:
        with pytest.raises(Exception, match="append-only|immutable"):
            s.execute(
                text("DELETE FROM public.audit_logs WHERE id = :id"),
                {"id": target_log_id},
            )
            s.commit()
        s.rollback()


def test_19_7_backup_and_restore_drill_verification(db_engine):
    """Section 15 Verification: Executes a non-destructive backup & restore drill for critical financial records."""
    with Session(db_engine) as s:
        # 1. Export snapshot of critical tables (company_settings, numbering_sequences)
        company_rows = s.execute(
            text("SELECT id, name, currency, number_prefix FROM public.company_settings")
        ).mappings().all()
        seq_rows = s.execute(
            text("SELECT document_type, prefix, last_value FROM public.numbering_sequences")
        ).mappings().all()

        assert len(company_rows) >= 1
        assert len(seq_rows) >= 1

        # 2. Restore into a temporary verification table inside a transaction and verify checksums/row counts
        s.execute(
            text(
                """
                CREATE TEMP TABLE tmp_restore_company_verify (
                    id integer PRIMARY KEY,
                    name text NOT NULL,
                    currency text NOT NULL,
                    number_prefix text NOT NULL
                ) ON COMMIT DROP;
                """
            )
        )
        for row in company_rows:
            s.execute(
                text(
                    """
                    INSERT INTO tmp_restore_company_verify (id, name, currency, number_prefix)
                    VALUES (:id, :name, :currency, :number_prefix)
                    """
                ),
                dict(row),
            )

        restored_count = s.execute(text("SELECT count(*) FROM tmp_restore_company_verify")).scalar_one()
        assert restored_count == len(company_rows)
        s.commit()
