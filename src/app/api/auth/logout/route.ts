import { NextResponse } from "next/server";
import { destroyServerSession, getCurrentSession } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function POST() {
  try {
    const session = await getCurrentSession();
    if (session) {
      await logAudit(session.user.id, "auth.logout", "user", session.user.id).catch(() => undefined);
    }
    await destroyServerSession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
