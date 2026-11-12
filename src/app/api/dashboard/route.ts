import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/auth";
import { getDashboardStats } from "@/lib/server/services";
import { fetchFromFastApi } from "@/lib/server/fastapi-client";
import { handleApiError } from "@/lib/server/http";

export async function GET() {
  try {
    const user = await requireActiveStaff();

    // Use FastAPI high-speed endpoint if running, fallback to Drizzle ORM
    const stats =
      (await fetchFromFastApi<Record<string, unknown>>("/api/v1/dashboard-stats", user)) ??
      (await getDashboardStats(user));

    return NextResponse.json(stats);
  } catch (err) {
    return handleApiError(err);
  }
}
