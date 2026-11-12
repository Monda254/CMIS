import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/auth";
import { finalizeReceipt, getReceiptsList, saveReceiptDraft, type DraftItemInput } from "@/lib/server/services";
import { fetchFromFastApi } from "@/lib/server/fastapi-client";
import { handleApiError } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireActiveStaff();
    const { searchParams } = new URL(request.url);
    const client = searchParams.get("client");
    const status = searchParams.get("status");
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;

    const qs = new URLSearchParams();
    if (client) qs.set("client", client);
    if (status) qs.set("status", status);
    if (limit) qs.set("limit", String(limit));

    const fastRows = await fetchFromFastApi<unknown[]>(
      `/api/v1/receipts${qs.toString() ? `?${qs.toString()}` : ""}`,
      user,
    );
    const rows = fastRows ?? (await getReceiptsList({ client, status, limit }));
    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveStaff();
    const body = (await request.json()) as {
      receiptId?: string | null;
      clientId?: string | null;
      customerName?: string;
      customerPhone?: string;
      customerAddress?: string;
      notes?: string;
      paymentStatus?: string;
      amountPaid?: number | string | null;
      paymentMethod?: string;
      items?: DraftItemInput[];
      issue?: boolean;
    };

    const id = await saveReceiptDraft(user, {
      receiptId: body.receiptId ?? null,
      clientId: body.clientId ?? null,
      customerName: body.customerName ?? "",
      customerPhone: body.customerPhone ?? "",
      customerAddress: body.customerAddress ?? "",
      notes: body.notes ?? "",
      paymentStatus: body.paymentStatus,
      amountPaid: body.amountPaid,
      paymentMethod: body.paymentMethod,
      items: body.items ?? [],
    });

    let receiptNumber: string | null = null;
    if (body.issue) {
      receiptNumber = await finalizeReceipt(user, id);
    }

    return NextResponse.json({ id, receiptNumber });
  } catch (err) {
    return handleApiError(err);
  }
}
