import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server/auth";
import { handleApiError } from "@/lib/server/http";

export async function GET() {
  try {
    const session = await getCurrentSession();
    return NextResponse.json({ user: session?.user ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}
