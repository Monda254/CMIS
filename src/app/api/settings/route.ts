import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireActiveStaff, requireAdmin } from "@/lib/server/auth";
import { ensureCompanySettings, logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function GET() {
  try {
    await requireActiveStaff();
    const s = await ensureCompanySettings();
    return NextResponse.json({
      id: s.id,
      name: s.name,
      address: s.address,
      phone: s.phone,
      email: s.email,
      footer: s.footer,
      currency: s.currency,
      number_prefix: s.numberPrefix,
      logo_url: s.logoUrl,
      stamp_url: s.stampUrl,
      signature_url: s.signatureUrl,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin();
    const body = (await request.json()) as {
      name?: string;
      address?: string;
      phone?: string;
      email?: string;
      footer?: string;
      currency?: string;
      number_prefix?: string;
    };

    const currency = (body.currency ?? "KES").trim().toUpperCase();
    const prefix = (body.number_prefix ?? "RCP").trim().toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json(
        { message: "Currency must be exactly 3 letters, for example KES." },
        { status: 400 },
      );
    }
    if (!/^[A-Z0-9]{1,8}$/.test(prefix)) {
      return NextResponse.json(
        { message: "Number prefix must be 1–8 letters or digits, for example RCP." },
        { status: 400 },
      );
    }

    await ensureCompanySettings();
    await db
      .update(schema.companySettings)
      .set({
        name: (body.name ?? "").trim().slice(0, 200),
        address: (body.address ?? "").trim().slice(0, 500),
        phone: (body.phone ?? "").trim().slice(0, 60),
        email: (body.email ?? "").trim().slice(0, 200),
        footer: (body.footer ?? "").trim().slice(0, 500),
        currency,
        numberPrefix: prefix,
        updatedAt: new Date(),
        updatedBy: user.id,
      })
      .where(eq(schema.companySettings.id, 1));

    await logAudit(user.id, "settings.updated", "company_settings", "1");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
