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
const MAX_BRANDING_BYTES = 2 * 1024 * 1024; // 2 MB server-side cap (MP-17 SEC-03)
const STORAGE_ROOT = path.resolve(process.cwd(), ".storage", "branding");

function hasValidImageMagicBytes(bytes: Buffer, ext: string): boolean {
  if (bytes.length < 12) return false;
  if (ext === "png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (ext === "jpg" || ext === "jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (ext === "webp") {
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

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
    if (file.size === 0 || file.size > MAX_BRANDING_BYTES) {
      return NextResponse.json(
        { message: "Branding image must be non-empty and at most 2 MB" },
        { status: 400 },
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTS.has(ext)) {
      return NextResponse.json({ message: "Use a PNG, JPG or WebP image." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!hasValidImageMagicBytes(bytes, ext)) {
      return NextResponse.json(
        { message: "File binary signature does not match a valid PNG, JPEG, or WebP image" },
        { status: 400 },
      );
    }

    const relPath = `${field}/${randomUUID()}.${ext}`;
    const fullPath = path.resolve(STORAGE_ROOT, relPath);
    if (!fullPath.startsWith(STORAGE_ROOT + path.sep)) {
      return NextResponse.json({ message: "Invalid storage path" }, { status: 400 });
    }

    await mkdir(path.dirname(fullPath), { recursive: true });
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
