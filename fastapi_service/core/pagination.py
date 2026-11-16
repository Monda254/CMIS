"""
Standardized API Response Contracts, Pagination Primitives & Authoritative Decimal Types (Sections 7, 8 & 11).
"""

from __future__ import annotations

import math
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Annotated, Any, Generic, Literal, TypeVar

from fastapi import Query
from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, BeforeValidator
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from fastapi_service.core.exceptions import BadRequestError

T = TypeVar("T")


def _validate_decimal_no_float(value: Any, max_scale: int, field_label: str) -> Decimal:
    if isinstance(value, float):
        raise ValueError(f"{field_label} must be provided as a string, integer, or Decimal (binary float is not allowed)")
    if isinstance(value, (int, str, Decimal)):
        try:
            d = Decimal(str(value))
        except InvalidOperation as exc:
            raise ValueError(f"Invalid decimal value for {field_label}") from exc
    else:
        raise ValueError(f"Unsupported type for {field_label}")

    if not d.is_finite():
        raise ValueError(f"{field_label} must be a finite decimal")

    sign, digits, exponent = d.as_tuple()
    scale = -exponent if isinstance(exponent, int) and exponent < 0 else 0
    if scale > max_scale:
        raise ValueError(f"{field_label} allows at most {max_scale} decimal places")
    return d


def validate_money_decimal(value: Any) -> Decimal:
    d = _validate_decimal_no_float(value, max_scale=2, field_label="Monetary amount")
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def validate_quantity_decimal(value: Any) -> Decimal:
    d = _validate_decimal_no_float(value, max_scale=3, field_label="Quantity")
    return d.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def validate_tax_rate_decimal(value: Any) -> Decimal:
    d = _validate_decimal_no_float(value, max_scale=4, field_label="Tax rate")
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


MoneyDecimal = Annotated[
    Decimal,
    BeforeValidator(validate_money_decimal),
    PlainSerializer(lambda v: f"{Decimal(v):.2f}", return_type=str),
]

QuantityDecimal = Annotated[
    Decimal,
    BeforeValidator(validate_quantity_decimal),
    PlainSerializer(lambda v: f"{Decimal(v):.3f}", return_type=str),
]

TaxRateDecimal = Annotated[
    Decimal,
    BeforeValidator(validate_tax_rate_decimal),
    PlainSerializer(lambda v: f"{Decimal(v):.4f}", return_type=str),
]


def _validate_email_address(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Email address must be a string")
    cleaned = value.strip().lower()
    if len(cleaned) < 5 or len(cleaned) > 150 or "@" not in cleaned:
        raise ValueError("Invalid email address format")
    local_part, _, domain_part = cleaned.partition("@")
    if not local_part or "." not in domain_part or domain_part.startswith(".") or domain_part.endswith("."):
        raise ValueError("Invalid email address domain")
    return cleaned


EmailAddress = Annotated[str, BeforeValidator(_validate_email_address)]


class PaginationMeta(BaseModel):
    page: int = Field(..., ge=1, description="Current 1-indexed page number")
    page_size: int = Field(..., ge=1, le=200, description="Number of items per page")
    total_items: int = Field(..., ge=0, description="Total matching records in the database")
    total_pages: int = Field(..., ge=0, description="Total number of pages")


class ApiResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(from_attributes=True)

    data: T
    message: str = "Operation completed successfully"


class PaginatedResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(from_attributes=True)

    data: list[T]
    pagination: PaginationMeta
    message: str = "Records retrieved successfully"


class PaginationParams:
    def __init__(
        self,
        page: int = Query(default=1, ge=1, le=10000, description="Page number (1-indexed)"),
        page_size: int = Query(default=20, ge=1, le=100, description="Records per page (max 100)"),
        sort_by: str = Query(default="created_at", max_length=50, description="Approved sort column"),
        sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort direction ('asc' or 'desc')"),
    ) -> None:
        self.page = page
        self.page_size = page_size
        self.sort_by = sort_by
        self.sort_order = sort_order

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def paginate_select(
    session: Session,
    stmt: Select[Any],
    pagination: PaginationParams,
    allowed_sort_columns: dict[str, Any],
) -> tuple[list[Any], PaginationMeta]:
    """
    Executes a database-side count and paginated select with strict sort-field whitelisting.
    """
    if pagination.sort_by not in allowed_sort_columns:
        allowed_list = ", ".join(sorted(allowed_sort_columns.keys()))
        raise BadRequestError(
            f"Unsupported sort_by field '{pagination.sort_by}'. Allowed fields: {allowed_list}",
            code="INVALID_SORT_FIELD",
        )

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total_items = int(session.execute(count_stmt).scalar_one() or 0)
    total_pages = math.ceil(total_items / pagination.page_size) if total_items > 0 else 0

    sort_col = allowed_sort_columns[pagination.sort_by]
    ordered_stmt = stmt.order_by(sort_col.asc() if pagination.sort_order == "asc" else sort_col.desc())
    paged_stmt = ordered_stmt.offset(pagination.offset).limit(pagination.page_size)
    rows = list(session.execute(paged_stmt).scalars().all())

    return rows, PaginationMeta(
        page=pagination.page,
        page_size=pagination.page_size,
        total_items=total_items,
        total_pages=total_pages,
    )
