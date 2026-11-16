# MP-15 · Financial Workflows, Idempotency & Transaction Integrity (`docs/api/financial-workflows.md`)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-15

---

## 1. Strict Separation of Financial Concepts

The IBMS API enforces a strict separation between billing, cash collection, settlement allocation, and payment acknowledgment:

1. **Quotation (`quotes`)**: Non-posting commercial proposal. Converting an approved quotation (`POST /api/v1/quotations/{id}/convert-to-invoice`) creates a linked `Invoice` (`invoices.quote_id = quotes.id`) while preserving the original quotation (`status = 'converted'`).
2. **Invoice (`invoices`)**: Contractual accounts receivable obligation (`total`, `amount_allocated`, `balance_due`). Issuing an invoice (`POST /api/v1/invoices/{id}/issue`) atomically assigns a sequential number (`INV-YYYY-NNNNNN`) and captures `company_snapshot` and `client_snapshot`.
3. **Payment (`payments`)**: Record of funds remitted by a client. Creating a payment (`POST /api/v1/payments`) defaults to `status = 'pending'` unless `confirm_immediately = true` is explicitly passed by an authorized user.
4. **Payment Allocation (`payment_allocations`)**: Explicit application of a `confirmed` payment against one or more active invoices (`POST /api/v1/payments/{id}/allocate`). PostgreSQL trigger `trg_sync_payment_allocation` locks both rows (`FOR UPDATE`), prevents over-allocation, and updates `invoices.amount_allocated`, `invoices.balance_due`, and `invoices.status` (`partially_paid` or `paid`).
5. **Receipt (`receipts` + `payment_receipt_allocations`)**: Immutable proof-of-payment document (`POST /api/v1/receipts/from-payment`). Never generated for unconfirmed payments. PostgreSQL trigger `trg_sync_payment_receipt_allocation` prevents double-receipting of any payment amount.

---

## 2. Worked API Sequence (`KES 100,000` Invoice with `KES 40,000` and `KES 60,000` Partial Payments)

1. `POST /api/v1/invoices` → `POST /api/v1/invoices/{id}/issue` (`total = "100000.00"`, `balance_due = "100000.00"`, `status = "issued"`).
2. `POST /api/v1/payments` (`amount = "40000.00"`) → `POST /api/v1/payments/{p1_id}/confirm`.
3. `POST /api/v1/payments/{p1_id}/allocate` (`[{"invoice_id": id, "amount": "40000.00"}]`) → Invoice transitions to `status = "partially_paid"`, `amount_allocated = "40000.00"`, `balance_due = "60000.00"`.
4. `POST /api/v1/receipts/from-payment` (`{"payment_id": p1_id, "invoice_id": id}`) → Generates `Receipt 1` for `"40000.00"`.
5. `POST /api/v1/payments` (`amount = "60000.00"`, `confirm_immediately = true`) → `POST /api/v1/payments/{p2_id}/allocate` (`[{"invoice_id": id, "amount": "60000.00"}]`) → Invoice transitions to `status = "paid"`, `amount_allocated = "100000.00"`, `balance_due = "0.00"`.
6. `POST /api/v1/receipts/from-payment` (`{"payment_id": p2_id, "invoice_id": id}`) → Generates `Receipt 2` for `"60000.00"`.

---

## 3. Idempotency Protection (`Idempotency-Key`)

State-changing financial endpoints accept an optional `Idempotency-Key` HTTP header:
- `POST /api/v1/quotations/{id}/issue`
- `POST /api/v1/quotations/{id}/convert-to-invoice`
- `POST /api/v1/invoices` & `POST /api/v1/invoices/{id}/issue`
- `POST /api/v1/payments`, `POST /api/v1/payments/{id}/confirm`, `POST /api/v1/payments/{id}/allocate`, `POST /api/v1/payments/{id}/refund`
- `POST /api/v1/receipts/from-payment` & `POST /api/v1/receipts/{id}/finalize`
- `POST /api/v1/reconciliation/batches` & `POST /api/v1/reconciliation/matches/{id}/confirm`

If a client retries a request with the same `Idempotency-Key` and identical payload, the cached response is returned without re-executing the transaction. If the same `Idempotency-Key` is reused with a different payload, the API rejects it with `409 IDEMPOTENCY_KEY_CONFLICT`.
