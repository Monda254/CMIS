import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { getReportsRows, logAudit } from "@/lib/server/services";
import { fetchFromFastApi } from "@/lib/server/fastapi-client";
import { handleApiError } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
    const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
    const status = searchParams.get("status") ?? "finalized";

    const qs = new URLSearchParams({ from, to, status });
    const fastRows = await fetchFromFastApi<unknown[]>(`/api/v1/reports?${qs.toString()}`, user);
    const rows = fastRows ?? (await getReportsRows({ from, to, status }));
    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = (await request.json()) as Record<string, unknown>;
    await logAudit(user.id, "report.exported", "report", "receipts", body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
