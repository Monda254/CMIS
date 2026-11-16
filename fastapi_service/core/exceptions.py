"""
Domain & HTTP Exception Hierarchy and Standardized Error Response Handlers (Section 8).

Standard Error Envelope:
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found",
    "details": {}
  },
  "request_id": "req-..."
}
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, InternalError, ProgrammingError

logger = logging.getLogger("ibms.api")


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


class BadRequestError(AppError):
    def __init__(self, message: str, details: dict[str, Any] | None = None, code: str = "BAD_REQUEST") -> None:
        super().__init__(400, code, message, details)


class AuthenticationError(AppError):
    def __init__(
        self, message: str = "Authentication required", details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(401, "UNAUTHENTICATED", message, details)


class AuthorizationError(AppError):
    def __init__(
        self,
        message: str = "You do not have permission to perform this operation",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(403, "FORBIDDEN", message, details)


class NotFoundError(AppError):
    def __init__(
        self, resource: str = "Resource", details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(404, "RESOURCE_NOT_FOUND", f"{resource} was not found", details)


class ConflictError(AppError):
    def __init__(
        self,
        message: str,
        details: dict[str, Any] | None = None,
        code: str = "STATE_CONFLICT",
    ) -> None:
        super().__init__(409, code, message, details)


class ValidationAppError(AppError):
    def __init__(
        self, message: str, details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(422, "VALIDATION_ERROR", message, details)


class RateLimitError(AppError):
    def __init__(
        self,
        message: str = "Too many requests; please try again later",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(429, "RATE_LIMIT_EXCEEDED", message, details)


def get_request_id(request: Request) -> str:
    req_id = getattr(request.state, "request_id", None)
    if not req_id:
        req_id = request.headers.get("x-request-id") or f"req-{uuid.uuid4().hex[:12]}"
    return str(req_id)


def build_error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    req_id = get_request_id(request)
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
            },
            "message": message,
            "request_id": req_id,
        },
        headers={"X-Request-ID": req_id},
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return build_error_response(
            request=request,
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            details=exc.details,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        sanitized_errors = []
        for err in exc.errors():
            loc = ".".join(str(part) for part in err.get("loc", []) if part != "body")
            sanitized_errors.append(
                {
                    "field": loc or "payload",
                    "message": err.get("msg", "Invalid value"),
                    "type": err.get("type", "value_error"),
                }
            )
        return build_error_response(
            request=request,
            status_code=422,
            code="VALIDATION_FAILURE",
            message="Request validation failed",
            details={"fields": sanitized_errors},
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
        code_map = {
            400: "BAD_REQUEST",
            401: "UNAUTHENTICATED",
            403: "FORBIDDEN",
            404: "RESOURCE_NOT_FOUND",
            409: "STATE_CONFLICT",
            422: "VALIDATION_FAILURE",
            429: "RATE_LIMIT_EXCEEDED",
        }
        detail_msg = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return build_error_response(
            request=request,
            status_code=exc.status_code,
            code=code_map.get(exc.status_code, "HTTP_ERROR"),
            message=detail_msg,
            details={},
        )

    @app.exception_handler(IntegrityError)
    @app.exception_handler(InternalError)
    @app.exception_handler(ProgrammingError)
    async def handle_db_constraint_error(request: Request, exc: Exception) -> JSONResponse:
        raw_text = str(getattr(exc, "orig", exc))
        # Map known database trigger / uniqueness / check constraint errors cleanly without leaking SQL
        lower = raw_text.lower()
        if "over-allocation" in lower or "exceeds" in lower or "double-receipting" in lower:
            # Extract clean trigger message if raised by our PL/pgSQL functions
            first_line = raw_text.splitlines()[0].replace("ERROR:", "").strip()
            return build_error_response(
                request=request,
                status_code=409,
                code="FINANCIAL_INTEGRITY_VIOLATION",
                message=first_line or "Financial integrity constraint violated",
                details={"reason": "database_financial_guard"},
            )
        if "cannot allocate" in lower or "cannot acknowledge" in lower or "currency mismatch" in lower:
            first_line = raw_text.splitlines()[0].replace("ERROR:", "").strip()
            return build_error_response(
                request=request,
                status_code=409,
                code="INVALID_FINANCIAL_TRANSITION",
                message=first_line or "Operation not permitted for the current financial state",
                details={"reason": "database_state_guard"},
            )
        if "unique constraint" in lower or "duplicate key" in lower:
            return build_error_response(
                request=request,
                status_code=409,
                code="DUPLICATE_RECORD",
                message="A record with the same unique identifier already exists",
                details={},
            )
        if "check constraint" in lower:
            return build_error_response(
                request=request,
                status_code=400,
                code="CONSTRAINT_VIOLATION",
                message="The provided values violate database integrity constraints",
                details={},
            )
        logger.error("Database error on %s: %s", request.url.path, raw_text)
        return build_error_response(
            request=request,
            status_code=500,
            code="DATABASE_ERROR",
            message="A database operation failed",
            details={},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s: %s", request.url.path, exc)
        return build_error_response(
            request=request,
            status_code=500,
            code="INTERNAL_SERVER_ERROR",
            message="An unexpected internal server error occurred",
            details={},
        )
