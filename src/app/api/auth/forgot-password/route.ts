import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { enforceAuthRateLimit, sha256Hex } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const ip = (request.headers.get("x-forwarded-for") ?? "unknown")
      .split(",")[0]!
      .trim()
      .slice(0, 64);
    const ipHash = sha256Hex("ip:" + ip);

    enforceAuthRateLimit(`forgot_pw:${ipHash}`, 10, 10 * 60 * 1000);

    const body = (await request.json()) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ message: "Email is required" }, { status: 400 });
    }

    const [user] = await db
      .select({ id: schema.users.id, active: schema.users.active })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (user && user.active) {
      const token = randomBytes(24).toString("hex");
      const tokenHash = sha256Hex("reset:" + token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      await db
        .update(schema.users)
        .set({ resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(schema.users.id, user.id));

      await logAudit(user.id, "auth.password_reset_requested", "user", user.id, { ip_hash: ipHash });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
