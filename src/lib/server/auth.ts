import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE_NAME = "ledgerly_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  role: "admin" | "cashier";
};

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

export async function createServerSession(
  userId: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const sessionId = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    expiresAt,
    ipHash: meta?.ip ? sha256Hex("ip:" + meta.ip) : null,
    userAgent: meta?.userAgent?.slice(0, 255) ?? null,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export async function destroyServerSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const sessionId = sha256Hex(token);
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentSession(): Promise<{ user: SessionUser; sessionId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const sessionId = sha256Hex(token);
  const now = new Date();

  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      id: schema.users.id,
      email: schema.users.email,
      fullName: schema.users.fullName,
      active: schema.users.active,
      role: schema.users.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.id, sessionId), gt(schema.sessions.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Sliding window session extension if less than 7 days remain
  if (row.expiresAt.getTime() - now.getTime() < SESSION_REFRESH_THRESHOLD_MS) {
    const nextExpires = new Date(Date.now() + SESSION_TTL_MS);
    await db
      .update(schema.sessions)
      .set({ expiresAt: nextExpires })
      .where(eq(schema.sessions.id, sessionId));
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.id,
      email: row.email,
      fullName: row.fullName || row.email,
      active: row.active,
      role: row.role,
    },
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireSessionUser(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) throw new HttpError(401, "Authentication required");
  return session.user;
}

export async function requireActiveStaff(): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (!user.active) throw new HttpError(403, "Your account is awaiting administrator activation");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireActiveStaff();
  if (user.role !== "admin") throw new HttpError(403, "Administrator access required");
  return user;
}
