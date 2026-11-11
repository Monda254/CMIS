import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gte, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { HttpError, sha256Hex, type SessionUser } from "./auth";

const VERIFICATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function decimalScale(value: number): number {
  const s = String(value);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function generateVerificationCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (let i = 0; i < 10; i++) {
    code += VERIFICATION_ALPHABET[bytes[i]! % 32]!;
  }
  return code;
}

export async function logAudit(
  actorId: string | null,
  action: string,
  resourceType?: string | null,
  resourceId?: string | null,
  metadata: Record<string, unknown> = {},
  outcome = "success",
) {
  await db.insert(schema.auditLogs).values({
    actorId,
    action,
    resourceType: resourceType ?? null,
    resourceId: resourceId ?? null,
    outcome,
    metadata,
  });
}

export async function ensureCompanySettings() {
  const existing = await db
    .select()
    .from(schema.companySettings)
    .where(eq(schema.companySettings.id, 1))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(schema.companySettings)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const retry = await db
    .select()
    .from(schema.companySettings)
    .where(eq(schema.companySettings.id, 1))
    .limit(1);
  return retry[0]!;
}

export type DraftItemInput = {
  description: string;
  quantity: number;
  unit_price: number;
};

export type SaveReceiptDraftInput = {
  receiptId?: string | null;
  clientId?: string | null;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  notes?: string;
  items: DraftItemInput[];
};

/**
 * Authoritative server-side draft creation / update with strict money math.
 */
export async function saveReceiptDraft(user: SessionUser, input: SaveReceiptDraftInput): Promise<string> {
  const customerName = (input.customerName ?? "").trim();
  const customerPhone = (input.customerPhone ?? "").trim();
  const customerAddress = (input.customerAddress ?? "").trim();
  const notes = (input.notes ?? "").trim();

  if (!customerName) throw new HttpError(400, "Customer name is required");
  if (customerName.length > 200) throw new HttpError(400, "Customer name too long");
  if (customerPhone.length > 40) throw new HttpError(400, "Customer phone too long");
  if (customerAddress.length > 500) throw new HttpError(400, "Customer address too long");
  if (notes.length > 2000) throw new HttpError(400, "Notes too long");
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new HttpError(400, "At least one item is required");
  }
  if (input.items.length > 200) throw new HttpError(400, "Too many items");

  const normalizedItems = input.items.map((it, idx) => {
    const pos = idx + 1;
    const descText = (it.description ?? "").trim();
    const q = Number(it.quantity);
    const p = Number(it.unit_price);
    if (!descText || descText.length > 500) {
      throw new HttpError(400, `Item ${pos}: description must be 1–500 characters`);
    }
    if (!Number.isFinite(q) || q <= 0) {
      throw new HttpError(400, `Item ${pos}: quantity must be positive`);
    }
    if (!Number.isFinite(p) || p < 0) {
      throw new HttpError(400, `Item ${pos}: unit price cannot be negative`);
    }
    if (decimalScale(p) > 2) {
      throw new HttpError(400, `Item ${pos}: unit price allows at most 2 decimals`);
    }
    if (decimalScale(q) > 3) {
      throw new HttpError(400, `Item ${pos}: quantity allows at most 3 decimals`);
    }
    // Authoritative rounding to 2 decimal places
    const lineTotalNum = Math.round(q * p * 100) / 100;
    return {
      position: pos,
      description: descText,
      quantity: q.toFixed(3).replace(/\.?0+$/, ""),
      unitPrice: p.toFixed(2),
      lineTotal: lineTotalNum.toFixed(2),
      lineTotalNum,
    };
  });

  const totalNum = Math.round(normalizedItems.reduce((acc, it) => acc + it.lineTotalNum, 0) * 100) / 100;
  const totalStr = totalNum.toFixed(2);

  return await db.transaction(async (tx) => {
    const settings = await ensureCompanySettings();
    let clientId = input.clientId ?? null;

    if (!clientId) {
      const [newClient] = await tx
        .insert(schema.clients)
        .values({
          name: customerName,
          phone: customerPhone,
          address: customerAddress,
          createdBy: user.id,
        })
        .returning({ id: schema.clients.id });
      clientId = newClient!.id;
      await tx.insert(schema.auditLogs).values({
        actorId: user.id,
        action: "client.created",
        resourceType: "client",
        resourceId: clientId,
      });
    } else {
      const [foundClient] = await tx
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(eq(schema.clients.id, clientId))
        .limit(1);
      if (!foundClient) throw new HttpError(404, "Client not found");
    }

    let receiptId = input.receiptId ?? null;

    if (!receiptId) {
      const [inserted] = await tx
        .insert(schema.receipts)
        .values({
          clientId,
          customerName,
          customerPhone,
          customerAddress,
          notes,
          currency: settings.currency,
          total: totalStr,
          createdBy: user.id,
        })
        .returning({ id: schema.receipts.id });
      receiptId = inserted!.id;
      await tx.insert(schema.auditLogs).values({
        actorId: user.id,
        action: "receipt.created",
        resourceType: "receipt",
        resourceId: receiptId,
      });
    } else {
      const existingRows = await tx.execute<{ id: string }>(
        sql`SELECT id FROM public.receipts WHERE id = ${receiptId}::uuid AND status = 'draft' FOR UPDATE`,
      );
      if (!existingRows.length) {
        throw new HttpError(400, "Only draft receipts can be edited");
      }
      await tx
        .update(schema.receipts)
        .set({
          clientId,
          customerName,
          customerPhone,
          customerAddress,
          notes,
          currency: settings.currency,
          total: totalStr,
          updatedAt: new Date(),
        })
        .where(eq(schema.receipts.id, receiptId));

      await tx.delete(schema.receiptItems).where(eq(schema.receiptItems.receiptId, receiptId));
      await tx.insert(schema.auditLogs).values({
        actorId: user.id,
        action: "receipt.draft_updated",
        resourceType: "receipt",
        resourceId: receiptId,
      });
    }

    await tx.insert(schema.receiptItems).values(
      normalizedItems.map((it) => ({
        receiptId: receiptId!,
        position: it.position,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
      })),
    );

    return receiptId!;
  });
}

