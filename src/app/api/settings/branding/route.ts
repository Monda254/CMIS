import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/server/auth";
import { ensureCompanySettings, logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

const ALLOWED_FIELDS = new Set(["logo_url", "stamp_url", "signature_url"]);
const ALLOWED_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const STORAGE_ROOT = path.join(process.cwd(), ".storage", "branding");

function mapColumn(field: "logo_url" | "stamp_url" | "signature_url") {
  if (field === "logo_url") return { logoUrl: null as string | null };
  if (field === "stamp_url") return { stampUrl: null as string | null };
  return { signatureUrl: null as string | null };
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const formData = await request.formData();
    const field = String(formData.get("field") ?? "");
    const file = formData.get("file");

    if (!ALLOWED_FIELDS.has(field)) {
      return NextResponse.json({ message: "Invalid branding field" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Image file is required" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ message: "Use a PNG, JPG or WebP image." }, { status: 400 });
    }

    const relPath = `${field}/${randomUUID()}.${ext}`;
    const fullPath = path.join(STORAGE_ROOT, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, bytes);

    await ensureCompanySettings();
    const colPatch =
      field === "logo_url"
        ? { logoUrl: relPath }
        : field === "stamp_url"
          ? { stampUrl: relPath }
          : { signatureUrl: relPath };

    await db
      .update(schema.companySettings)
      .set({ ...colPatch, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(schema.companySettings.id, 1));

    await logAudit(user.id, "settings.updated", "company_settings", "1", { branding: field });
    return NextResponse.json({ path: relPath });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const field = searchParams.get("field") ?? "";

    if (!ALLOWED_FIELDS.has(field)) {
      return NextResponse.json({ message: "Invalid branding field" }, { status: 400 });
    }

    await ensureCompanySettings();
    const colPatch = mapColumn(field as "logo_url" | "stamp_url" | "signature_url");
    await db
      .update(schema.companySettings)
      .set({ ...colPatch, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(schema.companySettings.id, 1));

    await logAudit(user.id, "settings.updated", "company_settings", "1", { removed: field });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
