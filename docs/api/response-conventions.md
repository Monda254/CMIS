# MP-15 · Standard API Response & Serialization Conventions (`docs/api/response-conventions.md`)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-15

---

## 1. Standard Response Envelopes

### 1.1 Single Resource / Action Response (`ApiResponse[T]`)
```json
{
  "data": {
    "id": "6f9d2b4e-8f1b-4c2a-9e3d-1a2b3c4d5e6f",
    "invoice_number": "INV-2026-000101",
    "status": "issued",
    "currency": "KES",
    "total": "100000.00",
    "amount_allocated": "40000.00",
    "balance_due": "60000.00"
  },
  "message": "Invoice retrieved successfully"
}
```

### 1.2 Paginated Collection Response (`PaginatedResponse[T]`)
```json
{
  "data": [
    {
      "id": "6f9d2b4e-8f1b-4c2a-9e3d-1a2b3c4d5e6f",
      "invoice_number": "INV-2026-000101",
      "status": "partially_paid",
      "total": "100000.00",
      "balance_due": "60000.00"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 1,
    "total_pages": 1
  },
  "message": "Invoices retrieved successfully"
}
```

---

## 2. Monetary, Quantity & Timestamp Serialization Rules

1. **Monetary Values (`MoneyDecimal`)**:
   - Accepted in requests as string (`"100000.00"`), integer (`100000`), or `Decimal` with at most `2` decimal places.
   - Binary floating-point numbers (`float`) are explicitly rejected (`422 VALIDATION_FAILURE`) to prevent IEEE 754 rounding errors.
   - Always serialized in JSON responses as fixed 2-decimal strings (`"100000.00"`).
2. **Quantities (`QuantityDecimal`) & Tax Rates (`TaxRateDecimal`)**:
   - Quantities allow up to `3` decimal places and serialize as `"1.000"`.
   - Tax rates allow up to `4` decimal places and serialize as `"16.0000"`.
3. **Dates & Timestamps**:
   - Event timestamps (`created_at`, `finalized_at`, `payment_date`, `confirmed_at`) are stored and serialized as timezone-aware ISO 8601 UTC strings (`"2026-11-16T06:30:00Z"`).
   - Calendar dates (`issue_date`, `due_date`, `expiry_date`) serialize as ISO 8601 dates (`"2026-11-16"`).
4. **Correlation Headers**:
   - Every response includes `X-Request-ID` and `X-Process-Time-Ms`.