/**
 * Finalizes a draft receipt: assigns sequential number, generates verification code,
 * and snapshots company branding/details.
 */
export async function finalizeReceipt(user: SessionUser, receiptId: string): Promise<string> {
  return await db.transaction(async (tx) => {
    const locked = await tx.execute<{
      id: string;
      status: "draft" | "finalized" | "cancelled";
      receipt_number: string | null;
    }>(sql`SELECT id, status, receipt_number FROM public.receipts WHERE id = ${receiptId}::uuid FOR UPDATE`);

    const r = locked[0];
    if (!r) throw new HttpError(404, "Receipt not found");
    if (r.status === "finalized" && r.receipt_number) return r.receipt_number;
    if (r.status !== "draft") throw new HttpError(400, "Receipt cannot be finalized");

    const items = await tx
      .select({ lineTotal: schema.receiptItems.lineTotal })
      .from(schema.receiptItems)
      .where(eq(schema.receiptItems.receiptId, receiptId));

    if (items.length === 0) throw new HttpError(400, "Receipt has no items");

    const totalNum = Math.round(items.reduce((sum, i) => sum + Number(i.lineTotal), 0) * 100) / 100;
    const settings = await ensureCompanySettings();
    const year = new Date().getFullYear();

    const seqRows = await tx.execute<{ last_value: string | number }>(sql`
      INSERT INTO public.receipt_sequences (prefix, year, last_value)
      VALUES (${settings.numberPrefix}, ${year}, 1)
      ON CONFLICT (prefix, year)
      DO UPDATE SET last_value = public.receipt_sequences.last_value + 1
      RETURNING last_value
    `);
    const seqVal = Number(seqRows[0]!.last_value);
    const receiptNumber = `${settings.numberPrefix}-${year}-${String(seqVal).padStart(6, "0")}`;

    let verificationCode = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = generateVerificationCode();
      const collision = await tx
        .select({ id: schema.receipts.id })
        .from(schema.receipts)
        .where(eq(schema.receipts.verificationCode, candidate))
        .limit(1);
      if (collision.length === 0) {
        verificationCode = candidate;
        break;
      }
    }
    if (!verificationCode) throw new HttpError(500, "Failed to allocate verification code");

    const snapshot: schema.CompanySnapshot = {
      name: settings.name,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      footer: settings.footer,
      logo_url: settings.logoUrl,
      stamp_url: settings.stampUrl,
      signature_url: settings.signatureUrl,
    };

    const now = new Date();
    await tx
      .update(schema.receipts)
      .set({
        status: "finalized",
        receiptNumber,
        verificationCode,
        total: totalNum.toFixed(2),
        currency: settings.currency,
        issuedBy: user.id,
        issuedByName: user.fullName,
        finalizedAt: now,
        updatedAt: now,
        companySnapshot: snapshot,
      })
      .where(eq(schema.receipts.id, receiptId));

    await tx.insert(schema.auditLogs).values({
      actorId: user.id,
      action: "receipt.finalized",
      resourceType: "receipt",
      resourceId: receiptId,
      metadata: { receipt_number: receiptNumber },
    });

    return receiptNumber;
  });
}

