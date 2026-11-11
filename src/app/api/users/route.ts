import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function GET() {
  try {
    await requireAdmin();
    const rows = await db
      .select({
        id: schema.users.id,
        full_name: schema.users.fullName,
        email: schema.users.email,
        active: schema.users.active,
        role: schema.users.role,
        created_at: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(asc(schema.users.createdAt));

    return NextResponse.json(
      rows.map((u) => ({
        ...u,
        created_at: u.created_at.toISOString(),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      userId?: string;
      role?: "admin" | "cashier";
      active?: boolean;
    };

    const userId = body.userId ?? "";
    const role = body.role;
    const active = Boolean(body.active);

    if (!userId || (role !== "admin" && role !== "cashier")) {
      return NextResponse.json({ message: "Valid userId and role are required" }, { status: 400 });
    }
    if (userId === admin.id && (role !== "admin" || !active)) {
      return NextResponse.json(
        { message: "You cannot remove your own administrator access" },
        { status: 400 },
      );
    }

    await db
      .update(schema.users)
      .set({
        role,
        active,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));

    await logAudit(admin.id, "user.updated", "user", userId, { role, active });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as {
      email?: string;
      fullName?: string;
      role?: "admin" | "cashier";
      password?: string;
    };

    const email = (body.email ?? "").trim().toLowerCase();
    const fullName = (body.fullName ?? "").trim() || email.split("@")[0] || "Team Member";
    const role = body.role === "admin" ? "admin" : "cashier";
    const password = (body.password ?? "").trim() || "WelcomeFolio2026!";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ message: "Valid email address is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ message: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ message: "A team member with this email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        fullName: fullName.slice(0, 120),
        passwordHash,
        role,
        active: true,
      })
      .returning({ id: schema.users.id });

    await logAudit(admin.id, "user.invited", "user", created!.id, { email, role });
    return NextResponse.json({ ok: true, id: created!.id });
  } catch (err) {
    return handleApiError(err);
  }
}
