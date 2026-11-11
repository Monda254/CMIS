import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireActiveStaff } from "@/lib/server/auth";
import { getDashboardStats, getReceiptsList } from "@/lib/server/services";
import { fetchFromFastApi } from "@/lib/server/fastapi-client";
import { handleApiError } from "@/lib/server/http";

export async function GET() {
  try {
    const user = await requireActiveStaff();
    const isAdmin = user.role === "admin";

    // Use FastAPI high-speed endpoint if running, fallback to Drizzle ORM
    const statsPromise = fetchFromFastApi<Record<string, unknown>>("/api/v1/dashboard-stats", user).then(
      (res) => res ?? getDashboardStats(user),
    );

    const recentReceiptsPromise = fetchFromFastApi<unknown[]>("/api/v1/receipts?limit=8", user).then(
      (res) => res ?? getReceiptsList({ limit: 8 }),
    );

    const recentClientsPromise = db
      .select({
        id: schema.clients.id,
        name: schema.clients.name,
        created_at: schema.clients.createdAt,
      })
      .from(schema.clients)
      .orderBy(desc(schema.clients.createdAt))
      .limit(5);

    const recentActivityPromise = isAdmin
      ? Promise.all([
          db
            .select({
              id: schema.auditLogs.id,
              actor_id: schema.auditLogs.actorId,
              action: schema.auditLogs.action,
              metadata: schema.auditLogs.metadata,
              created_at: schema.auditLogs.createdAt,
            })
            .from(schema.auditLogs)
            .orderBy(desc(schema.auditLogs.id))
            .limit(8),
          db.select({ id: schema.users.id, full_name: schema.users.fullName, email: schema.users.email }).from(schema.users),
        ]).then(([entries, profiles]) => {
          const nameById = new Map(profiles.map((p) => [p.id, p.full_name || p.email || "Someone"]));
          return entries.map((e) => ({
            ...e,
            created_at: e.created_at.toISOString(),
            actor: nameById.get(e.actor_id ?? "") ?? "—",
          }));
        })
      : Promise.resolve([]);

    const [stats, recentReceipts, recentClients, recentActivity] = await Promise.all([
      statsPromise,
      recentReceiptsPromise,
      recentClientsPromise,
      recentActivityPromise,
    ]);

    return NextResponse.json({
      stats,
      recentReceipts,
      recentClients: recentClients.map((c) => ({
        id: c.id,
        name: c.name,
        created_at: c.created_at.toISOString(),
      })),
      recentActivity,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