export async function cancelReceipt(user: SessionUser, receiptId: string, reason: string): Promise<void> {
  if (user.role !== "admin") throw new HttpError(403, "Only administrators can cancel receipts");
  const trimmedReason = (reason ?? "").trim();
  if (!trimmedReason) throw new HttpError(400, "A reason is required");

  const updated = await db
    .update(schema.receipts)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: user.id,
      cancelReason: trimmedReason,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.receipts.id, receiptId), eq(schema.receipts.status, "finalized")))
    .returning({ id: schema.receipts.id });

  if (updated.length === 0) throw new HttpError(400, "Only finalized receipts can be cancelled");

  await logAudit(user.id, "receipt.cancelled", "receipt", receiptId, { reason: trimmedReason });
}

export async function deleteDraft(user: SessionUser, receiptId: string): Promise<void> {
  const deleted = await db
    .delete(schema.receipts)
    .where(and(eq(schema.receipts.id, receiptId), eq(schema.receipts.status, "draft")))
    .returning({ id: schema.receipts.id });

  if (deleted.length === 0) throw new HttpError(400, "Only drafts can be deleted");

  await logAudit(user.id, "receipt.draft_deleted", "receipt", receiptId);
}

export async function recordPrint(user: SessionUser, receiptId: string): Promise<number> {
  const updated = await db
    .update(schema.receipts)
    .set({
      printCount: sql`${schema.receipts.printCount} + 1`,
    })
    .where(and(eq(schema.receipts.id, receiptId), ne(schema.receipts.status, "draft")))
    .returning({ printCount: schema.receipts.printCount });

  if (updated.length === 0) throw new HttpError(400, "Only issued receipts can be printed");
  const copy = updated[0]!.printCount;

  await logAudit(
    user.id,
    copy > 1 ? "receipt.reprinted" : "receipt.printed",
    "receipt",
    receiptId,
    { copy },
  );
  return copy;
}

function maskCustomerName(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .map((word) => (word.length <= 1 ? word : word[0]! + "*".repeat(word.length - 1)))
    .join(" ");
}

/**
 * Public, DB-rate-limited receipt verification (30/hr per IP hash, 10/10min per identifier).
 */
