import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/auth";
import { getReceiptDetail, recordPrint } from "@/lib/server/services";
import { generateReceiptPdf } from "@/lib/server/pdf";
import { handleApiError } from "@/lib/server/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireActiveStaff();
    const { id } = await params;
    const detail = await getReceiptDetail(id);
    if (!detail) {
      return NextResponse.json({ message: "Receipt not found" }, { status: 404 });
    }
    if (detail.receipt.status === "draft") {
      return NextResponse.json({ message: "Draft receipts cannot be downloaded as PDF" }, { status: 400 });
    }

    const copyNumber = await recordPrint(user, id);
    const url = new URL(request.url);
    const origin = url.origin;

    const pdfBuffer = generateReceiptPdf({
      receipt: detail.receipt,
      items: detail.items,
      copyNumber,
      origin,
    });

    const filename = `${detail.receipt.receipt_number ?? `receipt-${id}`}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Receipt-Copy": String(copyNumber),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
