"""
MP-15 Comprehensive Backend API Architecture, Financial Workflow & Security Test Suite.
Executes against live PostgreSQL and tests the complete FastAPI ASGI application:
1. Unit Tests (19.1): Decimal validation, scrypt password hashing, authoritative line math, permissions, idempotency, rate limiting, audit redaction
2. API Integration Tests (19.2): Health/Ready/OpenAPI, Auth, Users/RBAC, Company/Templates, File Upload/Download, CRM, Taxes, Communications, Reconciliation
3. Financial Workflow Tests (19.3): 13-step E2E Quote->Invoice->Partial Payments->Allocations->Receipts->Public Verification->Reports, unconfirmed payment rejection, over-allocation/double-receipting prevention, idempotency, refunds & reversals, immutability, reprints, concurrency
4. Security Tests (19.4): Unauthenticated/invalid tokens, deactivated user revocation, cashier role escalation blocking, mass assignment/float rejection, PAN & unsafe upload rejection, public verification privacy & rate limiting, SQL sort-field whitelist
5. Regression Tests (19.5): Legacy Next.js companion endpoints (`/api/v1/dashboard-stats`, `/api/v1/reports`) and immutable audit logging
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi_service.core.config import settings
from fastapi_service.core.exceptions import ConflictError, RateLimitError
from fastapi_service.core.pagination import (
    validate_money_decimal,
    validate_quantity_decimal,
    validate_tax_rate_decimal,
)
from fastapi_service.core.permissions import AuthenticatedUser
from fastapi_service.core.security import (
    IdempotencyRegistry,
    SlidingWindowRateLimiter,
    hash_password,
    rate_limiter,
    sanitize_audit_dict,
    verify_password,
)
from fastapi_service.database import build_sync_engine
from fastapi_service.main import app
from fastapi_service.models.identity import User
from fastapi_service.services.financial_service import compute_authoritative_document_totals


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
    """
    Zero-dependency in-process ASGI test client for FastAPI/Starlette applications.
    Executes the full middleware, routing, validation, dependency injection, and exception handling stack.
    """

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
def test_staff_accounts(db_engine, client: AsgiTestClient) -> dict[str, Any]:
    """Creates an active admin account and an active cashier account and logs both in via `/api/v1/auth/login`."""
    rate_limiter.reset()
    suffix = uuid.uuid4().hex[:8]
    admin_email = f"mp15-admin-{suffix}@ledgerly.co.ke"
    cashier_email = f"mp15-cashier-{suffix}@ledgerly.co.ke"
    pw = "StrongPass#2026!"

    with Session(db_engine) as s:
        admin_user = User(
            email=admin_email,
            password_hash=hash_password(pw),
            full_name="MP15 Chief Administrator",
            role="admin",
            active=True,
        )
        cashier_user = User(
            email=cashier_email,
            password_hash=hash_password(pw),
            full_name="MP15 Front Cashier",
            role="cashier",
            active=True,
        )
        s.add_all([admin_user, cashier_user])
        s.commit()
        admin_id = admin_user.id
        cashier_id = cashier_user.id

    res_admin = client.post("/api/v1/auth/login", json_body={"email": admin_email, "password": pw})
    assert res_admin.status_code == 200, res_admin.text
    admin_token = res_admin.json()["data"]["access_token"]

    res_cashier = client.post("/api/v1/auth/login", json_body={"email": cashier_email, "password": pw})
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
# 19.1 UNIT TESTS (7 tests)
# =============================================================================


def test_unit_decimal_money_rejects_float_and_excess_precision():
    assert validate_money_decimal("1250.5") == Decimal("1250.50")
    assert validate_money_decimal(100) == Decimal("100.00")
    assert validate_quantity_decimal("2.5") == Decimal("2.500")
    assert validate_tax_rate_decimal("16") == Decimal("16.0000")

    with pytest.raises(ValueError, match="binary float is not allowed"):
        validate_money_decimal(19.99)

    with pytest.raises(ValueError, match="at most 2 decimal places"):
        validate_money_decimal("19.999")


def test_unit_password_scrypt_hash_and_verify():
    hashed = hash_password("MySecurePassword!99")
    assert hashed.startswith("scrypt$")
    assert verify_password("MySecurePassword!99", hashed) is True
    assert verify_password("WrongPassword", hashed) is False
    assert verify_password("MySecurePassword!99", "invalid$hash") is False


def test_unit_authoritative_line_calculation_inclusive_and_exclusive_tax(db_engine):
    with Session(db_engine) as s:
        res = compute_authoritative_document_totals(
            s,
            [
                {
                    "description": "Enterprise Server License",
                    "quantity": Decimal("2.000"),
                    "unit_price": Decimal("25000.00"),
                    "discount_amount": Decimal("5000.00"),
                    "tax_rate": Decimal("16.0000"),
                },
                {
                    "description": "Implementation Support",
                    "quantity": Decimal("1.000"),
                    "unit_price": Decimal("10000.00"),
                    "discount_amount": Decimal("0.00"),
                    "tax_rate": Decimal("0.0000"),
                },
            ],
        )
        # Item 1: 2 * 25,000 = 50,000 - 5,000 discount = 45,000 net + 16% tax (7,200) = 52,200
        # Item 2: 1 * 10,000 = 10,000
        assert res.subtotal == Decimal("55000.00")
        assert res.discount_total == Decimal("5000.00")
        assert res.tax_total == Decimal("7200.00")
        assert res.total == Decimal("62200.00")


def test_unit_permission_evaluation_matrix():
    admin = AuthenticatedUser(
        id=uuid.uuid4(),
        email="a@test.com",
        full_name="Admin",
        role="admin",
        active=True,
        roles={"admin"},
        permissions={"*"},
    )
    cashier = AuthenticatedUser(
        id=uuid.uuid4(),
        email="c@test.com",
        full_name="Cashier",
        role="cashier",
        active=True,
        roles={"cashier"},
        permissions={"receipts:read", "receipts:write"},
    )
    inactive = AuthenticatedUser(
        id=uuid.uuid4(),
        email="i@test.com",
        full_name="Inactive",
        role="admin",
        active=False,
        roles={"admin"},
        permissions={"*"},
    )

    assert admin.has_permission("users:manage") is True
    assert admin.has_permission("reports:read") is True
    assert cashier.has_permission("receipts:write") is True
    assert cashier.has_permission("reports:read") is False
    assert inactive.has_permission("receipts:read") is False


def test_unit_idempotency_registry_retry_and_conflict():
    reg = IdempotencyRegistry()
    key = "idem-test-001"
    payload_a = {"amount": "40000.00", "invoice_id": "inv-1"}
    payload_b = {"amount": "50000.00", "invoice_id": "inv-1"}

    assert reg.get_or_verify("user-1", "payment.allocate", key, payload_a) is None
    reg.store("user-1", "payment.allocate", key, payload_a, {"data": {"ok": True}})

    # Exact retry returns stored response
    cached = reg.get_or_verify("user-1", "payment.allocate", key, payload_a)
    assert cached == {"data": {"ok": True}}

    # Conflicting payload with same key raises 409 ConflictError
    with pytest.raises(ConflictError) as exc_info:
        reg.get_or_verify("user-1", "payment.allocate", key, payload_b)
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "IDEMPOTENCY_KEY_CONFLICT"


def test_unit_rate_limiter_sliding_window():
    limiter = SlidingWindowRateLimiter()
    limiter.check_and_record("bucket-1", max_attempts=2, window_seconds=60)
    limiter.check_and_record("bucket-1", max_attempts=2, window_seconds=60)
    with pytest.raises(RateLimitError) as exc_info:
        limiter.check_and_record("bucket-1", max_attempts=2, window_seconds=60)
    assert exc_info.value.status_code == 429


def test_unit_audit_sanitization_redacts_secrets():
    dirty = {
        "email": "user@example.com",
        "password": "PlaintextPassword123",
        "nested": {"access_token": "secret-jwt", "cvv": "999", "safe_field": "ok"},
    }
    clean = sanitize_audit_dict(dirty)
    assert clean["email"] == "user@example.com"
    assert clean["password"] == "[REDACTED]"
    assert clean["nested"]["access_token"] == "[REDACTED]"
    assert clean["nested"]["cvv"] == "[REDACTED]"
    assert clean["nested"]["safe_field"] == "ok"


# =============================================================================
# 19.2 API INTEGRATION TESTS (9 tests)
# =============================================================================


def test_api_health_and_readiness_endpoints(client: AsgiTestClient):
    r_health = client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json()["status"] == "ok"
    assert "x-request-id" in r_health.headers

    r_ready = client.get("/health/ready")
    assert r_ready.status_code == 200
    assert r_ready.json()["data"]["database"] == "connected"

    r_openapi = client.get("/openapi.json")
    assert r_openapi.status_code == 200
    spec = r_openapi.json()
    assert "/api/v1/quotations" in spec["paths"]
    assert "/api/v1/invoices" in spec["paths"]
    assert "/api/v1/payments" in spec["paths"]
    assert "/api/v1/receipts" in spec["paths"]
    assert "/api/v1/verification/{verification_code}" in spec["paths"]


def test_api_auth_login_me_logout_and_password_reset_flow(client: AsgiTestClient, test_staff_accounts):
    me_res = client.get("/api/v1/auth/me", headers=test_staff_accounts["admin_headers"])
    assert me_res.status_code == 200
    me_data = me_res.json()["data"]
    assert me_data["email"] == test_staff_accounts["admin_email"]
    assert "admin" in me_data["roles"]

    fp_res = client.post(
        "/api/v1/auth/forgot-password",
        json_body={"email": test_staff_accounts["cashier_email"]},
    )
    assert fp_res.status_code == 200
    assert fp_res.json()["data"]["status"] == "accepted"


def test_api_users_and_roles_crud(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:6]
    headers = test_staff_accounts["admin_headers"]

    # Create custom role
    role_res = client.post(
        "/api/v1/users/roles",
        headers=headers,
        json_body={
            "code": f"crm_specialist_{suffix}",
            "name": "CRM Specialist",
            "description": "Manages client interactions",
            "permission_codes": ["clients:read", "clients:write"],
        },
    )
    assert role_res.status_code == 201, role_res.text
    assert role_res.json()["data"]["code"] == f"crm_specialist_{suffix}"

    # Create new staff user with that role
    u_res = client.post(
        "/api/v1/users",
        headers=headers,
        json_body={
            "email": f"staff-{suffix}@ledgerly.co.ke",
            "password": "StaffPassword#2026",
            "full_name": f"Staff Member {suffix}",
            "role": "cashier",
            "active": True,
            "role_codes": [f"crm_specialist_{suffix}"],
        },
    )
    assert u_res.status_code == 201, u_res.text
    user_data = u_res.json()["data"]
    assert f"crm_specialist_{suffix}" in user_data["assigned_roles"]
    assert "password_hash" not in user_data

    # List users with pagination
    list_res = client.get("/api/v1/users", headers=headers, params={"page": 1, "page_size": 10, "search": suffix})
    assert list_res.status_code == 200
    assert list_res.json()["pagination"]["total_items"] >= 1


def test_api_company_settings_and_templates(client: AsgiTestClient, test_staff_accounts):
    headers = test_staff_accounts["admin_headers"]
    get_res = client.get("/api/v1/company/settings", headers=headers)
    assert get_res.status_code == 200

    patch_res = client.patch(
        "/api/v1/company/settings",
        headers=headers,
        json_body={"footer": "Thank you for partnering with Ledgerly IBMS."},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["data"]["footer"] == "Thank you for partnering with Ledgerly IBMS."

    tpl_res = client.post(
        "/api/v1/company/templates",
        headers=headers,
        json_body={
            "document_type": "invoice",
            "name": f"Corporate Standard {uuid.uuid4().hex[:4]}",
            "is_default": True,
            "default_terms": "Payment due within 14 days of issue.",
        },
    )
    assert tpl_res.status_code == 201


def test_api_file_upload_and_authenticated_download(client: AsgiTestClient, test_staff_accounts):
    headers = test_staff_accounts["admin_headers"]
    # Minimal valid PNG binary (magic header + IHDR)
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    upload_res = client.post(
        "/api/v1/company/files",
        headers=headers,
        json_body={
            "original_filename": "company_stamp.png",
            "mime_type": "image/png",
            "content_base64": base64.b64encode(png_bytes).decode("ascii"),
            "access_classification": "authenticated",
        },
    )
    assert upload_res.status_code == 201, upload_res.text
    file_id = upload_res.json()["data"]["id"]
    assert upload_res.json()["data"]["file_size_bytes"] == len(png_bytes)

    dl_res = client.get(f"/api/v1/company/files/{file_id}/download", headers=headers)
    assert dl_res.status_code == 200
    assert dl_res.content == png_bytes


def test_api_crm_clients_contacts_interactions_categories_tags(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]

    cat_res = client.post(
        "/api/v1/clients/categories",
        headers=headers,
        json_body={"code": f"CORP_{suffix}", "name": f"Corporate {suffix}"},
    )
    assert cat_res.status_code == 201
    cat_id = cat_res.json()["data"]["id"]

    tag_res = client.post(
        "/api/v1/clients/tags",
        headers=headers,
        json_body={"name": f"Retainer-{suffix}", "color_hex": "#16794F"},
    )
    assert tag_res.status_code == 201
    tag_id = tag_res.json()["data"]["id"]

    c_res = client.post(
        "/api/v1/clients",
        headers=headers,
        json_body={
            "client_type": "corporate",
            "name": f"Nairobi Manufacturing Group {suffix}",
            "email": f"finance@nmg-{suffix.lower()}.co.ke",
            "phone": "+254711000999",
            "address": "Industrial Area, Nairobi",
            "tax_pin": f"P051{suffix}K",
            "category_id": cat_id,
            "tag_ids": [tag_id],
            "contacts": [
                {
                    "full_name": "peter Njoroge",
                    "job_title": "Finance Controller",
                    "email": "peter@nmg.co.ke",
                    "phone": "+254722000999",
                    "is_primary": True,
                }
            ],
        },
    )
    assert c_res.status_code == 201, c_res.text
    client_data = c_res.json()["data"]
    client_id = client_data["id"]
    assert len(client_data["contacts"]) == 1
    assert len(client_data["tags"]) == 1

    inter_res = client.post(
        f"/api/v1/clients/{client_id}/interactions",
        headers=headers,
        json_body={
            "interaction_type": "meeting",
            "subject": "Annual Supply Contract Onboarding",
            "summary": "Confirmed billing cycle and LPO terms.",
        },
    )
    assert inter_res.status_code == 201

    list_res = client.get("/api/v1/clients", headers=headers, params={"search": suffix})
    assert list_res.status_code == 200
    assert list_res.json()["pagination"]["total_items"] >= 1


def test_api_tax_configuration_crud(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:5].upper()
    headers = test_staff_accounts["admin_headers"]

    create_res = client.post(
        "/api/v1/taxes",
        headers=headers,
        json_body={
            "code": f"VAT16_{suffix}",
            "name": "Standard VAT 16%",
            "rate": "16.0000",
            "tax_type": "vat",
            "is_inclusive": False,
            "applicable_to": "all",
        },
    )
    assert create_res.status_code == 201, create_res.text
    assert create_res.json()["data"]["rate"] == "16.0000"

    list_res = client.get("/api/v1/taxes", headers=headers, params={"active_only": True})
    assert list_res.status_code == 200
    assert len(list_res.json()["data"]) >= 1


def test_api_communications_email_and_sms_queuing(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:5]
    headers = test_staff_accounts["admin_headers"]

    tpl_res = client.post(
        "/api/v1/communications/templates",
        headers=headers,
        json_body={
            "code": f"invoice_issued_{suffix}",
            "channel": "email",
            "name": "Invoice Issued Notification",
            "subject_template": "Invoice {{invoice_number}} from Ledgerly",
            "body_template": "Dear {{client_name}}, please find your invoice attached.",
        },
    )
    assert tpl_res.status_code == 201

    email_res = client.post(
        "/api/v1/communications/email",
        headers=headers,
        json_body={
            "recipient": "accounts@client.co.ke",
            "subject": "Invoice INV-2026-000100",
            "message_type": "invoice",
            "body": "Please find your invoice details.",
        },
    )
    assert email_res.status_code == 202
    assert email_res.json()["data"]["status"] == "queued"

    sms_res = client.post(
        "/api/v1/communications/sms",
        headers=headers,
        json_body={
            "recipient": "+254700123456",
            "message_type": "payment_confirmation",
            "body": "We have received your payment of KES 40,000.00.",
        },
    )
    assert sms_res.status_code == 202
    assert sms_res.json()["data"]["status"] == "queued"


def test_api_reconciliation_batch_import_suggest_confirm_and_reject(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]

    # Create a client and payment with external_reference = MPESA-TX-{suffix}
    c_res = client.post(
        "/api/v1/clients",
        headers=headers,
        json_body={"name": f"Recon Client {suffix}", "client_type": "corporate"},
    )
    client_id = c_res.json()["data"]["id"]

    p_res = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={
            "client_id": client_id,
            "amount": "18500.00",
            "payment_method": "mpesa",
            "external_reference": f"MPESA{suffix}",
            "confirm_immediately": True,
        },
    )
    assert p_res.status_code == 201

    # Import reconciliation batch containing that M-Pesa transaction + an unmatched bank tx
    b_res = client.post(
        "/api/v1/reconciliation/batches",
        headers=headers,
        json_body={
            "source_type": "mpesa_statement",
            "account_identifier": "Paybill 400200",
            "records": [
                {
                    "external_tx_id": f"MPESA{suffix}",
                    "payment_method": "mpesa",
                    "transaction_date": datetime.now(timezone.utc).isoformat(),
                    "amount": "18500.00",
                    "payer_name": f"Recon Client {suffix}",
                },
                {
                    "external_tx_id": f"UNMATCHED{suffix}",
                    "payment_method": "mpesa",
                    "transaction_date": datetime.now(timezone.utc).isoformat(),
                    "amount": "9200.00",
                    "payer_name": "Unknown Sender",
                },
            ],
        },
    )
    assert b_res.status_code == 201, b_res.text
    batch_data = b_res.json()["data"]
    assert batch_data["total_records"] == 2

    suggested_rec = next(r for r in batch_data["records"] if r["external_tx_id"] == f"MPESA{suffix}")
    assert suggested_rec["match_status"] == "suggested"
    match_id = suggested_rec["matches"][0]["id"]

    # Confirm the suggested match
    conf_res = client.post(f"/api/v1/reconciliation/matches/{match_id}/confirm", headers=headers)
    assert conf_res.status_code == 200
    assert conf_res.json()["data"]["match_state"] == "confirmed"

    # Attempting to create a second confirmed match on the same record must fail with 409
    dup_res = client.post(
        "/api/v1/reconciliation/matches",
        headers=headers,
        json_body={
            "reconciliation_record_id": suggested_rec["id"],
            "payment_id": p_res.json()["data"]["id"],
            "matched_amount": "18500.00",
            "confirm_immediately": True,
        },
    )
    assert dup_res.status_code == 409


# =============================================================================
# 19.3 FINANCIAL WORKFLOW TESTS (8 tests)
# =============================================================================


def test_financial_workflow_end_to_end_13_steps(client: AsgiTestClient, test_staff_accounts):
    """
    Executes the complete 13-step financial lifecycle required by Section 19.3 & Section 9.1:
    1. Create client
    2. Create & issue quotation (KES 100,000.00)
    3. Accept quotation
    4. Convert quotation to invoice (preserving original quotation)
    5. Issue invoice
    6. Record partial payment 1 (KES 40,000.00)
    7. Confirm payment 1
    8. Allocate payment 1 to invoice -> invoice balance_due = KES 60,000.00, status = partially_paid
    9. Generate Receipt 1 (KES 40,000.00)
    10. Verify Receipt 1 publicly
    11. Record, confirm & allocate payment 2 (KES 60,000.00) and generate Receipt 2 (KES 60,000.00)
    12. Confirm invoice is paid (balance_due = 0.00)
    13. Verify client ledger & revenue reports have exact totals without double-counting
    """
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]

    # Step 1: Create Client
    c_res = client.post(
        "/api/v1/clients",
        headers=headers,
        json_body={
            "client_type": "corporate",
            "name": f"Safaricom Enterprise {suffix}",
            "email": f"ap@safaricom-{suffix.lower()}.co.ke",
            "phone": "+254722002200",
            "address": "Waiyaki Way, Westlands, Nairobi",
        },
    )
    assert c_res.status_code == 201
    client_id = c_res.json()["data"]["id"]

    # Step 2: Create & Issue Quotation for KES 100,000.00
    q_res = client.post(
        "/api/v1/quotations",
        headers=headers,
        json_body={
            "client_id": client_id,
            "terms": "50% deposit, balance on completion",
            "items": [
                {
                    "description": "Enterprise ERP Integration Phase 1",
                    "quantity": "1.000",
                    "unit_price": "60000.00",
                },
                {
                    "description": "Security Hardening & Training",
                    "quantity": "2.000",
                    "unit_price": "20000.00",
                },
            ],
        },
    )
    assert q_res.status_code == 201, q_res.text
    quote_id = q_res.json()["data"]["id"]
    assert q_res.json()["data"]["total"] == "100000.00"

    q_issue = client.post(f"/api/v1/quotations/{quote_id}/issue", headers=headers)
    assert q_issue.status_code == 200
    assert q_issue.json()["data"]["status"] == "sent"
    assert q_issue.json()["data"]["quote_number"] is not None

    # Step 3: Accept Quotation
    q_accept = client.post(f"/api/v1/quotations/{quote_id}/accept", headers=headers)
    assert q_accept.status_code == 200
    assert q_accept.json()["data"]["status"] == "approved"

    # Step 4: Convert Accepted Quotation to Invoice
    conv_res = client.post(
        f"/api/v1/quotations/{quote_id}/convert-to-invoice",
        headers=headers,
        json_body={"issue_immediately": False},
    )
    assert conv_res.status_code == 201, conv_res.text
    invoice_id = conv_res.json()["data"]["invoice_id"]

    # Verify original quotation is preserved with status='converted'
    q_check = client.get(f"/api/v1/quotations/{quote_id}", headers=headers)
    assert q_check.json()["data"]["status"] == "converted"
    assert q_check.json()["data"]["total"] == "100000.00"

    # Step 5: Issue Invoice
    inv_issue = client.post(f"/api/v1/invoices/{invoice_id}/issue", headers=headers)
    assert inv_issue.status_code == 200
    inv_data = inv_issue.json()["data"]
    assert inv_data["status"] == "issued"
    assert inv_data["total"] == "100000.00"
    assert inv_data["balance_due"] == "100000.00"

    # Step 6: Record Partial Payment 1 (KES 40,000.00) in pending status
    p1_res = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={
            "client_id": client_id,
            "amount": "40000.00",
            "payment_method": "mpesa",
            "external_reference": f"MP1-{suffix}",
            "confirm_immediately": False,
        },
    )
    assert p1_res.status_code == 201
    p1_id = p1_res.json()["data"]["id"]
    assert p1_res.json()["data"]["status"] == "pending"

    # Step 7: Confirm Payment 1
    p1_conf = client.post(f"/api/v1/payments/{p1_id}/confirm", headers=headers)
    assert p1_conf.status_code == 200
    assert p1_conf.json()["data"]["status"] == "confirmed"

    # Step 8: Allocate Payment 1 (KES 40,000.00) to Invoice
    p1_alloc = client.post(
        f"/api/v1/payments/{p1_id}/allocate",
        headers=headers,
        json_body={"allocations": [{"invoice_id": invoice_id, "amount": "40000.00"}]},
    )
    assert p1_alloc.status_code == 200
    assert p1_alloc.json()["data"]["amount_allocated"] == "40000.00"
    assert p1_alloc.json()["data"]["unallocated_amount"] == "0.00"

    inv_mid = client.get(f"/api/v1/invoices/{invoice_id}", headers=headers).json()["data"]
    assert inv_mid["status"] == "partially_paid"
    assert inv_mid["amount_allocated"] == "40000.00"
    assert inv_mid["balance_due"] == "60000.00"

    # Step 9: Generate Receipt 1 from Confirmed Payment 1
    rcp1_res = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers,
        json_body={"payment_id": p1_id, "invoice_id": invoice_id},
    )
    assert rcp1_res.status_code == 201, rcp1_res.text
    rcp1_data = rcp1_res.json()["data"]
    assert rcp1_data["amount_paid"] == "40000.00"
    assert rcp1_data["status"] == "finalized"
    v_code_1 = rcp1_data["verification_code"]

    # Step 10: Publicly Verify Receipt 1
    pub_res = client.get(f"/api/v1/verification/{v_code_1}")
    assert pub_res.status_code == 200
    pub_data = pub_res.json()["data"]
    assert pub_data["result"] == "valid"
    assert pub_data["receipt_number"] == rcp1_data["receipt_number"]
    assert pub_data["amount_paid"] == "40000.00"
    assert "*" in pub_data["customer"]  # Customer name is masked

    # Step 11: Record, Confirm & Allocate Second Payment (KES 60,000.00) + Receipt 2
    p2_res = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={
            "client_id": client_id,
            "amount": "60000.00",
            "payment_method": "bank_transfer",
            "external_reference": f"BT2-{suffix}",
            "confirm_immediately": True,
        },
    )
    assert p2_res.status_code == 201
    p2_id = p2_res.json()["data"]["id"]

    p2_alloc = client.post(
        f"/api/v1/payments/{p2_id}/allocate",
        headers=headers,
        json_body={"allocations": [{"invoice_id": invoice_id, "amount": "60000.00"}]},
    )
    assert p2_alloc.status_code == 200

    rcp2_res = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers,
        json_body={"payment_id": p2_id, "invoice_id": invoice_id},
    )
    assert rcp2_res.status_code == 201
    assert rcp2_res.json()["data"]["amount_paid"] == "60000.00"

    # Step 12: Confirm Invoice is Paid with 0.00 Balance Due
    inv_final = client.get(f"/api/v1/invoices/{invoice_id}", headers=headers).json()["data"]
    assert inv_final["status"] == "paid"
    assert inv_final["amount_allocated"] == "100000.00"
    assert inv_final["balance_due"] == "0.00"

    # Step 13: Verify Client Ledger Summary & Financial Reports (Zero Double-Counting!)
    ledger_res = client.get(f"/api/v1/clients/{client_id}/ledger", headers=headers)
    assert ledger_res.status_code == 200
    ledger = ledger_res.json()["data"]
    assert ledger["total_invoiced"] == "100000.00"
    assert ledger["total_allocated_to_invoices"] == "100000.00"
    assert ledger["outstanding_invoice_balance"] == "0.00"
    assert ledger["total_confirmed_payments"] == "100000.00"
    assert ledger["net_collections"] == "100000.00"
    assert ledger["total_receipted"] == "100000.00"


def test_financial_workflow_unconfirmed_payment_cannot_be_allocated_or_receipted(
    client: AsgiTestClient, test_staff_accounts
):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]

    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": f"Unconf {suffix}"}).json()["data"]["id"]
    inv_id = client.post(
        "/api/v1/invoices",
        headers=headers,
        json_body={
            "client_id": c_id,
            "issue_immediately": True,
            "items": [{"description": "Consulting", "quantity": "1", "unit_price": "25000.00"}],
        },
    ).json()["data"]["id"]

    pay_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "25000.00", "payment_method": "cheque", "confirm_immediately": False},
    ).json()["data"]["id"]

    # Attempting to allocate a pending payment must be rejected with 409
    alloc_res = client.post(
        f"/api/v1/payments/{pay_id}/allocate",
        headers=headers,
        json_body={"allocations": [{"invoice_id": inv_id, "amount": "25000.00"}]},
    )
    assert alloc_res.status_code == 409
    assert alloc_res.json()["error"]["code"] == "UNCONFIRMED_PAYMENT_ALLOCATION"

    # Attempting to generate a receipt for a pending payment must be rejected with 409
    rcp_res = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers,
        json_body={"payment_id": pay_id},
    )
    assert rcp_res.status_code == 409
    assert rcp_res.json()["error"]["code"] == "UNCONFIRMED_PAYMENT_RECEIPT_FORBIDDEN"


def test_financial_workflow_duplicate_receipt_and_over_allocation_prevented(
    client: AsgiTestClient, test_staff_accounts
):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]

    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": f"Bounds {suffix}"}).json()["data"]["id"]
    inv_id = client.post(
        "/api/v1/invoices",
        headers=headers,
        json_body={
            "client_id": c_id,
            "issue_immediately": True,
            "items": [{"description": "Server Rack", "quantity": "1", "unit_price": "50000.00"}],
        },
    ).json()["data"]["id"]

    pay_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "60000.00", "payment_method": "mpesa", "confirm_immediately": True},
    ).json()["data"]["id"]

    # Over-allocating 55,000 against a 50,000 invoice is rejected with 409
    over_alloc = client.post(
        f"/api/v1/payments/{pay_id}/allocate",
        headers=headers,
        json_body={"allocations": [{"invoice_id": inv_id, "amount": "55000.00"}]},
    )
    assert over_alloc.status_code == 409
    assert over_alloc.json()["error"]["code"] == "INVOICE_OVER_ALLOCATION"

    # Receipting full 60,000 succeeds once
    r1 = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers,
        json_body={"payment_id": pay_id, "amount_acknowledged": "60000.00"},
    )
    assert r1.status_code == 201

    # Attempting to generate a second receipt against the already-receipted payment is rejected with 409
    r2 = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers,
        json_body={"payment_id": pay_id, "amount_acknowledged": "10000.00"},
    )
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "DOUBLE_RECEIPTING_PREVENTED"


def test_financial_workflow_idempotent_confirm_issue_and_receipt_generation(
    client: AsgiTestClient, test_staff_accounts
):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]
    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": f"Idem {suffix}"}).json()["data"]["id"]

    idem_key = f"idem-rcp-{suffix}"
    pay_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "15000.00", "payment_method": "cash", "confirm_immediately": True},
    ).json()["data"]["id"]

    headers_with_idem = {**headers, "Idempotency-Key": idem_key}
    res1 = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers_with_idem,
        json_body={"payment_id": pay_id, "amount_acknowledged": "15000.00"},
    )
    assert res1.status_code == 201
    rcp_id_1 = res1.json()["data"]["id"]

    # Repeating the exact same request with the same Idempotency-Key returns the identical receipt
    res2 = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers_with_idem,
        json_body={"payment_id": pay_id, "amount_acknowledged": "15000.00"},
    )
    assert res2.status_code == 201
    assert res2.json()["data"]["id"] == rcp_id_1

    # Reusing the same Idempotency-Key with a different payload returns 409 IDEMPOTENCY_KEY_CONFLICT
    res_conflict = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers_with_idem,
        json_body={"payment_id": pay_id, "amount_acknowledged": "5000.00"},
    )
    assert res_conflict.status_code == 409
    assert res_conflict.json()["error"]["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_financial_workflow_payment_refund_and_reversal(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]
    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": f"RefundRev {suffix}"}).json()["data"]["id"]

    # 1. Partial refund test
    p_ref_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "50000.00", "payment_method": "mpesa", "confirm_immediately": True},
    ).json()["data"]["id"]

    ref_res = client.post(
        f"/api/v1/payments/{p_ref_id}/refund",
        headers=headers,
        json_body={"amount": "15000.00", "reason": "Scope reduction"},
    )
    assert ref_res.status_code == 201, ref_res.text
    ref_pay = ref_res.json()["data"]
    assert ref_pay["amount"] == "50000.00"  # Original amount preserved!
    assert ref_pay["amount_refunded"] == "15000.00"
    assert ref_pay["unallocated_amount"] == "35000.00"
    assert ref_pay["status"] == "partially_refunded"

    # 2. Full payment reversal test (reverses invoice allocation and restores invoice balance_due)
    inv_id = client.post(
        "/api/v1/invoices",
        headers=headers,
        json_body={
            "client_id": c_id,
            "issue_immediately": True,
            "items": [{"description": "Annual Audit", "quantity": "1", "unit_price": "30000.00"}],
        },
    ).json()["data"]["id"]

    p_rev_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "30000.00", "payment_method": "cheque", "confirm_immediately": True},
    ).json()["data"]["id"]

    client.post(
        f"/api/v1/payments/{p_rev_id}/allocate",
        headers=headers,
        json_body={"allocations": [{"invoice_id": inv_id, "amount": "30000.00"}]},
    )
    assert client.get(f"/api/v1/invoices/{inv_id}", headers=headers).json()["data"]["status"] == "paid"

    rev_res = client.post(
        f"/api/v1/payments/{p_rev_id}/reverse",
        headers=headers,
        json_body={"reason": "Dishonoured cheque returned by bank"},
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["data"]["status"] == "reversed"

    # Invoice balance_due is restored to 30,000.00 and status back to 'issued'!
    inv_after = client.get(f"/api/v1/invoices/{inv_id}", headers=headers).json()["data"]
    assert inv_after["balance_due"] == "30000.00"
    assert inv_after["status"] == "issued"


def test_financial_workflow_issued_invoice_and_receipt_immutability_and_cancellation(
    client: AsgiTestClient, test_staff_accounts
):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]
    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": f"Immut {suffix}"}).json()["data"]["id"]

    inv_res = client.post(
        "/api/v1/invoices",
        headers=headers,
        json_body={
            "client_id": c_id,
            "issue_immediately": True,
            "items": [{"description": "License", "quantity": "1", "unit_price": "10000.00"}],
        },
    )
    inv_id = inv_res.json()["data"]["id"]

    # Attempting to edit an issued invoice must fail with 409 IMMUTABLE_INVOICE
    edit_res = client.put(
        f"/api/v1/invoices/{inv_id}",
        headers=headers,
        json_body={"notes": "Trying to silently mutate issued invoice"},
    )
    assert edit_res.status_code == 409
    assert edit_res.json()["error"]["code"] == "IMMUTABLE_INVOICE"

    # Admin can cancel an unallocated issued invoice with a mandatory reason
    cancel_res = client.post(
        f"/api/v1/invoices/{inv_id}/cancel",
        headers=headers,
        json_body={"reason": "Billed to wrong subsidiary"},
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["data"]["status"] == "cancelled"


def test_financial_workflow_receipt_reprint_increments_copy_without_duplicate_record(
    client: AsgiTestClient, test_staff_accounts
):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]
    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": f"Print {suffix}"}).json()["data"]["id"]

    pay_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "8000.00", "payment_method": "cash", "confirm_immediately": True},
    ).json()["data"]["id"]

    rcp_id = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers,
        json_body={"payment_id": pay_id},
    ).json()["data"]["id"]

    p1 = client.post(f"/api/v1/receipts/{rcp_id}/print", headers=headers)
    assert p1.status_code == 200
    assert p1.json()["data"]["print_count"] == 1
    assert p1.json()["data"]["is_duplicate_copy"] is False

    p2 = client.post(f"/api/v1/receipts/{rcp_id}/print", headers=headers)
    assert p2.status_code == 200
    assert p2.json()["data"]["print_count"] == 2
    assert p2.json()["data"]["is_duplicate_copy"] is True
    assert "DUPLICATE COPY #2" in p2.json()["data"]["banner"]

    pdf_res = client.get(f"/api/v1/receipts/{rcp_id}/pdf", headers=headers)
    assert pdf_res.status_code == 200
    assert pdf_res.content.startswith(b"%PDF-")
    assert pdf_res.headers.get("x-print-count") == "3"


def test_financial_workflow_concurrent_payment_confirm_and_receipt_generation(
    client: AsgiTestClient, test_staff_accounts
):
    """
    Simulates two concurrent API requests attempting to generate a full receipt for the same
    confirmed payment simultaneously. Exactly one must succeed (201) and the other must be
    rejected (409) by PostgreSQL row-level locking on `public.payments`.
    """
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]
    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": f"ConcRcp {suffix}"}).json()["data"]["id"]

    pay_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "22000.00", "payment_method": "mpesa", "confirm_immediately": True},
    ).json()["data"]["id"]

    def worker(_i: int) -> int:
        res = client.post(
            "/api/v1/receipts/from-payment",
            headers=headers,
            json_body={"payment_id": pay_id},
        )
        return res.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(worker, range(2)))

    assert statuses == [201, 409], f"Expected one 201 and one 409 under concurrency, got {statuses}"


# =============================================================================
# 19.4 SECURITY TESTS (7 tests)
# =============================================================================


def test_security_unauthenticated_and_invalid_token_rejected(client: AsgiTestClient):
    res_no_token = client.get("/api/v1/clients")
    assert res_no_token.status_code == 401
    assert res_no_token.json()["error"]["code"] == "UNAUTHENTICATED"

    res_bad_token = client.get("/api/v1/clients", headers={"Authorization": "Bearer forged-invalid-token"})
    assert res_bad_token.status_code == 401
    assert res_bad_token.json()["error"]["code"] == "UNAUTHENTICATED"


def test_security_deactivated_user_sessions_revoked_and_blocked(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:6]
    admin_headers = test_staff_accounts["admin_headers"]

    # Create a temporary user and log them in
    u_res = client.post(
        "/api/v1/users",
        headers=admin_headers,
        json_body={
            "email": f"temp-{suffix}@ledgerly.co.ke",
            "password": "TempPassword#2026",
            "full_name": "Temp Staff",
            "role": "cashier",
            "active": True,
        },
    )
    temp_uid = u_res.json()["data"]["id"]

    login_res = client.post(
        "/api/v1/auth/login",
        json_body={"email": f"temp-{suffix}@ledgerly.co.ke", "password": "TempPassword#2026"},
    )
    temp_token = login_res.json()["data"]["access_token"]
    temp_headers = {"Authorization": f"Bearer {temp_token}"}

    assert client.get("/api/v1/auth/me", headers=temp_headers).status_code == 200

    # Admin deactivates the user -> sessions are immediately revoked
    deact_res = client.post(f"/api/v1/users/{temp_uid}/deactivate", headers=admin_headers)
    assert deact_res.status_code == 200

    # Subsequent request with the old token must fail with 401
    after_res = client.get("/api/v1/auth/me", headers=temp_headers)
    assert after_res.status_code == 401


def test_security_cashier_role_escalation_blocked_on_admin_endpoints(
    client: AsgiTestClient, test_staff_accounts
):
    cashier_headers = test_staff_accounts["cashier_headers"]

    # Cashier cannot list or create users
    assert client.get("/api/v1/users", headers=cashier_headers).status_code == 403
    # Cashier cannot modify company settings
    assert client.patch("/api/v1/company/settings", headers=cashier_headers, json_body={"name": "Hacked"}).status_code == 403
    # Cashier cannot view executive revenue reports
    assert client.get("/api/v1/reports/revenue", headers=cashier_headers).status_code == 403
    # Cashier cannot view security audit logs
    assert client.get("/api/v1/audit/logs", headers=cashier_headers).status_code == 403


def test_security_mass_assignment_and_float_money_rejected(client: AsgiTestClient, test_staff_accounts):
    headers = test_staff_accounts["admin_headers"]

    # Attempting to pass undeclared fields (`is_superuser`, `balance_due`) is rejected by `extra="forbid"` (422)
    mass_res = client.post(
        "/api/v1/clients",
        headers=headers,
        json_body={"name": "Mass Assign Corp", "is_superuser": True},
    )
    assert mass_res.status_code == 422
    assert mass_res.json()["error"]["code"] == "VALIDATION_FAILURE"

    # Passing binary float for monetary amount is rejected with 422
    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": "Float Test"}).json()["data"]["id"]
    float_res = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": 1234.56, "payment_method": "cash"},
    )
    assert float_res.status_code == 422


def test_security_card_pan_and_unsafe_file_uploads_rejected(client: AsgiTestClient, test_staff_accounts):
    headers = test_staff_accounts["admin_headers"]
    c_id = client.post("/api/v1/clients", headers=headers, json_body={"name": "Card Sec"}).json()["data"]["id"]

    # Submitting a 16-digit card number in payment reference or notes is rejected (422)
    pan_res = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={
            "client_id": c_id,
            "amount": "5000.00",
            "payment_method": "card",
            "external_reference": "4532-0151-1283-0366",
        },
    )
    assert pan_res.status_code == 422

    # Uploading an executable file or spoofed PDF signature is rejected (400)
    bad_ext = client.post(
        "/api/v1/company/files",
        headers=headers,
        json_body={
            "original_filename": "malware.exe",
            "mime_type": "application/x-msdownload",
            "content_base64": base64.b64encode(b"MZ-fake").decode("ascii"),
        },
    )
    assert bad_ext.status_code == 400
    assert bad_ext.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"

    spoof_pdf = client.post(
        "/api/v1/company/files",
        headers=headers,
        json_body={
            "original_filename": "fake.pdf",
            "mime_type": "application/pdf",
            "content_base64": base64.b64encode(b"NOT_A_PDF_HEADER").decode("ascii"),
        },
    )
    assert spoof_pdf.status_code == 400
    assert spoof_pdf.json()["error"]["code"] == "INVALID_FILE_SIGNATURE"


def test_security_public_verification_isolation_and_rate_limiting(client: AsgiTestClient, test_staff_accounts):
    suffix = uuid.uuid4().hex[:6].upper()
    headers = test_staff_accounts["admin_headers"]

    c_id = client.post(
        "/api/v1/clients",
        headers=headers,
        json_body={
            "name": "Johnstone Kamau",
            "phone": "+254799888777",
            "address": "Private Residence Plot 42",
            "notes": "CONFIDENTIAL INTERNAL VIP NOTE",
        },
    ).json()["data"]["id"]

    pay_id = client.post(
        "/api/v1/payments",
        headers=headers,
        json_body={"client_id": c_id, "amount": "12000.00", "payment_method": "mpesa", "confirm_immediately": True},
    ).json()["data"]["id"]

    rcp = client.post(
        "/api/v1/receipts/from-payment",
        headers=headers,
        json_body={"payment_id": pay_id, "notes": "Internal receipt remark"},
    ).json()["data"]

    v_res = client.get(f"/api/v1/verification/{rcp['verification_code']}", client_ip=f"10.20.30.{suffix[:2]}")
    assert v_res.status_code == 200
    v_data = v_res.json()["data"]
    assert v_data["result"] == "valid"
    assert v_data["customer"] == "J******** K****"
    # Ensure confidential fields are NEVER present in public verification payload
    raw_json_str = v_res.text
    assert "+254799888777" not in raw_json_str
    assert "Private Residence Plot 42" not in raw_json_str
    assert "CONFIDENTIAL INTERNAL VIP NOTE" not in raw_json_str
    assert "Internal receipt remark" not in raw_json_str

    # Verify per-identifier rate limiting (10 attempts per 10 minutes)
    target_code = f"RLCODE{suffix}"
    for i in range(10):
        r = client.get(f"/api/v1/verification/{target_code}", client_ip=f"192.0.2.{i + 1}")
        assert r.status_code == 200
        assert r.json()["data"]["result"] == "not_found"

    r_limited = client.get(f"/api/v1/verification/{target_code}", client_ip="192.0.2.250")
    assert r_limited.status_code == 429
    assert r_limited.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"


def test_security_invalid_sort_field_rejected(client: AsgiTestClient, test_staff_accounts):
    headers = test_staff_accounts["admin_headers"]
    res = client.get("/api/v1/invoices", headers=headers, params={"sort_by": "password_hash;DROP TABLE users"})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_SORT_FIELD"


# =============================================================================
# 19.5 REGRESSION TESTS (2 tests)
# =============================================================================


def test_regression_legacy_nextjs_companion_endpoints_preserved(client: AsgiTestClient):
    internal_headers = {
        "x-internal-secret": settings.internal_secret,
        "x-user-role": "admin",
        "x-user-active": "true",
    }
    r_dash = client.get("/api/v1/dashboard-stats", headers=internal_headers)
    assert r_dash.status_code == 200
    assert "currency" in r_dash.json()
    assert "verify_stats" in r_dash.json()

    r_rep = client.get(
        "/api/v1/reports",
        headers=internal_headers,
        params={"from": "2026-01-01", "to": "2026-12-31", "status": "finalized"},
    )
    assert r_rep.status_code == 200
    assert isinstance(r_rep.json(), list)


def test_regression_audit_logs_recorded_and_immutable(client: AsgiTestClient, test_staff_accounts):
    headers = test_staff_accounts["admin_headers"]
    res = client.get("/api/v1/audit/logs", headers=headers, params={"page": 1, "page_size": 15})
    assert res.status_code == 200
    data = res.json()["data"]
    assert len(data) >= 1
    assert "action" in data[0]
    assert "outcome" in data[0]
