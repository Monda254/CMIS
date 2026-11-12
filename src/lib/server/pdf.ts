import { encodeQrMatrix } from "./qr-matrix";
import { money, dateTime } from "@/lib/format";

export type PdfReceiptData = {
  receipt: {
    id: string;
    status: "draft" | "finalized" | "cancelled";
    payment_status?: string;
    amount_paid?: string | number;
    balance_due?: string | number;
    payment_method?: string;
    receipt_number: string | null;
    verification_code: string | null;
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    notes: string;
    currency: string;
    total: string | number;
    finalized_at: string | null;
    issued_by_name: string | null;
    print_count: number;
    company_snapshot: {
      name?: string;
      address?: string;
      phone?: string;
      email?: string;
      footer?: string;
    } | null;
  };
  items: {
    description: string;
    quantity: string | number;
    unit_price: string | number;
    line_total: string | number;
  }[];
  copyNumber: number;
  origin: string;
};

function escapePdfText(input: string): string {
  // Replace non-WinAnsi characters (like em-dash) with safe ASCII/Latin-1 equivalents
  return input
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/•/g, "|")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!;
      if ((current + " " + w).length <= maxChars) {
        current += " " + w;
      } else {
        lines.push(current);
        current = w;
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Generates an authoritative A4 PDF receipt binary buffer on the server,
 * complete with company snapshot, duplicate/cancelled banner, itemized lines,
 * and an embedded vector QR code for public verification.
 */
export function generateReceiptPdf(data: PdfReceiptData): Buffer {
  const { receipt: r, items, copyNumber, origin } = data;
  const snap = r.company_snapshot ?? {};
  const pageWidth = 595.28; // A4 width in pt
  const pageHeight = 841.89; // A4 height in pt
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;

  const ops: string[] = [];
  let y = pageHeight - margin;

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    opts?: { font?: "F1" | "F2" | "F3"; size?: number; color?: [number, number, number]; align?: "left" | "right" | "center" },
  ) => {
    const font = opts?.font ?? "F1";
    const size = opts?.size ?? 10;
    const [cr, cg, cb] = opts?.color ?? [0.08, 0.14, 0.11];
    const safe = escapePdfText(text);
    const charWidthFactor = font === "F3" ? 0.6 : font === "F2" ? 0.54 : 0.5;
    const approxWidth = safe.length * size * charWidthFactor;
    let finalX = x;
    if (opts?.align === "right") finalX = x - approxWidth;
    if (opts?.align === "center") finalX = x - approxWidth / 2;

    ops.push(
      `BT /${font} ${size} Tf ${cr.toFixed(3)} ${cg.toFixed(3)} ${cb.toFixed(3)} rg 1 0 0 1 ${finalX.toFixed(2)} ${yPos.toFixed(2)} Tm (${safe}) Tj ET`,
    );
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number, width = 0.75, color: [number, number, number] = [0.85, 0.85, 0.82]) => {
    ops.push(
      `${width.toFixed(2)} w ${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    );
  };

  const drawRect = (x: number, yPos: number, w: number, h: number, strokeColor?: [number, number, number], fillColor?: [number, number, number]) => {
    if (fillColor && strokeColor) {
      ops.push(
        `${fillColor[0].toFixed(3)} ${fillColor[1].toFixed(3)} ${fillColor[2].toFixed(3)} rg ${strokeColor[0].toFixed(3)} ${strokeColor[1].toFixed(3)} ${strokeColor[2].toFixed(3)} RG 1 w ${x.toFixed(2)} ${yPos.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`,
      );
    } else if (fillColor) {
      ops.push(
        `${fillColor[0].toFixed(3)} ${fillColor[1].toFixed(3)} ${fillColor[2].toFixed(3)} rg ${x.toFixed(2)} ${yPos.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`,
      );
    } else if (strokeColor) {
      ops.push(
        `${strokeColor[0].toFixed(3)} ${strokeColor[1].toFixed(3)} ${strokeColor[2].toFixed(3)} RG 1 w ${x.toFixed(2)} ${yPos.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`,
      );
    }
  };

  // Duplicate copy banner
  if (copyNumber > 1) {
    drawRect(margin, y - 24, contentWidth, 24, [0.75, 0.18, 0.15], [0.99, 0.95, 0.95]);
    drawText(
      `DUPLICATE COPY - COPY #${copyNumber} - NOT AN ORIGINAL`,
      pageWidth / 2,
      y - 16,
      { font: "F2", size: 10, color: [0.75, 0.18, 0.15], align: "center" },
    );
    y -= 36;
  }

  // Cancelled banner
  if (r.status === "cancelled") {
    drawRect(margin, y - 24, contentWidth, 24, [0.75, 0.18, 0.15], [0.99, 0.92, 0.92]);
    drawText(
      "CANCELLED - THIS RECEIPT IS NOT VALID",
      pageWidth / 2,
      y - 16,
      { font: "F2", size: 10, color: [0.75, 0.18, 0.15], align: "center" },
    );
    y -= 36;
  }

  // Company Header (Left) & Receipt Number (Right)
  drawText(snap.name || "Ledgerly Receipt", margin, y - 14, { font: "F2", size: 18, color: [0.07, 0.22, 0.17] });
  drawText("RECEIPT", pageWidth - margin, y - 12, { font: "F2", size: 14, color: [0.07, 0.22, 0.17], align: "right" });

  let leftY = y - 30;
  if (snap.address) {
    drawText(snap.address, margin, leftY, { size: 9, color: [0.35, 0.4, 0.38] });
    leftY -= 13;
  }
  const contactLine = [snap.phone, snap.email].filter(Boolean).join(" | ");
  if (contactLine) {
    drawText(contactLine, margin, leftY, { size: 9, color: [0.35, 0.4, 0.38] });
    leftY -= 13;
  }

  drawText(r.receipt_number ?? "DRAFT", pageWidth - margin, y - 28, { font: "F3", size: 10, align: "right" });
  drawText(dateTime(r.finalized_at), pageWidth - margin, y - 42, { size: 9, color: [0.35, 0.4, 0.38], align: "right" });

  y = Math.min(leftY, y - 54) - 12;

  // Customer info box
  const boxLines: [string, string][] = [["Customer:", r.customer_name]];
  if (r.customer_phone) boxLines.push(["Phone:", r.customer_phone]);
  if (r.customer_address) boxLines.push(["Address:", r.customer_address]);
  boxLines.push(["Payment:", `${(r.payment_status || "paid").toUpperCase().replace("_", " ")} (${r.payment_method || "M-Pesa"})`]);
  boxLines.push(["Issued by:", r.issued_by_name ?? "-"]);

  const boxHeight = boxLines.length * 15 + 16;
  drawRect(margin, y - boxHeight, contentWidth, boxHeight, [0.85, 0.85, 0.82], [0.985, 0.982, 0.975]);
  let custY = y - 18;
  for (const [label, val] of boxLines) {
    drawText(label, margin + 12, custY, { font: "F2", size: 9, color: [0.35, 0.4, 0.38] });
    drawText(val, margin + 72, custY, { font: "F1", size: 9 });
    custY -= 15;
  }
  y -= boxHeight + 22;

  // Items Table Header
  const colQtyX = pageWidth - margin - 190;
  const colPriceX = pageWidth - margin - 100;
  const colTotalX = pageWidth - margin;

  drawText("Description", margin, y, { font: "F2", size: 9.5 });
  drawText("Qty", colQtyX, y, { font: "F2", size: 9.5, align: "right" });
  drawText("Unit price", colPriceX, y, { font: "F2", size: 9.5, align: "right" });
  drawText("Total", colTotalX, y, { font: "F2", size: 9.5, align: "right" });
  y -= 8;
  drawLine(margin, y, pageWidth - margin, y, 1, [0.2, 0.25, 0.22]);
  y -= 16;

  // Items Rows
  for (const it of items.slice(0, 28)) {
    const descLines = wrapText(it.description, 52);
    drawText(descLines[0] ?? "", margin, y, { size: 9.5 });
    drawText(String(Number(it.quantity)), colQtyX, y, { font: "F3", size: 9.5, align: "right" });
    drawText(money(it.unit_price, r.currency), colPriceX, y, { font: "F3", size: 9.5, align: "right" });
    drawText(money(it.line_total, r.currency), colTotalX, y, { font: "F3", size: 9.5, align: "right" });

    for (let idx = 1; idx < descLines.length; idx++) {
      y -= 12;
      drawText(descLines[idx]!, margin, y, { size: 9.5 });
    }
    y -= 8;
    drawLine(margin, y, pageWidth - margin, y, 0.5, [0.9, 0.9, 0.88]);
    y -= 15;
  }

  // Total / Paid / Balance Footer
  y -= 2;
  drawText("Total Amount", colPriceX - 20, y, { font: "F2", size: 10.5, align: "right" });
  drawText(money(r.total, r.currency), colTotalX, y, { font: "F2", size: 11, color: [0.07, 0.22, 0.17], align: "right" });
  y -= 16;

  const paidAmt = r.amount_paid !== undefined ? r.amount_paid : r.total;
  const dueAmt = r.balance_due !== undefined ? r.balance_due : 0;
  drawText("Amount Paid", colPriceX - 20, y, { font: "F2", size: 10, color: [0.09, 0.47, 0.31], align: "right" });
  drawText(money(paidAmt, r.currency), colTotalX, y, { font: "F2", size: 10.5, color: [0.09, 0.47, 0.31], align: "right" });
  y -= 16;

  if (Number(dueAmt) > 0) {
    drawText("Balance Due", colPriceX - 20, y, { font: "F2", size: 10, color: [0.7, 0.2, 0.23], align: "right" });
    drawText(money(dueAmt, r.currency), colTotalX, y, { font: "F2", size: 10.5, color: [0.7, 0.2, 0.23], align: "right" });
    y -= 16;
  }
  y -= 10;

  // Notes
  if (r.notes) {
    drawText("Notes", margin, y, { font: "F2", size: 9.5 });
    y -= 14;
    for (const line of wrapText(r.notes, 85).slice(0, 5)) {
      drawText(line, margin, y, { size: 9, color: [0.35, 0.4, 0.38] });
      y -= 12;
    }
    y -= 10;
  }

  // Bottom Signature & QR Verification block
  const bottomY = Math.max(85, y - 110);

  // Authorized signature line (Left)
  drawLine(margin, bottomY + 24, margin + 150, bottomY + 24, 0.75, [0.5, 0.5, 0.5]);
  drawText("Authorized signature", margin + 75, bottomY + 12, { size: 8.5, color: [0.4, 0.45, 0.42], align: "center" });

  // QR Code (Center)
  const verifyUrl = `${origin}/verify/${r.verification_code ?? ""}`;
  const matrix = encodeQrMatrix(verifyUrl);
  const qrSize = 76;
  const cell = qrSize / matrix.length;
  const qrX = pageWidth / 2 - qrSize / 2;
  const qrTopY = bottomY + 28 + qrSize;

  ops.push("0.071 0.149 0.118 rg");
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix.length; col++) {
      if (matrix[row]![col]) {
        const rx = qrX + col * cell;
        const ry = qrTopY - (row + 1) * cell;
        ops.push(`${rx.toFixed(2)} ${ry.toFixed(2)} ${(cell + 0.15).toFixed(2)} ${(cell + 0.15).toFixed(2)} re f`);
      }
    }
  }

  drawText(r.verification_code ?? "", pageWidth / 2, bottomY + 15, { font: "F3", size: 8.5, align: "center" });
  drawText("Scan to verify this receipt", pageWidth / 2, bottomY + 4, {
    size: 8,
    color: [0.4, 0.45, 0.42],
    align: "center",
  });

  // Official Stamp placeholder / label (Right)
  drawLine(pageWidth - margin - 150, bottomY + 24, pageWidth - margin, bottomY + 24, 0.75, [0.5, 0.5, 0.5]);
  drawText("Official stamp", pageWidth - margin - 75, bottomY + 12, { size: 8.5, color: [0.4, 0.45, 0.42], align: "center" });

  // Footer note
  if (snap.footer) {
    drawLine(margin, 52, pageWidth - margin, 52, 0.5, [0.85, 0.85, 0.82]);
    drawText(snap.footer.slice(0, 110), pageWidth / 2, 38, { size: 8.5, color: [0.4, 0.45, 0.42], align: "center" });
  }

  const streamContent = ops.join("\n");
  const streamBytes = Buffer.byteLength(streamContent, "utf8");

  // Assemble valid PDF-1.4 document with cross-reference table
  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
    `6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`,
    `7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]!).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}
