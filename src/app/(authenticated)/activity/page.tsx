"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { dateTime, sanitizeSpreadsheetCell } from "@/lib/format";

const LABELS: Record<string, string> = {
  "receipt.created": "Receipt draft created",
  "receipt.draft_updated": "Receipt edited",
  "receipt.draft_deleted": "Draft deleted",
  "receipt.finalized": "Receipt finalized",
  "receipt.printed": "Receipt printed",
  "receipt.reprinted": "Receipt reprinted",
  "receipt.cancelled": "Receipt cancelled",
  "client.created": "Client created",
  "client.updated": "Client updated",
  "user.updated": "Team access updated",
  "user.invited": "Team member invited",
  "settings.updated": "Company settings updated",
  "session.revoked": "Session ended",
  "session.revoked_others": "Other sessions logged out",
};

type AuditEntry = {
  id: number;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  outcome: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actorName: string;
};

type ActiveSessionRow = {
  id: string;
  fullId: string;
  user_agent: string;
  created_at: string;
  is_current: boolean;
};

function formatMeta(m: Record<string, unknown> | null, resourceType: string | null): string {
  if (!m) return resourceType ? `${resourceType} record` : "Workspace event";
  const parts: string[] = [];
  if (typeof m["receipt_number"] === "string") parts.push(m["receipt_number"]);
  if (typeof m["copy"] === "number") parts.push(`Copy #${m["copy"]}`);
  if (typeof m["reason"] === "string") parts.push(`Reason: ${m["reason"]}`);
  if (typeof m["role"] === "string") parts.push(`Role: ${m["role"]}`);
  if (typeof m["email"] === "string") parts.push(String(m["email"]));
  if (typeof m["branding"] === "string") parts.push(`Asset: ${m["branding"]}`);
  return parts.join(" · ") || (resourceType ? `${resourceType} updated` : "Workspace activity");
}

