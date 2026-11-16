# MP-15 · OpenAPI Usage & Frontend TypeScript Integration Guide (`docs/api/openapi-usage.md`)

**Project:** Integrated Business Management System (IBMS)  
**Prompt ID:** MP-15

---

## 1. Interactive OpenAPI / Swagger Documentation

When the FastAPI server is running (`http://localhost:8000`), interactive OpenAPI 3.1 documentation is automatically served at:
- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`
- **Raw OpenAPI 3.1 JSON Spec:** `http://localhost:8000/openapi.json`

All endpoints are organized under 14 module tags (`Authentication`, `Users & RBAC`, `Company Settings & Files`, `CRM & Clients`, `Quotations`, `Invoices & Receivables`, `Payments & Allocations`, `Receipts`, `Public Verification`, `Communications`, `Reconciliation`, `Tax Configuration`, `Dashboard & Financial Reports`, and `Audit Logs`).

---

## 2. Next.js / TypeScript Frontend Integration Contract (Section 17)

```typescript
export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface ApiResponse<T> {
  data: T;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
  message: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
  message: string;
  request_id: string;
}
```

### Frontend Integration Rules
1. **Never Compute Authoritative Money Math in the Browser**: The browser may show live line previews, but `POST /api/v1/quotations`, `POST /api/v1/invoices`, and `POST /api/v1/receipts` always compute authoritative `subtotal`, `discount_total`, `tax_total`, `total`, and `balance_due` on the server using Python `Decimal`.
2. **Send Monetary Amounts as Strings**: Always serialize monetary inputs as strings (e.g., `"40000.00"`) rather than JavaScript `number` floats.
3. **Pass `Idempotency-Key` on Financial Mutations**: Generate a UUID v4 per form submission attempt and pass it in the `Idempotency-Key` request header when confirming payments, allocating payments, issuing invoices, or generating receipts.
