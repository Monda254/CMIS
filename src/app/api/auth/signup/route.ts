import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createServerSession, hashPassword } from "@/lib/server/auth";
import { ensureCompanySettings } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string; fullName?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const fullName = (body.fullName ?? "").trim();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ message: "A valid email address is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ message: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (!fullName || fullName.length > 120) {
      return NextResponse.json({ message: "Full name is required (up to 120 characters)" }, { status: 400 });
    }

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ message: "An account with that email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const createdUser = await db.transaction(async (tx) => {
      const [totalUsers] = await tx.select({ c: count() }).from(schema.users);
      const isFirstUser = Number(totalUsers?.c ?? 0) === 0;
      const role: "admin" | "cashier" = isFirstUser ? "admin" : "cashier";
      const active = isFirstUser;

      const [inserted] = await tx
        .insert(schema.users)
        .values({
          email,
          passwordHash,
          fullName,
          role,
          active,
        })
        .returning();

      await tx.insert(schema.auditLogs).values({
        actorId: inserted!.id,
        action: "user.registered",
        resourceType: "user",
        resourceId: inserted!.id,
        metadata: { initial_admin: isFirstUser },
      });

      return inserted!;
    });

    await ensureCompanySettings();

    const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
    const userAgent = request.headers.get("user-agent") ?? "";
    await createServerSession(createdUser.id, { ip, userAgent });

    return NextResponse.json({
      user: {
        id: createdUser.id,
        email: createdUser.email,
        fullName: createdUser.fullName,
        active: createdUser.active,
        role: createdUser.role,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