export async function verifyReceiptLimited(
  rawIdentifier: string,
  ipAddress: string,
): Promise<Record<string, unknown>> {
  const idf = (rawIdentifier ?? "").trim().toUpperCase();
  if (idf.length < 6 || idf.length > 40 || !/^[A-Z0-9-]+$/.test(idf)) {
    return { result: "invalid" };
  }

  const clientKey = sha256Hex("verify:" + ipAddress);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);

  const [visitorAttempts] = await db
    .select({ c: count() })
    .from(schema.verifyAttempts)
    .where(and(eq(schema.verifyAttempts.clientKey, clientKey), gte(schema.verifyAttempts.createdAt, oneHourAgo)));

  if (Number(visitorAttempts?.c ?? 0) >= 30) {
    return { result: "rate_limited" };
  }

  const [idAttempts] = await db
    .select({ c: count() })
    .from(schema.verifyAttempts)
    .where(and(eq(schema.verifyAttempts.identifier, idf), gte(schema.verifyAttempts.createdAt, tenMinAgo)));

  if (Number(idAttempts?.c ?? 0) >= 10) {
    return { result: "rate_limited" };
  }

  const [r] = await db
    .select()
    .from(schema.receipts)
    .where(
      and(
        ne(schema.receipts.status, "draft"),
        or(eq(schema.receipts.verificationCode, idf), eq(schema.receipts.receiptNumber, idf)),
      ),
    )
    .limit(1);

  let payload: Record<string, unknown>;
  if (!r) {
    payload = { result: "not_found" };
  } else {
    const code = r.verificationCode ?? "";
    const codeHint = code.length >= 6 ? `${code.slice(0, 3)}****${code.slice(-3)}` : code;
    payload = {
      result: r.status === "cancelled" ? "cancelled" : "valid",
      receipt_number: r.receiptNumber,
      code_hint: codeHint,
      customer: maskCustomerName(r.customerName),
      issued_at: r.finalizedAt ? r.finalizedAt.toISOString() : null,
      total: Number(r.total),
      currency: r.currency,
      company: r.companySnapshot?.name ?? "",
      cancelled_at: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    };
  }

  await db.insert(schema.verifyAttempts).values({
    clientKey,
    identifier: idf,
    result: String(payload["result"]),
  });

  return payload;
}

export async function duplicateReceiptAsDraft(user: SessionUser, sourceReceiptId: string): Promise<string> {
  const detail = await getReceiptDetail(sourceReceiptId);
  if (!detail) throw new HttpError(404, "Receipt not found");

  return await saveReceiptDraft(user, {
    receiptId: null,
    clientId: detail.receipt.client_id,
    customerName: detail.receipt.customer_name,
    customerPhone: detail.receipt.customer_phone,
    customerAddress: detail.receipt.customer_address,
    notes: detail.receipt.notes,
    items: detail.items.map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
    })),
  });
}

