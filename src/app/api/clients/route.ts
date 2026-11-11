import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireActiveStaff } from "@/lib/server/auth";
import { ensureCompanySettings, logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireActiveStaff();
    const isAdmin = user.role === "admin";
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const [settings, rows] = await Promise.all([
      ensureCompanySettings(),
      db.execute<{
        id: string;
        name: string;
        phone: string;
        address: string;
        active: boolean;
        created_at: Date | string;
        receipt_count: string | number;
        total_spending: string | number;
        last_activity: Date | string | null;
      }>(sql`
        SELECT
          c.id::text AS id,
          c.name,
          c.phone,
          c.address,
          c.active,
          c.created_at,
          count(r.id) FILTER (WHERE r.status = 'finalized') AS receipt_count,
          coalesce(sum(r.total) FILTER (WHERE r.status = 'finalized'), 0) AS total_spending,
          coalesce(max(r.finalized_at), max(r.created_at), c.created_at) AS last_activity
        FROM public.clients c
        LEFT JOIN public.receipts r ON r.client_id = c.id
        ${activeOnly ? sql`WHERE c.active = true` : sql``}
        GROUP BY c.id
        ORDER BY c.name ASC
      `),
    ]);

    return NextResponse.json(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        active: Boolean(c.active),
        created_at: new Date(c.created_at).toISOString(),
        receipt_count: Number(c.receipt_count ?? 0),
        total_spending: isAdmin ? Number(c.total_spending ?? 0) : null,
        currency: settings.currency,
        last_activity: c.last_activity ? new Date(c.last_activity).toISOString() : new Date(c.created_at).toISOString(),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireActiveStaff();
    const body = (await request.json()) as {
      name?: string;
      phone?: string;
      address?: string;
      active?: boolean;
    };
    const name = (body.name ?? "").trim();
    const phone = (body.phone ?? "").trim();
    const address = (body.address ?? "").trim();
    const active = body.active ?? true;

    if (!name || name.length > 200) {
      return NextResponse.json({ message: "Client name is required (up to 200 characters)" }, { status: 400 });
    }

    const [inserted] = await db
      .insert(schema.clients)
      .values({
        name,
        phone: phone.slice(0, 40),
        address: address.slice(0, 500),
        active: Boolean(active),
        createdBy: user.id,
      })
      .returning();

    await logAudit(user.id, "client.created", "client", inserted!.id);
    return NextResponse.json(inserted);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireActiveStaff();
    const body = (await request.json()) as {
      id?: string;
      name?: string;
      phone?: string;
      address?: string;
      active?: boolean;
    };
    if (!body.id) {
      return NextResponse.json({ message: "Client id is required" }, { status: 400 });
    }
    const name = (body.name ?? "").trim();
    if (!name || name.length > 200) {
      return NextResponse.json({ message: "Client name is required (up to 200 characters)" }, { status: 400 });
    }

    await db
      .update(schema.clients)
      .set({
        name,
        phone: (body.phone ?? "").trim().slice(0, 40),
        address: (body.address ?? "").trim().slice(0, 500),
        active: Boolean(body.active ?? true),
        updatedAt: new Date(),
      })
      .where(eq(schema.clients.id, body.id));

    await logAudit(user.id, "client.updated", "client", body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
