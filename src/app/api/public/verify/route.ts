import { NextResponse } from "next/server";
import { verifyReceiptLimited } from "@/lib/server/services";

export async function POST(request: Request) {
  let identifier = "";
  try {
    const body = (await request.json()) as { identifier?: unknown };
    if (body && typeof body.identifier === "string") identifier = body.identifier;
  } catch {
    return NextResponse.json({ result: "invalid" });
  }

  try {
    const ip = (request.headers.get("x-forwarded-for") ?? "unknown")
      .split(",")[0]!
      .trim()
      .slice(0, 64);
    const result = await verifyReceiptLimited(identifier, ip);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Verify Error]", err);
    return NextResponse.json({ result: "error" });
  }
}
