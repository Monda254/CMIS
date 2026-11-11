import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/auth";
import { handleApiError } from "@/lib/server/http";

const STORAGE_ROOT = path.resolve(process.cwd(), ".storage", "branding");

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    await requireActiveStaff();
    const { path: segments } = await params;
    const joined = segments.join("/");
    const resolved = path.resolve(STORAGE_ROOT, joined);

    if (!resolved.startsWith(STORAGE_ROOT + path.sep)) {
      return NextResponse.json({ message: "Invalid path" }, { status: 400 });
    }

    const data = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=1800",
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }
    return handleApiError(err);
  }
}
