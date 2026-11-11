"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Copy,
  FileText,
  MoreHorizontal,
  Plus,
  Printer,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useMe } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

type Stats = {
  currency: string;
  company_name: string;
  clients: number;
  new_clients_month: number;
  issued: number;
  drafts: number;
  cancelled: number;
  value_total: number | null;
  today_count: number;
  today_value: number | null;
  month_count: number;
  month_value: number | null;
  daily: { day: string; value: number; count: number }[] | null;
  verify_stats?: {
    total: number;
    valid: number;
    invalid: number;
    recent: { id: number; identifier: string; result: string; created_at: string }[];
  };
  recent_clients?: {
    id: string;
    name: string;
    phone: string;
    address: string;
    receipt_count: number;
    total_spending: number | null;
  }[];
};

type RecentReceipt = {
  id: string;
  receipt_number: string | null;
  verification_code?: string | null;
  client_id?: string | null;
  status: "draft" | "finalized" | "cancelled";
  customer_name: string;
  total: string | number;
  currency: string;
  finalized_at: string | null;
  created_at: string;
};

export default function DashboardPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const [viewMode, setViewMode] = useState<"folio" | "executive">("folio");
  const [quickCode, setQuickCode] = useState("");
  const [quickVerifying, setQuickVerifying] = useState(false);
  const [quickResult, setQuickResult] = useState<{
    result: string;
    receipt_number?: string;
    customer?: string;
    total?: number;
    currency?: string;
  } | null>(null);

  const stats = useQuery({
    queryKey: ["dashboard-stats", isAdmin],
    queryFn: async () => {
      const res = await fetch("/api/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard stats");
      return (await res.json()) as Stats;
    },
  });

  const recent = useQuery({
    queryKey: ["recent-receipts"],
    queryFn: async () => {
      const res = await fetch("/api/receipts?limit=8", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load recent receipts");
      return (await res.json()) as RecentReceipt[];
    },
  });

  const currency = stats.data?.currency || recent.data?.[0]?.currency || "KES";
  const dailySeries = (stats.data?.daily ?? []).slice(-10);
  const maxDailyValue = Math.max(1, ...dailySeries.map((d) => d.value));

  const handleQuickVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCode.trim()) return;
    setQuickVerifying(true);
    try {
      const res = await fetch("/api/public/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: quickCode.trim() }),
      });
      const data = await res.json();
      setQuickResult(data);
    } catch {
      setQuickResult({ result: "invalid" });
    } finally {
      setQuickVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Actions */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">Overview</h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">Your business, at a glance.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Switcher (Folio vs Executive Stitch) */}
          <div className="inline-flex rounded-lg border border-[#E6E8EF] bg-white p-0.5 text-[12px]">
            <button
              type="button"
              onClick={() => setViewMode("folio")}
              className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                viewMode === "folio"
                  ? "bg-[#EEECFC] font-semibold text-[#5848D6]"
                  : "text-[#7A7F8C] hover:text-[#20232D]"
              }`}
            >
              Folio
            </button>
            <button
              type="button"
              onClick={() => setViewMode("executive")}
              className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                viewMode === "executive"
                  ? "bg-[#091426] font-semibold text-white"
                  : "text-[#7A7F8C] hover:text-[#20232D]"
              }`}
            >
              Executive
            </button>
          </div>

          <Link
            href="/reports"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            <ArrowUpRight className="h-4 w-4 text-[#7A7F8C]" />
            View reports
          </Link>

          <Link
            href="/receipts/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2]"
          >
            <Plus className="h-4 w-4" />
            Create receipt
          </Link>
        </div>
      </div>

      {/* 4 KPI Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Revenue */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Total revenue</p>
          <p className="mt-2.5 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {isAdmin && stats.data?.value_total !== null && stats.data?.value_total !== undefined
              ? formatMoney(stats.data.value_total, currency)
              : `${stats.data?.issued ?? 0} issued`}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-[#16794F]">
              ↗ {stats.data?.month_count ?? 0} receipts
            </span>
            <span className="text-[#7A7F8C]">this month</span>
          </div>
        </div>

        {/* Card 2: Receipts Issued */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Receipts issued</p>
          <p className="mt-2.5 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {stats.data?.issued ?? 0}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-[#16794F]">
              ↗ {stats.data?.drafts ?? 0} drafts
            </span>
            <span className="text-[#7A7F8C]">in progress</span>
          </div>
        </div>

        {/* Card 3: Total Clients */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Total clients</p>
          <p className="mt-2.5 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {stats.data?.clients ?? 0}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-[#16794F]">
              + {stats.data?.new_clients_month ?? 0} new
            </span>
            <span className="text-[#7A7F8C]">this month</span>
          </div>
        </div>

        {/* Card 4: Today's Revenue */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Today&apos;s revenue</p>
          <p className="mt-2.5 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {isAdmin && stats.data?.today_value !== null && stats.data?.today_value !== undefined
              ? formatMoney(stats.data.today_value, currency)
              : `${stats.data?.today_count ?? 0}`}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-[#16794F]">
              {stats.data?.today_count ?? 0} receipts
            </span>
            <span className="text-[#7A7F8C]">issued today</span>
          </div>
        </div>
      </div>

      {/* Middle Section: Revenue Overview Chart (8 cols) + Trust Card (4 cols) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Revenue Overview Bar Chart */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-[16px] font-bold text-[#20232D]">Revenue overview</h2>
              <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">A steady month for your business.</p>
            </div>
            <div className="rounded-lg border border-[#E6E8EF] bg-white px-3 py-1.5 text-[12px] font-medium text-[#20232D]">
              Last 10 days
            </div>
          </div>

          <div className="mt-4 flex items-baseline gap-3">
            <span className="font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
              {isAdmin && stats.data?.month_value !== null && stats.data?.month_value !== undefined
                ? formatMoney(stats.data.month_value, currency)
                : `${stats.data?.month_count ?? 0} finalized`}
            </span>
            <span className="text-[12px] font-semibold text-[#16794F]">
              ↗ {stats.data?.month_count ?? 0} issued this month
            </span>
          </div>

          {/* Vertical Bar Chart */}
          <div className="mt-6">
            {dailySeries.length > 0 ? (
              <div className="grid grid-cols-10 items-end gap-3 pt-4 h-44 border-b border-[#E6E8EF]">
                {dailySeries.map((d, idx) => {
                  const isLast = idx === dailySeries.length - 1;
                  const heightPct = Math.max(12, Math.round((d.value / maxDailyValue) * 100));
                  const label = new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, {
                    month: "short",
                    day: "2-digit",
                  });
                  return (
                    <div
                      key={d.day}
                      title={`${label}: ${formatMoney(d.value, currency)} (${d.count} receipts)`}
                      className="group flex h-full flex-col items-center justify-end gap-2"
                    >
                      <div className="relative flex w-full flex-1 items-end justify-center">
                        <div
                          style={{ height: `${heightPct}%` }}
                          className={`w-full max-w-[28px] rounded-t-md transition-all ${
                            isLast
                              ? "bg-[#5848D6]"
                              : "bg-[#B8B0F2] group-hover:bg-[#5848D6]/80"
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center rounded-lg bg-[#F7F8FA] text-[13px] text-[#7A7F8C]">
                Daily revenue breakdown is visible for administrators once receipts are finalized.
              </div>
            )}

            {dailySeries.length > 0 && (
              <div className="mt-2.5 grid grid-cols-10 gap-2 text-center text-[10.5px] text-[#7A7F8C]">
                {dailySeries.map((d) => {
                  const label = new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, {
                    month: "short",
                    day: "2-digit",
                  });
                  return (
                    <span key={d.day} className="truncate">
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Trust Built-In Card */}
        <div className="flex flex-col justify-between rounded-xl bg-[#EEECFC] p-6 lg:col-span-4">
          <div>
            <p className="text-[11px] font-bold tracking-[0.06em] text-[#5848D6] uppercase">
              Trust, built in
            </p>
            <h2 className="mt-2.5 font-display text-[22px] font-bold leading-snug text-[#20232D]">
              A receipt they can trust.
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[#5E6373]">
              Every finalized receipt gets a unique code and QR verification. No second guessing.
            </p>
          </div>

          <div className="mt-6">
            <p className="font-display text-[36px] font-extrabold tracking-tight tabular text-[#5848D6]">
              {stats.data?.issued ?? 0}
            </p>
            <p className="text-[12.5px] font-medium text-[#20232D]">protected receipts</p>

            <div className="mt-5">
              <Link
                href="/verify"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-white/90"
              >
                Verify a receipt
                <ArrowUpRight className="h-3.5 w-3.5 text-[#5848D6]" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Executive Verification Banner & Telemetry Stream (Shown in Executive Mode) */}
      {viewMode === "executive" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="relative overflow-hidden rounded-xl bg-[#091426] p-6 text-white lg:col-span-8">
            <div className="relative z-10 flex flex-col justify-between gap-5 md:flex-row md:items-center">
              <div className="max-w-md">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-[#00A472]/20 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-[#34D399] uppercase">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verification Engine Online
                </div>
                <h3 className="mt-2 font-display text-[19px] font-bold">
                  Dual-Layer Cryptographic Guarantee
                </h3>
                <p className="mt-1 text-[12.5px] text-slate-300">
                  Every finalized receipt is locked with an immutable snapshot and verifiable 10-character code.
                </p>
              </div>

              <form onSubmit={handleQuickVerify} className="flex w-full max-w-sm gap-2">
                <input
                  type="text"
                  value={quickCode}
                  onChange={(e) => setQuickCode(e.target.value.toUpperCase())}
                  placeholder="Enter code (e.g. DTX7K9P2A5)..."
                  className="h-10 flex-1 rounded-lg border border-white/15 bg-white/10 px-3.5 font-mono text-[12.5px] text-white placeholder:text-slate-400 outline-none focus:border-[#5848D6]"
                />
                <button
                  type="submit"
                  disabled={quickVerifying}
                  className="h-10 shrink-0 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2] disabled:opacity-50"
                >
                  {quickVerifying ? "..." : "Verify"}
                </button>
              </form>
            </div>

            {quickResult && (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-white/15 bg-white/10 px-4 py-2.5 text-[12.5px]">
                {quickResult.result === "valid" ? (
                  <span className="flex items-center gap-2 text-[#34D399]">
                    <CheckCircle2 className="h-4 w-4" />
                    Authentic: <strong>{quickResult.receipt_number}</strong> · {quickResult.customer} ·{" "}
                    {formatMoney(quickResult.total ?? 0, quickResult.currency)}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-rose-300">
                    <ShieldAlert className="h-4 w-4" />
                    Status: {quickResult.result} — No active finalized receipt matched that code.
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setQuickResult(null)}
                  className="text-xs text-slate-300 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#E6E8EF] bg-white p-5 lg:col-span-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[14px] font-bold text-[#20232D]">
                Instant Verification Stream
              </h3>
              <span className="text-[11px] font-semibold text-[#16794F]">
                {stats.data?.verify_stats?.total ?? 0} checks
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {(stats.data?.verify_stats?.recent ?? []).length === 0 ? (
                <p className="py-4 text-center text-[12px] text-[#7A7F8C]">
                  No public verification checks recorded yet.
                </p>
              ) : (
                stats.data?.verify_stats?.recent.slice(0, 4).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded-lg bg-[#F7F8FA] px-3 py-2 text-[12px]"
                  >
                    <span className="font-mono font-semibold text-[#20232D]">{v.identifier}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                        v.result === "valid"
                          ? "bg-[#E8F6EE] text-[#16794F]"
                          : "bg-[#FCECEE] text-[#B4343B]"
                      }`}
                    >
                      {v.result === "valid" ? "Valid" : "Invalid"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Section: Recent Receipts (8 cols) + Recent Clients (4 cols) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Recent Receipts Table */}
        <div className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white lg:col-span-8">
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <h2 className="font-display text-[16px] font-bold text-[#20232D]">Recent receipts</h2>
              <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                The latest activity across your workspace.
              </p>
            </div>
            <Link
              href="/receipts"
              className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
            >
              View all →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-y border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                  <th className="px-6 py-3">Receipt / Client</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {(recent.data ?? []).slice(0, 6).map((r) => {
                  const href = r.status === "draft" ? `/receipts/${r.id}/edit` : `/receipts/${r.id}`;
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-[#F7F8FA]/60">
                      <td className="px-6 py-4">
                        <Link href={href} className="font-medium text-[#5848D6] hover:underline">
                          {r.receipt_number ?? "Draft"} · {r.customer_name}
                        </Link>
                        {viewMode === "executive" && r.verification_code && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(r.verification_code!);
                              toast.success("Verification code copied");
                            }}
                            className="ml-2 inline-flex items-center gap-1 rounded bg-[#F3F4F8] px-1.5 py-0.5 font-mono text-[10.5px] text-[#646977] hover:text-[#20232D]"
                          >
                            {r.verification_code}
                            <Copy className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-4 text-[#4A4F5C]">
                        {formatDate(r.finalized_at ?? r.created_at)}
                      </td>
                      <td className="px-4 py-4 font-semibold tabular text-[#20232D]">
                        {formatMoney(r.total, r.currency)}
                      </td>
                      <td className="px-4 py-4">
                        {r.status === "finalized" ? (
                          <span className="inline-flex items-center rounded-md bg-[#E8F6EE] px-2.5 py-1 text-[11.5px] font-semibold text-[#16794F]">
                            Finalized
                          </span>
                        ) : r.status === "draft" ? (
                          <span className="inline-flex items-center rounded-md bg-[#FCF3E3] px-2.5 py-1 text-[11.5px] font-semibold text-[#9A6316]">
                            Draft
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-[#FCECEE] px-2.5 py-1 text-[11.5px] font-semibold text-[#B4343B]">
                            Cancelled
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          {r.status !== "draft" && (
                            <Link
                              href={`/receipts/${r.id}/print`}
                              title="Print preview"
                              className="rounded-md p-1.5 text-[#7A7F8C] hover:bg-[#F3F4F8] hover:text-[#20232D]"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Link>
                          )}
                          <Link
                            href={href}
                            aria-label="Open receipt"
                            className="rounded-md p-1.5 text-[#4A4F5C] hover:bg-[#F3F4F8] hover:text-[#20232D]"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {recent.data && recent.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-[13px] text-[#7A7F8C]">
                      <FileText className="mx-auto mb-2 h-6 w-6 opacity-40" />
                      No receipts yet.{" "}
                      <Link href="/receipts/new" className="font-semibold text-[#5848D6] hover:underline">
                        Create your first receipt →
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Clients Card */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 lg:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Recent clients</h2>
            <Link
              href="/clients"
              className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
            >
              View all →
            </Link>
          </div>

          <div className="mt-4 divide-y divide-[#E6E8EF]">
            {(stats.data?.recent_clients ?? []).slice(0, 5).map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="flex items-center justify-between py-3.5 transition-colors hover:bg-[#F7F8FA]/50 -mx-2 px-2 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-[#20232D]">{client.name}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-[#7A7F8C]">
                    {client.phone || client.address || `${client.receipt_count} receipts`}
                  </p>
                </div>
                <span className="ml-3 shrink-0 text-[13.5px] font-bold tabular text-[#20232D]">
                  {isAdmin && client.total_spending !== null
                    ? formatMoney(client.total_spending, currency)
                    : `${client.receipt_count} rcpts`}
                </span>
              </Link>
            ))}

            {(stats.data?.recent_clients ?? []).length === 0 && (
              <p className="py-8 text-center text-[13px] text-[#7A7F8C]">
                Clients appear here automatically as you issue receipts.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
