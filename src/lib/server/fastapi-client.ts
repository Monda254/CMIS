import type { SessionUser } from "./auth";

const FASTAPI_URL = process.env["FASTAPI_URL"]?.replace(/\/+$/, "");
const INTERNAL_SECRET = process.env["FASTAPI_INTERNAL_SECRET"] ?? "ledgerly-internal-dev-secret";

/**
 * Calls the companion FastAPI data-fetching service if FASTAPI_URL is configured and reachable.
 * Returns null if FastAPI is not configured or unavailable so the caller seamlessly falls back
 * to direct Drizzle ORM queries.
 */
export async function fetchFromFastApi<T>(
  path: string,
  user?: SessionUser | null,
  init?: RequestInit,
): Promise<T | null> {
  if (!FASTAPI_URL) return null;
  try {
    const headers = new Headers(init?.headers);
    headers.set("x-internal-secret", INTERNAL_SECRET);
    if (user) {
      headers.set("x-user-id", user.id);
      headers.set("x-user-role", user.role);
      headers.set("x-user-active", String(user.active));
    }
    const res = await fetch(`${FASTAPI_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