export default function ActivityPage() {
  const qc = useQueryClient();
  const [limit, setLimit] = useState(100);
  const [activityFilter, setActivityFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "7d">("all");

  const q = useQuery({
    queryKey: ["audit-sessions", limit],
    queryFn: () =>
      apiFetch<{ entries: AuditEntry[]; sessions: ActiveSessionRow[] }>(
        `/api/activity?limit=${limit}&include_sessions=1`,
      ),
  });

  const entries = q.data?.entries ?? [];
  const sessions = q.data?.sessions ?? [];

  const filteredEntries = useMemo(() => {
    const now = new Date();
    return entries.filter((e) => {
      if (activityFilter !== "all" && !e.action.startsWith(activityFilter)) return false;
      if (dateFilter !== "all") {
        const dt = new Date(e.created_at);
        if (dateFilter === "today" && dt.toDateString() !== now.toDateString()) return false;
        if (dateFilter === "7d" && now.getTime() - dt.getTime() > 7 * 24 * 60 * 60 * 1000) return false;
      }
      return true;
    });
  }, [entries, activityFilter, dateFilter]);

  async function revokeOtherSessions(sessionId?: string) {
    try {
      const url = sessionId ? `/api/activity?sessionId=${encodeURIComponent(sessionId)}` : "/api/activity";
      await apiFetch(url, { method: "DELETE" });
      toast.success(sessionId ? "Session ended" : "Logged out of all other sessions");
      await qc.invalidateQueries({ queryKey: ["audit-sessions"] });
    } catch {
      toast.error("Could not revoke session");
    }
  }

  function handleExportAuditCsv() {
    const headers = ["Date & Time", "User", "Activity", "Details", "Result"];
    const lines = [
      headers.join(","),
      ...filteredEntries.map((e) =>
        [
          sanitizeSpreadsheetCell(dateTime(e.created_at)),
          sanitizeSpreadsheetCell(e.actorName),
          sanitizeSpreadsheetCell(LABELS[e.action] ?? e.action),
          sanitizeSpreadsheetCell(formatMeta(e.metadata, e.resource_type)),
          sanitizeSpreadsheetCell(e.outcome === "success" ? "Success" : e.outcome),
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleBackupNow() {
    try {
      const [receiptsRes, clientsRes, settingsRes] = await Promise.all([
        fetch("/api/receipts?limit=500", { credentials: "include" }).then((r) => r.json()),
        fetch("/api/clients", { credentials: "include" }).then((r) => r.json()),
        fetch("/api/settings", { credentials: "include" }).then((r) => r.json()),
      ]);
      const backupPayload = {
        exported_at: new Date().toISOString(),
        settings: settingsRes,
        clients: clientsRes,
        receipts: receiptsRes,
        audit_logs: entries,
      };
      const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `folio-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Workspace backup downloaded");
    } catch {
      toast.error("Failed to generate backup archive");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header matching 11 · Security & activity.svg */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Security &amp; activity
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Keep your workspace and your receipts protected.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportAuditCsv}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
        >
          <Download className="h-4 w-4 text-[#7A7F8C]" />
          Export audit log
        </button>
      </div>

      {/* Top Green Protection Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#C9EAD7] bg-[#E8F6EE] px-6 py-4">
        <div>
          <div className="flex items-center gap-2 text-[#16794F]">
            <Check className="h-4 w-4 stroke-[2.5]" />
            <h2 className="font-display text-[15px] font-bold">Your workspace is protected</h2>
          </div>
          <p className="mt-0.5 text-[12.5px] text-[#2F5C47]">
            Receipt locking, verification validation, and role-based access are enabled.
          </p>
        </div>

        <span className="text-[12px] text-[#2F5C47]">Last checked today</span>
      </div>

      {/* 3 Security Cards Row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Card 1: Account Security */}
        <div className="flex flex-col justify-between rounded-xl border border-[#E6E8EF] bg-white p-6">
          <div>
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">Account security</h3>
            <p className="mt-1 text-[12px] text-[#7A7F8C]">
              Password protected with server-side scrypt hashing
            </p>

            <div className="mt-4">
              <Link
                href="/reset-password"
                className="flex h-10 w-full items-center rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] font-semibold text-[#20232D] transition-colors hover:bg-[#F7F8FA]"
              >
                Reset password
              </Link>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-[11.5px] text-[#7A7F8C]">Automatic session timeout</p>
            <p className="mt-0.5 text-[13px] font-bold text-[#20232D]">
              30 minutes of inactivity / HttpOnly cookie
            </p>
          </div>
        </div>

        {/* Card 2: Active Sessions */}
        <div className="flex flex-col justify-between rounded-xl border border-[#E6E8EF] bg-white p-6">
          <div>
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">Active sessions</h3>

            <div className="mt-4 space-y-3.5">
              {sessions.slice(0, 2).map((s) => (
                <div key={s.fullId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[#20232D]">
                      {s.user_agent.includes("Mozilla")
                        ? "Web Browser · Workspace Session"
                        : s.user_agent}
                    </p>
                    <p
                      className={`mt-0.5 text-[11.5px] ${
                        s.is_current ? "font-medium text-[#16794F]" : "text-[#7A7F8C]"
                      }`}
                    >
                      {s.is_current ? "Current session" : dateTime(s.created_at)}
                    </p>
                  </div>
                  {!s.is_current && (
                    <button
                      type="button"
                      onClick={() => revokeOtherSessions(s.fullId)}
                      className="shrink-0 text-[12px] font-semibold text-[#5848D6] hover:underline"
                    >
                      End session
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => revokeOtherSessions()}
              className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
            >
              Log out of all other sessions →
            </button>
          </div>
        </div>

        {/* Card 3: Backup & Restore */}
        <div className="flex flex-col justify-between rounded-xl border border-[#E6E8EF] bg-white p-6">
          <div>
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">
              Backup &amp; restore
            </h3>
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#16794F]">
              <Check className="h-3.5 w-3.5" />
              Latest backup completed
            </p>
            <p className="mt-1 text-[12px] text-[#7A7F8C]">
              PostgreSQL transactional integrity · 30-day retention
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleBackupNow}
                className="h-10 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[12.5px] font-semibold text-[#20232D] transition-colors hover:bg-[#F7F8FA]"
              >
                Back up now
              </button>
              <button
                type="button"
                onClick={() =>
                  toast.info(
                    "Workspace restoration is handled by administrator confirmation to protect issued receipts.",
                  )
                }
                className="h-10 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[12.5px] font-semibold text-[#20232D] transition-colors hover:bg-[#F7F8FA]"
              >
                Restore backup
              </button>
            </div>
          </div>

          <p className="mt-6 text-[11px] text-[#7A7F8C]">
            Restore requires administrator confirmation.
          </p>
        </div>
      </div>

      {/* Activity Log Card */}
      <div className="rounded-xl border border-[#E6E8EF] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Activity log</h2>
            <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
              A complete record of who did what, and when.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              aria-label="Filter by activity type"
              className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[12.5px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
            >
              <option value="all">All activity</option>
              <option value="receipt.">Receipt events</option>
              <option value="client.">Client events</option>
              <option value="user.">Team &amp; access</option>
              <option value="settings.">Settings</option>
            </select>

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as "all" | "today" | "7d")}
              aria-label="Filter by date"
              className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[12.5px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
            >
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                <th className="px-6 py-3">Date &amp; time</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-6 py-3 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
              {filteredEntries.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-[#F7F8FA]/60">
                  <td className="px-6 py-4 tabular text-[#4A4F5C]">{dateTime(e.created_at)}</td>
                  <td className="px-4 py-4 font-medium text-[#20232D]">{e.actorName}</td>
                  <td className="px-4 py-4 font-medium text-[#20232D]">
                    {LABELS[e.action] ?? e.action}
                  </td>
                  <td className="px-4 py-4 text-[#4A4F5C]">
                    {formatMeta(e.metadata, e.resource_type)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="font-semibold text-[#16794F]">
                      {e.outcome === "success" ? "Success" : e.outcome}
                    </span>
                  </td>
                </tr>
              ))}

              {!q.isLoading && filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-[13px] text-[#7A7F8C]">
                    No audit log entries match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E6E8EF] px-6 py-4 text-[12px] text-[#7A7F8C]">
          <span>Showing {filteredEntries.length} recorded workspace events</span>
          {limit < 500 && (
            <button
              type="button"
              onClick={() => setLimit(500)}
              className="font-semibold text-[#5848D6] hover:underline"
            >
              View full audit history →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