export async function getDashboardStats(user: SessionUser) {
  const isAdmin = user.role === "admin";
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    settings,
    [clientsCount],
    [newClientsMonth],
    [issuedAgg],
    [draftsCount],
    [cancelledCount],
    [todayAgg],
    [monthAgg],
    [verifyAgg],
    recentVerifyRows,
    recentClientRows,
  ] = await Promise.all([
    ensureCompanySettings(),
    db.select({ c: count() }).from(schema.clients),
    db
      .select({ c: count() })
      .from(schema.clients)
      .where(gte(schema.clients.createdAt, startOfMonth)),
    db
      .select({
        c: count(),
        v: sql<string>`coalesce(sum(${schema.receipts.total}), 0)`,
      })
      .from(schema.receipts)
      .where(eq(schema.receipts.status, "finalized")),
    db.select({ c: count() }).from(schema.receipts).where(eq(schema.receipts.status, "draft")),
    db.select({ c: count() }).from(schema.receipts).where(eq(schema.receipts.status, "cancelled")),
    db
      .select({
        c: count(),
        v: sql<string>`coalesce(sum(${schema.receipts.total}), 0)`,
      })
      .from(schema.receipts)
      .where(and(eq(schema.receipts.status, "finalized"), gte(schema.receipts.finalizedAt, startOfToday))),
    db
      .select({
        c: count(),
        v: sql<string>`coalesce(sum(${schema.receipts.total}), 0)`,
      })
      .from(schema.receipts)
      .where(and(eq(schema.receipts.status, "finalized"), gte(schema.receipts.finalizedAt, startOfMonth))),
    db.execute<{ total: string | number; valid: string | number; invalid: string | number }>(sql`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE result = 'valid') AS valid,
        count(*) FILTER (WHERE result <> 'valid') AS invalid
      FROM public.verify_attempts
    `),
    db
      .select({
        id: schema.verifyAttempts.id,
        identifier: schema.verifyAttempts.identifier,
        result: schema.verifyAttempts.result,
        createdAt: schema.verifyAttempts.createdAt,
      })
      .from(schema.verifyAttempts)
      .orderBy(desc(schema.verifyAttempts.createdAt))
      .limit(6),
    db.execute<{
      id: string;
      name: string;
      phone: string;
      address: string;
      receipt_count: string | number;
      total_spending: string | number;
    }>(sql`
      SELECT
        c.id::text AS id,
        c.name,
        c.phone,
        c.address,
        count(r.id) FILTER (WHERE r.status = 'finalized') AS receipt_count,
        coalesce(sum(r.total) FILTER (WHERE r.status = 'finalized'), 0) AS total_spending
      FROM public.clients c
      LEFT JOIN public.receipts r ON r.client_id = c.id
      GROUP BY c.id
      ORDER BY coalesce(max(r.created_at), c.created_at) DESC
      LIMIT 6
    `),
  ]);

  let daily: { day: string; value: number; count: number }[] | null = null;
  if (isAdmin) {
    const dailyRows = await db.execute<{ day: string; value: string | number; count: string | number }>(sql`
      SELECT
        d::date::text AS day,
        coalesce(sum(r.total), 0) AS value,
        count(r.id) AS count
      FROM generate_series(
        date_trunc('day', now()) - interval '13 days',
        date_trunc('day', now()),
        interval '1 day'
      ) d
      LEFT JOIN public.receipts r
        ON r.status = 'finalized'
       AND r.finalized_at >= d
       AND r.finalized_at < d + interval '1 day'
      GROUP BY d
      ORDER BY d ASC
    `);
    daily = dailyRows.map((row) => ({
      day: String(row.day),
      value: Number(row.value),
      count: Number(row.count),
    }));
  }

  const vRow = verifyAgg[0] ?? { total: 0, valid: 0, invalid: 0 };

  return {
    currency: settings.currency,
    company_name: settings.name || "Northstar Studio",
    clients: Number(clientsCount?.c ?? 0),
    new_clients_month: Number(newClientsMonth?.c ?? 0),
    issued: Number(issuedAgg?.c ?? 0),
    drafts: Number(draftsCount?.c ?? 0),
    cancelled: Number(cancelledCount?.c ?? 0),
    value_total: isAdmin ? Number(issuedAgg?.v ?? 0) : null,
    today_count: Number(todayAgg?.c ?? 0),
    today_value: isAdmin ? Number(todayAgg?.v ?? 0) : null,
    month_count: Number(monthAgg?.c ?? 0),
    month_value: isAdmin ? Number(monthAgg?.v ?? 0) : null,
    daily,
    verify_stats: {
      total: Number(vRow.total ?? 0),
      valid: Number(vRow.valid ?? 0),
      invalid: Number(vRow.invalid ?? 0),
      recent: recentVerifyRows.map((r) => ({
        id: r.id,
        identifier: r.identifier,
        result: r.result,
        created_at: r.createdAt.toISOString(),
      })),
    },
    recent_clients: recentClientRows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      receipt_count: Number(c.receipt_count ?? 0),
      total_spending: isAdmin ? Number(c.total_spending ?? 0) : null,
    })),
  };
}

