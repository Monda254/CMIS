import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  enforceAuthRateLimit,
  getCurrentSession,
  hashPassword,
  sha256Hex,
} from "@/lib/server/auth";
import { logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const ip = (request.headers.get("x-forwarded-for") ?? "unknown")
      .split(",")[0]!
      .trim()
      .slice(0, 64);
    const ipHash = sha256Hex("ip:" + ip);

    enforceAuthRateLimit(`reset_pw:${ipHash}`, 10, 10 * 60 * 1000);

    const body = (await request.json()) as { password?: string; token?: string };
    const password = body.password ?? "";
    const token = (body.token ?? "").trim();

    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ message: "Password must be between 8 and 128 characters" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    if (token) {
      const tokenHash = sha256Hex("reset:" + token);
      const updated = await db
        .update(schema.users)
        .set({
          passwordHash,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.users.resetTokenHash, tokenHash), gt(schema.users.resetTokenExpiresAt, new Date())))
        .returning({ id: schema.users.id });

      if (updated.length === 0) {
        return NextResponse.json({ message: "Invalid or expired reset link" }, { status: 400 });
      }

      const targetUserId = updated[0]!.id;
      // Revoke all existing sessions for this user upon password reset (MP-17 SEC-01)
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, targetUserId));
      await logAudit(targetUserId, "auth.password_reset_completed", "user", targetUserId, { ip_hash: ipHash });
      return NextResponse.json({ ok: true });
    }

    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ message: "Authentication or reset token required" }, { status: 401 });
    }

    await db
      .update(schema.users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(schema.users.id, session.user.id));

    await logAudit(session.user.id, "auth.password_changed", "user", session.user.id, { ip_hash: ipHash });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
