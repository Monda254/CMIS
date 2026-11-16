import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentStatusBadge, PaymentStatusBadge, StatusBadge } from "@/components/status-badge";
import { computeLinePreview, generateIdempotencyKey } from "@/lib/api/client";
import { normalizeApiError } from "@/lib/api/errors";
import { money, previewLineTotal, sanitizeSpreadsheetCell } from "@/lib/format";
import { hasPermission, isAdminUser } from "@/lib/permissions";
import { generateReceiptPdf } from "@/lib/server/pdf";
import { encodeQrMatrix } from "@/lib/server/qr-matrix";

describe("MP-16 · Frontend Utilities, Financial Previews, Permissions, Components & PDF Suite", () => {
  // 27.1 Unit Tests
  it("computes preview line totals accurately without float drift", () => {
    expect(previewLineTotal("3", "10833.67")).toBe(32501.01);
    expect(money(32501, "KES")).toContain("KES");
    expect(money("100000.00", "KES")).toContain("100,000.00");
  });

  it("computes integer-cents line previews for tax-exclusive, tax-inclusive, and discounted items", () => {
    const exclusive = computeLinePreview({
      quantity: "2",
      unitPrice: "25000.00",
      discountAmount: "5000.00",
      taxRate: "16.0000",
      isInclusive: false,
    });
    expect(exclusive.gross).toBe("50000.00");
    expect(exclusive.subtotal).toBe("45000.00");
    expect(exclusive.taxAmount).toBe("7200.00");
    expect(exclusive.lineTotal).toBe("52200.00");

    const inclusive = computeLinePreview({
      quantity: "1",
      unitPrice: "11600.00",
      discountAmount: "0.00",
      taxRate: "16.0000",
      isInclusive: true,
    });
    expect(inclusive.subtotal).toBe("10000.00");
    expect(inclusive.taxAmount).toBe("1600.00");
    expect(inclusive.lineTotal).toBe("11600.00");
  });

  it("neutralizes spreadsheet formula injection in CSV/Excel cell values", () => {
    expect(sanitizeSpreadsheetCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeSpreadsheetCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(sanitizeSpreadsheetCell("-100+200")).toBe("'-100+200");
    expect(sanitizeSpreadsheetCell("@IMPORTXML()")).toBe("'@IMPORTXML()");
    expect(sanitizeSpreadsheetCell("Normal Company Ltd")).toBe("Normal Company Ltd");
  });

  it("evaluates role and granular permission helpers accurately", () => {
    const admin = { id: "1", role: "admin", active: true };
    const cashier = { id: "2", role: "cashier", active: true };
    const accountant = { id: "3", role: "accountant", active: true };
    const deactivated = { id: "4", role: "admin", active: false };

    expect(isAdminUser(admin)).toBe(true);
    expect(isAdminUser(cashier)).toBe(false);
    expect(isAdminUser(deactivated)).toBe(false);

    expect(hasPermission(admin, "reports:read")).toBe(true);
    expect(hasPermission(cashier, "invoices:issue")).toBe(true);
    expect(hasPermission(cashier, "reports:read")).toBe(false);
    expect(hasPermission(accountant, "reconciliation:confirm")).toBe(true);
    expect(hasPermission(deactivated, "clients:read")).toBe(false);
  });

  it("normalizes MP-15 API error envelopes and exposes semantic status flags", () => {
    const conflictErr = normalizeApiError(409, {
      error: {
        code: "INVOICE_OVER_ALLOCATION",
        message: "Allocation exceeds invoice balance",
        details: { max_allowed: "60000.00" },
      },
      request_id: "req-abc12345",
    });

    expect(conflictErr.status).toBe(409);
    expect(conflictErr.code).toBe("INVOICE_OVER_ALLOCATION");
    expect(conflictErr.message).toBe("Allocation exceeds invoice balance");
    expect(conflictErr.requestId).toBe("req-abc12345");
    expect(conflictErr.isConflict).toBe(true);
    expect(conflictErr.isUnauthorized).toBe(false);

    const unauthErr = normalizeApiError(401, null);
    expect(unauthErr.isUnauthorized).toBe(true);
    expect(unauthErr.code).toBe("UNAUTHENTICATED");
  });

  it("generates unique idempotency keys with custom prefixes", () => {
    const k1 = generateIdempotencyKey("pay-confirm");
    const k2 = generateIdempotencyKey("pay-confirm");
    expect(k1.startsWith("pay-confirm-")).toBe(true);
    expect(k1).not.toBe(k2);
  });

  // 27.2 Component Tests
  it("renders accessible DocumentStatusBadge, PaymentStatusBadge, and StatusBadge across lifecycle states", () => {
    render(
      <div>
        <DocumentStatusBadge status="partially_paid" />
        <DocumentStatusBadge status="converted" />
        <DocumentStatusBadge status="pending" />
        <DocumentStatusBadge status="suggested" />
        <PaymentStatusBadge status="half_paid" full />
        <StatusBadge status="finalized" />
      </div>,
    );

    expect(screen.getByText("Partially Paid")).toBeInTheDocument();
    expect(screen.getByText("Converted to Invoice")).toBeInTheDocument();
    expect(screen.getByText("Pending Confirmation")).toBeInTheDocument();
    expect(screen.getByText("Suggested Match")).toBeInTheDocument();
    expect(screen.getByText("Half Paid · Partial")).toBeInTheDocument();
    expect(screen.getByText("Issued")).toBeInTheDocument();
  });

  // 27.3 Integration / Document Rendering Tests
  it("encodes verification URLs into a valid square QR matrix with finder patterns", () => {
    const matrix = encodeQrMatrix("https://ledgerly.example.com/verify/ABCDEF2345");
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0]?.length).toBe(matrix.length);
    expect(matrix[0]?.[0]).toBe(true);
    expect(matrix[6]?.[6]).toBe(true);
  });

  it("generates a valid server-side A4 PDF with embedded receipt details and QR code", () => {
    const pdf = generateReceiptPdf({
      receipt: {
        id: "00000000-0000-0000-0000-000000000001",
        status: "finalized",
        receipt_number: "RCP-2026-000001",
        verification_code: "ABCDEF2345",
        customer_name: "Acme Corporation",
        customer_phone: "+254700000000",
        customer_address: "Nairobi, Kenya",
        notes: "Thank you for your business.",
        currency: "KES",
        total: "32501.00",
        finalized_at: "2026-11-10T12:00:00.000Z",
        issued_by_name: "Jane Admin",
        print_count: 2,
        company_snapshot: {
          name: "Ledgerly Demo Ltd",
          address: "Westlands, Nairobi",
          phone: "+254711111111",
          email: "billing@ledgerly.example.com",
          footer: "Official Receipt",
        },
      },
      items: [
        {
          description: "Annual Software Subscription",
          quantity: 1,
          unit_price: "32501.00",
          line_total: "32501.00",
        },
      ],
      copyNumber: 2,
      origin: "https://ledgerly.example.com",
    });

    const text = pdf.toString("utf8");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("RCP-2026-000001");
    expect(text).toContain("DUPLICATE COPY - COPY #2 - NOT AN ORIGINAL");
    expect(text).toContain("Acme Corporation");
    expect(text.trim().endsWith("%%EOF")).toBe(true);
  });
});
