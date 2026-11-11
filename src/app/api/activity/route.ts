import { NextResponse } from "next/server";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession, requireAdmin } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    const current = await getCurrentSession();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 1000);
    const includeSessions = searchParams.get("include_sessions") === "1";

    const [entries, profiles, activeSessions] = await Promise.all([
      db
        .select({
          id: schema.auditLogs.id,
          actor_id: schema.auditLogs.actorId,
          action: schema.auditLogs.action,
          resource_type: schema.auditLogs.resourceType,
          resource_id: schema.auditLogs.resourceId,
          outcome: schema.auditLogs.outcome,
          metadata: schema.auditLogs.metadata,
          created_at: schema.auditLogs.createdAt,
        })
        .from(schema.auditLogs)
        .orderBy(desc(schema.auditLogs.id))
        .limit(limit),
      db
        .select({
          id: schema.users.id,
          full_name: schema.users.fullName,
          email: schema.users.email,
        })
        .from(schema.users),
      includeSessions
        ? db
            .select({
              id: schema.sessions.id,
              userAgent: schema.sessions.userAgent,
              createdAt: schema.sessions.createdAt,
              expiresAt: schema.sessions.expiresAt,
            })
            .from(schema.sessions)
            .where(and(eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date())))
            .orderBy(desc(schema.sessions.createdAt))
        : Promise.resolve([]),
    ]);

    const nameById = new Map(profiles.map((p) => [p.id, p.full_name || p.email || "Someone"]));
    const mappedEntries = entries.map((e) => ({
      ...e,
      created_at: e.created_at.toISOString(),
      actorName: nameById.get(e.actor_id ?? "") ?? "Workspace",
    }));

    if (includeSessions) {
      return NextResponse.json({
        entries: mappedEntries,
        sessions: activeSessions.map((s) => ({
          id: s.id.slice(0, 12),
          fullId: s.id,
          user_agent: s.userAgent || "Web Browser · Active session",
          created_at: s.createdAt.toISOString(),
          is_current: s.id === current?.sessionId,
        })),
      });
    }

    return NextResponse.json(mappedEntries);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAdmin();
    const current = await getCurrentSession();
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get("sessionId");

    if (targetId) {
      await db
        .delete(schema.sessions)
        .where(and(eq(schema.sessions.userId, user.id), eq(schema.sessions.id, targetId)));
      await logAudit(user.id, "session.revoked", "session", targetId.slice(0, 12));
    } else if (current?.sessionId) {
      await db
        .delete(schema.sessions)
        .where(and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, current.sessionId)));
      await logAudit(user.id, "session.revoked_others", "session", user.id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
