# IBMS Financial Transaction & Document Security (`MP-17`)

## 1. Authoritative Server-Side Money Math

- **Zero Trust in Browser Totals**: The frontend (`src/lib/utils/money.ts`) computes integer-cent line previews strictly for UI display. All persisted line totals, tax breakdowns, discounts, and document totals are computed transactionally on the server (`compute_authoritative_document_totals` in `fastapi_service/services/financial_service.py` and `saveReceiptDraft`/`finalizeReceipt` in `src/lib/server/services.ts`).
- **Exact Decimal Arithmetic**: Every financial column in PostgreSQL uses `NUMERIC(15, 2)` (quantities `NUMERIC(12, 3)`, tax rates `NUMERIC(6, 4)`), and Python calculations use `decimal.Decimal` with `ROUND_HALF_UP`.

## 2. Concurrency, Row Locking & Idempotency

- **Transactional Row Locks (`SELECT ... FOR UPDATE`)**:
  - `allocate_document_number()`: Locks the row in `public.numbering_sequences` (`FOR UPDATE`) and synchronizes with `public.receipt_sequences` to guarantee gap-free, collision-free document numbers (`QTN-*`, `INV-*`, `PAY-*`, `RCP-*`).
  - `allocate_payment_to_invoices()`: Locks both the `Payment` row and target `Invoice` rows (`with_for_update()`) inside a single database transaction, preventing race-condition double allocation.
  - `generate_receipt_for_payment()`: Locks the `Payment` row (`with_for_update()`) and checks for existing active receipts before issuing a new receipt.
- **Idempotency Keys (`Idempotency-Key` Header)**:
  - Supported on `POST /api/v1/payments`, `POST /api/v1/payments/{id}/allocate`, and `POST /api/v1/payments/{id}/generate-receipt`.
  - Replaying the same `Idempotency-Key` with an identical payload returns the cached response without duplicating financial transactions; replaying the same key with a different payload raises `409 IDEMPOTENCY_CONFLICT`.

## 3. Immutability, Cancellations, Refunds & Reversals

- **Issued Document Immutability**: Once an invoice (`status = 'issued' | 'partially_paid' | 'paid'`) or receipt (`status = 'finalized'`) is issued, its line items, totals, and `company_snapshot` cannot be edited (`409 Conflict` + DB trigger `trg_protect_immutable_financial_docs`).
- **Privileged Reversals & Mandatory Reasons**:
  - Voiding a receipt (`POST /api/v1/receipts/{id}/cancel`) requires `receipts:cancel` (`admin` only) and a mandatory audit reason (`min_length=3`).
  - Refunding (`POST /api/v1/payments/{id}/refund`) or reversing (`POST /api/v1/payments/{id}/reverse`) a confirmed payment requires `payments:refund` / `payments:reverse` (`admin` or `finance`), automatically reverses active invoice allocations, recalculates invoice `amount_paid` and `balance_due`, voids linked receipts, and writes an immutable record to `public.audit_logs`.
- **Reprint Tracking & Duplicate Watermarking**: Every PDF download (`GET /api/receipts/[id]/pdf`) and browser print (`/receipts/[id]/print`, `POST /api/v1/receipts/{id}/print`) increments `print_count`, logs a row in `public.receipt_print_logs`, and marks copies where `print_count > 1` with a prominent `DUPLICATE COPY` banner.