export async function getReceiptsList(filters: { client?: string | null; status?: string | null; limit?: number }) {
  const conditions = [];
  if (filters.client) {
    conditions.push(eq(schema.receipts.clientId, filters.client));
  }
  if (filters.status && ["draft", "finalized", "cancelled"].includes(filters.status)) {
    conditions.push(eq(schema.receipts.status, filters.status as "draft" | "finalized" | "cancelled"));
  }

  const rows = await db
    .select({
      id: schema.receipts.id,
      status: schema.receipts.status,
      receipt_number: schema.receipts.receiptNumber,
      verification_code: schema.receipts.verificationCode,
      client_id: schema.receipts.clientId,
      customer_name: schema.receipts.customerName,
      total: schema.receipts.total,
      currency: schema.receipts.currency,
      finalized_at: schema.receipts.finalizedAt,
      created_at: schema.receipts.createdAt,
      print_count: schema.receipts.printCount,
      client_name: schema.clients.name,
    })
    .from(schema.receipts)
    .leftJoin(schema.clients, eq(schema.receipts.clientId, schema.clients.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.receipts.createdAt))
    .limit(filters.limit ?? 300);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    receipt_number: r.receipt_number,
    verification_code: r.verification_code,
    client_id: r.client_id,
    customer_name: r.customer_name,
    total: r.total,
    currency: r.currency,
    finalized_at: r.finalized_at ? r.finalized_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
    print_count: r.print_count,
    clients: r.client_name ? { name: r.client_name } : null,
  }));
}

export async function getReceiptDetail(receiptId: string) {
  const [r] = await db
    .select()
    .from(schema.receipts)
    .where(eq(schema.receipts.id, receiptId))
    .limit(1);

  if (!r) return null;

  const items = await db
    .select()
    .from(schema.receiptItems)
    .where(eq(schema.receiptItems.receiptId, receiptId))
    .orderBy(asc(schema.receiptItems.position));

  return {
    receipt: {
      id: r.id,
      status: r.status,
      receipt_number: r.receiptNumber,
      verification_code: r.verificationCode,
      client_id: r.clientId,
      customer_name: r.customerName,
      customer_phone: r.customerPhone,
      customer_address: r.customerAddress,
      notes: r.notes,
      currency: r.currency,
      total: r.total,
      company_snapshot: r.companySnapshot,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      finalized_at: r.finalizedAt ? r.finalizedAt.toISOString() : null,
      cancelled_at: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      cancel_reason: r.cancelReason,
      issued_by_name: r.issuedByName,
      print_count: r.printCount,
    },
    items: items.map((it) => ({
      id: it.id,
      receipt_id: it.receiptId,
      position: it.position,
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      line_total: it.lineTotal,
    })),
  };
}

export async function getReportsRows(params: { from: string; to: string; status: string }) {
  const fromDate = new Date(`${params.from}T00:00:00.000Z`);
  const toDate = new Date(`${params.to}T23:59:59.999Z`);

  const conditions = [
    ne(schema.receipts.status, "draft"),
    gte(schema.receipts.finalizedAt, fromDate),
    lte(schema.receipts.finalizedAt, toDate),
  ];
  if (params.status === "finalized") {
    conditions.push(eq(schema.receipts.status, "finalized"));
  } else if (params.status === "cancelled") {
    conditions.push(eq(schema.receipts.status, "cancelled"));
  }

  const rows = await db
    .select({
      id: schema.receipts.id,
      status: schema.receipts.status,
      receipt_number: schema.receipts.receiptNumber,
      customer_name: schema.receipts.customerName,
      total: schema.receipts.total,
      currency: schema.receipts.currency,
      finalized_at: schema.receipts.finalizedAt,
      print_count: schema.receipts.printCount,
      client_name: schema.clients.name,
    })
    .from(schema.receipts)
    .leftJoin(schema.clients, eq(schema.receipts.clientId, schema.clients.id))
    .where(and(...conditions))
    .orderBy(desc(schema.receipts.finalizedAt))
    .limit(10000);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    receipt_number: r.receipt_number,
    customer_name: r.customer_name,
    total: r.total,
    currency: r.currency,
    finalized_at: r.finalized_at ? r.finalized_at.toISOString() : null,
    print_count: r.print_count,
    clients: r.client_name ? { name: r.client_name } : null,
  }));
}
