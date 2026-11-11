import { NextResponse } from "next/server";
import { desc, eq, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireActiveStaff } from "@/lib/server/auth";
import { ensureCompanySettings } from "@/lib/server/services";
import { handleApiError } from "@/lib/server/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireActiveStaff();
    const isAdmin = user.role === "admin";
    const { id } = await params;

    const [settings, [client], clientReceipts, usersList] = await Promise.all([
      ensureCompanySettings(),
      db.select().from(schema.clients).where(eq(schema.clients.id, id)).limit(1),
      db
        .select()
        .from(schema.receipts)
        .where(eq(schema.receipts.clientId, id))
        .orderBy(desc(schema.receipts.createdAt))
        .limit(200),
      db.select({ id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email }).from(schema.users),
    ]);

    if (!client) {
      return NextResponse.json({ message: "Client not found" }, { status: 404 });
    }

    const receiptIds = clientReceipts.map((r) => r.id);
    const logs = await db
      .select()
      .from(schema.auditLogs)
      .where(
        receiptIds.length > 0
          ? or(eq(schema.auditLogs.resourceId, id), ...receiptIds.slice(0, 20).map((rid) => eq(schema.auditLogs.resourceId, rid)))
          : eq(schema.auditLogs.resourceId, id),
      )
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(12);

    const userMap = new Map(usersList.map((u) => [u.id, u.fullName || u.email || "Team member"]));
    const finalizedReceipts = clientReceipts.filter((r) => r.status === "finalized");
    const totalSpending = finalizedReceipts.reduce((sum, r) => sum + Number(r.total), 0);
    const lastTx = finalizedReceipts[0]?.finalizedAt ?? clientReceipts[0]?.createdAt ?? null;

    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        address: client.address,
        active: client.active,
        created_at: client.createdAt.toISOString(),
        updated_at: client.updatedAt.toISOString(),
        updated_by_name: userMap.get(client.createdBy ?? "") ?? "Administrator",
      },
      stats: {
        currency: settings.currency,
        total_spending: isAdmin ? Math.round(totalSpending * 100) / 100 : null,
        receipt_count: finalizedReceipts.length,
        total_records: clientReceipts.length,
        last_transaction: lastTx ? lastTx.toISOString() : null,
      },
      receipts: clientReceipts.map((r) => ({
        id: r.id,
        status: r.status,
        receipt_number: r.receiptNumber,
        verification_code: r.verificationCode,
        total: r.total,
        currency: r.currency,
        finalized_at: r.finalizedAt ? r.finalizedAt.toISOString() : null,
        created_at: r.createdAt.toISOString(),
      })),
      activity: logs.map((l) => ({
        id: l.id,
        action: l.action,
        resource_type: l.resourceType,
        resource_id: l.resourceId,
        actor_name: userMap.get(l.actorId ?? "") ?? "Workspace",
        metadata: l.metadata,
        created_at: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
