# MP-15 · Pagination, Filtering, Searching & Sorting (`docs/api/pagination-filtering.md`)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-15

---

## 1. Standard Query Parameters (`PaginationParams`)

All collection endpoints (`GET /api/v1/users`, `/api/v1/clients`, `/api/v1/quotations`, `/api/v1/invoices`, `/api/v1/payments`, `/api/v1/receipts`, `/api/v1/reconciliation/batches`, `/api/v1/audit/logs`) share the reusable `PaginationParams` dependency:

| Parameter | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `page` | `int` | `1` | `1 <= page <= 10000` | 1-indexed page number. |
| `page_size` | `int` | `20` | `1 <= page_size <= 100` | Maximum items returned per page. |
| `sort_by` | `str` | `"created_at"` | Whitelisted per resource | Column name to order by; unapproved sort fields return `400 INVALID_SORT_FIELD`. |
| `sort_order` | `"asc" \| "desc"` | `"desc"` | Enum literal | Sort direction. |

---

## 2. Approved Sort Fields & Resource Filters

| Endpoint | Whitelisted `sort_by` Fields | Supported Filter Parameters |
|---|---|---|
| `GET /api/v1/users` | `created_at`, `email`, `full_name` | `search`, `active` |
| `GET /api/v1/clients` | `created_at`, `updated_at`, `name`, `status` | `search` (name, phone, email, client_code, tax_pin), `status_filter`, `client_type`, `category_id` |
| `GET /api/v1/quotations` | `created_at`, `issue_date`, `total`, `status` | `search`, `status_filter`, `client_id`, `from_date`, `to_date` |
| `GET /api/v1/invoices` | `created_at`, `issue_date`, `due_date`, `total`, `balance_due`, `status` | `search`, `status`, `client_id`, `from_date`, `to_date` |
| `GET /api/v1/payments` | `created_at`, `payment_date`, `amount`, `status` | `search`, `status`, `payment_method`, `client_id`, `min_amount`, `max_amount` |
| `GET /api/v1/receipts` | `created_at`, `finalized_at`, `total`, `status` | `search`, `status`, `client_id` / `client` |
| `GET /api/v1/reconciliation/batches` | `created_at`, `status` | `status_filter` |
| `GET /api/v1/audit/logs` | `created_at`, `id`, `action` | `action`, `resource_type`, `resource_id`, `actor_id`, `outcome` |

All filtering, sorting, and counting (`SELECT count(*)`) execute directly inside PostgreSQL via indexed SQLAlchemy 2.x queries (`paginate_select`), never loading full tables into application memory.
