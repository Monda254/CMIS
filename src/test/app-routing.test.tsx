import { describe, expect, it } from "vitest";
import { encodeQrMatrix } from "@/lib/server/qr-matrix";
import { generateReceiptPdf } from "@/lib/server/pdf";
import { money, previewLineTotal } from "@/lib/format";

describe("Ledgerly core utilities & server PDF generation", () => {
  it("computes preview line totals accurately without float drift", () => {
    expect(previewLineTotal("3", "10833.67")).toBe(32501.01);
    expect(money(32501, "KES")).toContain("KES");
  });

  it("encodes verification URLs into a valid square QR matrix with finder patterns", () => {
    const matrix = encodeQrMatrix("https://ledgerly.example.com/verify/ABCDEF2345");
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0]?.length).toBe(matrix.length);
    // Top-left finder pattern corner is always dark
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
