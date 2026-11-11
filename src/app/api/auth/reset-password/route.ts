import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession, hashPassword, sha256Hex } from "@/lib/server/auth";
import { handleApiError } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: string; token?: string };
    const password = body.password ?? "";
    const token = (body.token ?? "").trim();

    if (password.length < 8) {
      return NextResponse.json({ message: "Password must be at least 8 characters" }, { status: 400 });
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
