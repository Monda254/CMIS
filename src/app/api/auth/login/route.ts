import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createServerSession, verifyPassword } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json({ message: "Email and password are required" }, { status: 400 });
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await logAudit(user?.id ?? null, "auth.login_failed", "user", user?.id ?? null, { email }, "failure");
      return NextResponse.json({ message: "Invalid email or password" }, { status: 401 });
    }

    const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
    const userAgent = request.headers.get("user-agent") ?? "";
    await createServerSession(user.id, { ip, userAgent });
    await logAudit(user.id, "auth.login", "user", user.id);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName || user.email,
        active: user.active,
        role: user.role,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
