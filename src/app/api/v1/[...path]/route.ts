import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server/auth";

const FASTAPI_BASE_URL = (process.env["FASTAPI_URL"] ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const INTERNAL_SECRET = process.env["FASTAPI_INTERNAL_SECRET"] ?? "ledgerly-internal-dev-secret";

async function proxyToFastApi(request: Request, paramsPromise: Promise<{ path: string[] }>) {
  const { path } = await paramsPromise;
  const subPath = path.join("/");
  const { search } = new URL(request.url);
  const targetUrl = `${FASTAPI_BASE_URL}/api/v1/${subPath}${search}`;

  const session = await getCurrentSession();
  const headers = new Headers();

  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const idemKey = request.headers.get("idempotency-key");
  if (idemKey) headers.set("idempotency-key", idemKey);

  const reqId = request.headers.get("x-request-id");
  if (reqId) headers.set("x-request-id", reqId);

  if (session?.user) {
    headers.set("x-internal-secret", INTERNAL_SECRET);
    headers.set("x-user-id", session.user.id);
    headers.set("x-user-role", session.user.role);
    headers.set("x-user-active", String(session.user.active));
  }

  const method = request.method.toUpperCase();
  const body = method !== "GET" && method !== "HEAD" ? await request.arrayBuffer() : undefined;

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      cache: "no-store",
    });

    const respHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    if (upstreamContentType) respHeaders.set("content-type", upstreamContentType);
    const disp = upstream.headers.get("content-disposition");
    if (disp) respHeaders.set("content-disposition", disp);
    const xReqId = upstream.headers.get("x-request-id");
    if (xReqId) respHeaders.set("x-request-id", xReqId);

    const respBuffer = await upstream.arrayBuffer();
    return new NextResponse(respBuffer, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    console.error("[FastAPI Proxy Error]", err);
    return NextResponse.json(
      {
        error: {
          code: "BACKEND_UNAVAILABLE",
          message: "The IBMS FastAPI service is currently unreachable.",
          details: {},
        },
        message: "The IBMS FastAPI service is currently unreachable.",
      },
      { status: 503 },
    );
  }
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyToFastApi(request, context.params);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyToFastApi(request, context.params);
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyToFastApi(request, context.params);
}

export async function PATCH(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyToFastApi(request, context.params);
}

export async function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyToFastApi(request, context.params);
}
