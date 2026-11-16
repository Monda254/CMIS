"""
Security, Password Hashing (scrypt), Session Token Digests, Rate Limiting,
Idempotency Protection & Audit Logging Primitives (Sections 6, 13, 14 & 15).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import ConflictError, RateLimitError
from fastapi_service.models.identity import AuditLog

REDACT_KEYS = {
    "password",
    "password_hash",
    "new_password",
    "current_password",
    "token",
    "access_token",
    "refresh_token",
    "reset_token",
    "secret",
    "card_number",
    "pan",
    "cvv",
    "cvc",
}


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    """
    Produces a salted scrypt hash in the format `scrypt$<salt_hex>$<derived_hex>`,
    100% compatible with Node.js `crypto.scrypt(password, salt, 64)` in `src/lib/server/auth.ts`.
    """
    salt_hex = secrets.token_hex(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt_hex.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        dklen=64,
    )
    return f"scrypt${salt_hex}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash or not stored_hash.startswith("scrypt$"):
        return False
    parts = stored_hash.split("$")
    if len(parts) != 3:
        return False
    _, salt_hex, expected_hex = parts
    if not salt_hex or not expected_hex:
        return False
    try:
        expected_bytes = bytes.fromhex(expected_hex)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt_hex.encode("utf-8"),
            n=16384,
            r=8,
            p=1,
            dklen=len(expected_bytes),
        )
        return hmac.compare_digest(expected_bytes, derived)
    except Exception:
        return False


def generate_session_token() -> tuple[str, str]:
    """Returns `(raw_cookie_or_bearer_token, sha256_session_id_stored_in_db)`."""
    raw_token = secrets.token_urlsafe(32)
    return raw_token, sha256_hex(raw_token)


def sanitize_audit_dict(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    cleaned: dict[str, Any] = {}
    for k, v in payload.items():
        if k.lower() in REDACT_KEYS:
            cleaned[k] = "[REDACTED]"
        elif isinstance(v, dict):
            cleaned[k] = sanitize_audit_dict(v)
        else:
            cleaned[k] = v
    return cleaned


def record_audit_log(
    session: Session,
    *,
    actor_id: uuid.UUID | None,
    action: str,
    resource_type: str | None = None,
    resource_id: str | uuid.UUID | None = None,
    outcome: str = "success",
    before_state: dict[str, Any] | None = None,
    after_state: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> AuditLog:
    meta = dict(sanitize_audit_dict(metadata) or {})
    if request_id:
        meta["request_id"] = request_id

    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        outcome=outcome if outcome in ("success", "failure", "denied") else "success",
        before_state=sanitize_audit_dict(before_state),
        after_state=sanitize_audit_dict(after_state),
        metadata_json=meta,
    )
    session.add(entry)
    return entry


class SlidingWindowRateLimiter:
    """Thread-safe sliding window rate limiter for sensitive API endpoints."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: dict[str, list[float]] = {}

    def check_and_record(self, bucket_key: str, max_attempts: int, window_seconds: int) -> None:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            timestamps = [t for t in self._buckets.get(bucket_key, []) if t > cutoff]
            if len(timestamps) >= max_attempts:
                self._buckets[bucket_key] = timestamps
                raise RateLimitError(
                    "Rate limit exceeded for this operation; please wait before retrying",
                    details={"window_seconds": window_seconds, "max_attempts": max_attempts},
                )
            timestamps.append(now)
            self._buckets[bucket_key] = timestamps

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


rate_limiter = SlidingWindowRateLimiter()


@dataclass
class IdempotencyRecord:
    scope_key: str
    payload_hash: str
    status_code: int
    response_body: dict[str, Any]
    created_at: float


class IdempotencyRegistry:
    """
    Thread-safe idempotency key registry with payload fingerprint verification (Section 13).
    - Legitimate retry with identical payload -> returns stored response.
    - Conflicting reuse of the same Idempotency-Key with different payload -> raises 409 ConflictError.
    """

    def __init__(self, ttl_seconds: int = 86400) -> None:
        self._lock = threading.Lock()
        self._records: dict[str, IdempotencyRecord] = {}
        self._ttl_seconds = ttl_seconds

    @staticmethod
    def compute_payload_hash(payload: Any) -> str:
        serialized = json.dumps(payload, sort_keys=True, default=str)
        return sha256_hex(serialized)

    def get_or_verify(self, actor_scope: str, operation: str, key: str | None, payload: Any) -> dict[str, Any] | None:
        if not key or not key.strip():
            return None
        clean_key = key.strip()[:128]
        scope_key = f"{actor_scope}:{operation}:{clean_key}"
        payload_hash = self.compute_payload_hash(payload)
        now = time.monotonic()

        with self._lock:
            existing = self._records.get(scope_key)
            if existing is not None:
                if now - existing.created_at > self._ttl_seconds:
                    del self._records[scope_key]
                    return None
                if existing.payload_hash != payload_hash:
                    raise ConflictError(
                        "Idempotency-Key has already been used with a different request payload",
                        code="IDEMPOTENCY_KEY_CONFLICT",
                        details={"idempotency_key": clean_key, "operation": operation},
                    )
                return existing.response_body
        return None

    def store(
        self,
        actor_scope: str,
        operation: str,
        key: str | None,
        payload: Any,
        response_body: dict[str, Any],
        status_code: int = 200,
    ) -> None:
        if not key or not key.strip():
            return
        clean_key = key.strip()[:128]
        scope_key = f"{actor_scope}:{operation}:{clean_key}"
        payload_hash = self.compute_payload_hash(payload)
        with self._lock:
            self._records[scope_key] = IdempotencyRecord(
                scope_key=scope_key,
                payload_hash=payload_hash,
                status_code=status_code,
                response_body=response_body,
                created_at=time.monotonic(),
            )


idempotency_registry = IdempotencyRegistry()


def extract_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return "127.0.0.1"


def check_db_auth_rate_limit(
    session: Session,
    *,
    action: str,
    ip_hash: str,
    max_attempts: int = 15,
    window_minutes: int = 5,
) -> None:
    """
    Shared database-backed authentication rate limiter (MP-17 SEC-07).
    Ensures brute-force protection holds even when multiple backend worker instances are deployed.
    """
    from sqlalchemy import func, select

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    recent_count = int(
        session.execute(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.action == action,
                AuditLog.created_at >= cutoff,
                AuditLog.metadata_json["ip_hash"].astext == ip_hash,
            )
        ).scalar_one()
        or 0
    )
    if recent_count >= max_attempts:
        raise RateLimitError(
            "Too many failed authentication attempts from this network; please wait before retrying",
            details={"window_minutes": window_minutes, "max_attempts": max_attempts},
        )
