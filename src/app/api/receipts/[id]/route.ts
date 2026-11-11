import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/auth";
import {
  cancelReceipt,
  deleteDraft,
  duplicateReceiptAsDraft,
  finalizeReceipt,
  getReceiptDetail,
  recordPrint,
} from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireActiveStaff();
    const { id } = await params;
    const detail = await getReceiptDetail(id);
    if (!detail) {
      return NextResponse.json({ message: "Receipt not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireActiveStaff();
    const { id } = await params;
    const body = (await request.json()) as { action?: string; reason?: string };

    if (body.action === "finalize") {
      const receiptNumber = await finalizeReceipt(user, id);
      return NextResponse.json({ receiptNumber });
    }
    if (body.action === "cancel") {
      await cancelReceipt(user, id, body.reason ?? "");
      return NextResponse.json({ ok: true });
    }
    if (body.action === "record_print") {
      const copy = await recordPrint(user, id);
      return NextResponse.json({ copy });
    }
    if (body.action === "duplicate") {
      const draftId = await duplicateReceiptAsDraft(user, id);
      return NextResponse.json({ id: draftId });
    }

    return NextResponse.json({ message: "Unknown action" }, { status: 400 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireActiveStaff();
    const { id } = await params;
    await deleteDraft(user, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
