"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { apiFetch } from "@/lib/api-client";
import { useMe } from "@/lib/auth";
import { dateTime, formatMoney, sanitizeSpreadsheetCell } from "@/lib/format";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = (day + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  return copy;
}

type ReportRow = {
  id: string;
  status: "finalized" | "cancelled";
  receipt_number: string | null;
  customer_name: string;
  total: string | number;
  currency: string;
  finalized_at: string | null;
  print_count: number;
  clients: { name: string } | null;
};

type DashboardOverview = {
  currency: string;
  drafts: number;
  new_clients_month: number;
  verify_stats?: {
    total: number;
    valid: number;
    invalid: number;
  };
};

export default function ReportsPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [preset, setPreset] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [from, setFrom] = useState(isoDate(firstOfMonth));
  const [to, setTo] = useState(isoDate(today));
  const [statusFilter, setStatusFilter] = useState<"finalized" | "cancelled" | "all">("finalized");
  const [detailTab, setDetailTab] = useState<"by-day" | "by-client" | "all">("by-day");

  function applyPreset(which: "daily" | "weekly" | "monthly") {
    const now = new Date();
    setPreset(which);
    if (which === "daily") {
      setFrom(isoDate(now));
      setTo(isoDate(now));
    } else if (which === "weekly") {
      setFrom(isoDate(startOfWeek(now)));
      setTo(isoDate(now));
    } else {
      setFrom(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTo(isoDate(now));
    }
  }

  const rows = useQuery({
    queryKey: ["reports", from, to, statusFilter, isAdmin],
    enabled: isAdmin,
    queryFn: () =>
      apiFetch<ReportRow[]>(`/api/reports?from=${from}&to=${to}&status=${statusFilter}`),
  });

  const dash = useQuery({
    queryKey: ["dashboard-stats", isAdmin],
    enabled: isAdmin,
    queryFn: () => apiFetch<DashboardOverview>("/api/dashboard"),
  });

  const data = rows.data ?? [];
  const finalized = data.filter((r) => r.status === "finalized");
  const totalValue = finalized.reduce((s, r) => s + Number(r.total), 0);
  const avgValue = finalized.length ? totalValue / finalized.length : 0;
  const currency = dash.data?.currency || data[0]?.currency || "KES";

  const byDay = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const r of finalized) {
      const day = (r.finalized_at ?? "").slice(0, 10);
      if (!day) continue;
      const cur = map.get(day) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(r.total);
      map.set(day, cur);
    }
    return Array.from(map.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [finalized]);

  const byClient = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    for (const r of finalized) {
      const name = r.clients?.name ?? r.customer_name;
      const cur = map.get(name) ?? { name, count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(r.total);
      map.set(name, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [finalized]);

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">Reports</h1>
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 text-[13.5px] text-[#7A7F8C]">
          Revenue totals and exportable analytics are available to workspace administrators. You can
          browse and search individual receipts on the{" "}
          <Link href="/receipts" className="font-semibold text-[#5848D6] hover:underline">
            Receipts page →
          </Link>
        </div>
      </div>
    );
  }

  function exportExcel(sheetKind: "all" | "revenue" | "clients" = "all") {
    const wb = XLSX.utils.book_new();
    const receiptSheet = XLSX.utils.json_to_sheet(
      data.map((r) => ({
        ReceiptNumber: sanitizeSpreadsheetCell(r.receipt_number ?? ""),
        Status: sanitizeSpreadsheetCell(r.status),
        Client: sanitizeSpreadsheetCell(r.clients?.name ?? r.customer_name),
        IssuedAt: sanitizeSpreadsheetCell(r.finalized_at ?? ""),
        Total: Number(r.total),
        Currency: sanitizeSpreadsheetCell(r.currency),
        Prints: r.print_count,
      })),
    );
    const daySheet = XLSX.utils.json_to_sheet(
      byDay.map((d) => ({
        Date: sanitizeSpreadsheetCell(d.day),
        Receipts: d.count,
        Total: Math.round(d.total * 100) / 100,
        Currency: sanitizeSpreadsheetCell(currency),
      })),
    );
    const clientSheet = XLSX.utils.json_to_sheet(
      byClient.map((c) => ({
        Client: sanitizeSpreadsheetCell(c.name),
        Receipts: c.count,
        Total: Math.round(c.total * 100) / 100,
        Currency: sanitizeSpreadsheetCell(currency),
      })),
    );

    if (sheetKind === "revenue") {
      XLSX.utils.book_append_sheet(wb, daySheet, "By Day");
      XLSX.utils.book_append_sheet(wb, receiptSheet, "Receipts");
    } else if (sheetKind === "clients") {
      XLSX.utils.book_append_sheet(wb, clientSheet, "By Client");
      XLSX.utils.book_append_sheet(wb, receiptSheet, "Receipts");
    } else {
      XLSX.utils.book_append_sheet(wb, receiptSheet, "Receipts");
      XLSX.utils.book_append_sheet(wb, daySheet, "By Day");
      XLSX.utils.book_append_sheet(wb, clientSheet, "By Client");
    }
    XLSX.writeFile(wb, `folio-reports-${sheetKind}-${from}-to-${to}.xlsx`);
  }

  const chartDays = byDay.slice(-10);
  const maxDayTotal = Math.max(1, ...chartDays.map((d) => d.total));
  const verifyTotal = dash.data?.verify_stats?.total ?? 0;
  const verifyValid = dash.data?.verify_stats?.valid ?? 0;
  const verifyInvalid = dash.data?.verify_stats?.invalid ?? 0;
  const verifyRate = verifyTotal > 0 ? ((verifyValid / verifyTotal) * 100).toFixed(1) : "100.0";
  const verifyBarPct = verifyTotal > 0 ? Math.max(8, Math.round((verifyValid / verifyTotal) * 100)) : 100;

  return (
    <div className="space-y-6">
      {/* Header matching 08 · Reports.svg */}
      <div className="no-print flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">Reports</h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Turn everyday transactions into useful insights.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => exportExcel("all")}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            <Download className="h-4 w-4 text-[#7A7F8C]" />
            Export Excel
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            <Printer className="h-4 w-4 text-[#7A7F8C]" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Period Filter Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#E6E8EF] bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg bg-[#F3F4F8] p-1 text-[12.5px]">
            {(["daily", "weekly", "monthly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded-md px-3.5 py-1.5 font-medium capitalize transition-all ${
                  preset === p
                    ? "bg-white font-semibold text-[#5848D6] shadow-2xs"
                    : "text-[#7A7F8C] hover:text-[#20232D]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <span className="text-[12.5px] font-medium text-[#7A7F8C]">
            {preset === "monthly" ? "Month to date" : preset === "weekly" ? "Week to date" : "Today"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            value={from}
            aria-label="Report start date"
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[12.5px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
          />
          <span className="text-[12px] text-[#7A7F8C]">–</span>
          <input
            type="date"
            value={to}
            aria-label="Report end date"
            onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[12.5px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
          />
          <select
            value={statusFilter}
            aria-label="Status filter"
            onChange={(e) => setStatusFilter(e.target.value as "finalized" | "cancelled" | "all")}
            className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-2.5 text-[12.5px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
          >
            <option value="finalized">Finalized only</option>
            <option value="cancelled">Cancelled only</option>
            <option value="all">Finalized + Cancelled</option>
          </select>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Revenue</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {formatMoney(totalValue, currency)}
          </p>
          <p className="mt-2.5 text-[11.5px] font-semibold text-[#16794F]">
            ↗ {finalized.length} finalized in range
          </p>
        </div>

        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Finalized receipts</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {finalized.length}
          </p>
          <p className="mt-2.5 text-[11.5px] text-[#7A7F8C]">
            {dash.data?.drafts ?? 0} drafts excluded
          </p>
        </div>

        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Average receipt</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {formatMoney(avgValue, currency)}
          </p>
          <p className="mt-2.5 text-[11.5px] text-[#7A7F8C]">Based on finalized receipts</p>
        </div>

        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">New clients</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {dash.data?.new_clients_month ?? byClient.length}
          </p>
          <p className="mt-2.5 text-[11.5px] text-[#7A7F8C]">
            {byClient.length} active clients in period
          </p>
        </div>
      </div>

      {/* Middle Section: Revenue by Day Bar Chart (8 cols) + Verification Health Card (4 cols) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Revenue by Day */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 lg:col-span-8">
          <h2 className="font-display text-[16px] font-bold text-[#20232D]">Revenue by day</h2>
          <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
            {from} – {to} · {currency}
          </p>

          <div className="mt-6">
            {chartDays.length > 0 ? (
              <>
                <div className="grid grid-cols-10 items-end gap-3 h-48 border-b border-[#E6E8EF] pt-4">
                  {chartDays.map((d, idx) => {
                    const isLast = idx === chartDays.length - 1;
                    const heightPct = Math.max(12, Math.round((d.total / maxDayTotal) * 100));
                    return (
                      <div
                        key={d.day}
                        title={`${d.day}: ${formatMoney(d.total, currency)} (${d.count} receipts)`}
                        className="group flex h-full flex-col items-center justify-end"
                      >
                        <div className="flex w-full flex-1 items-end justify-center">
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
                <div className="mt-2.5 grid grid-cols-10 gap-2 text-center text-[10.5px] text-[#7A7F8C]">
                  {chartDays.map((d) => (
                    <span key={d.day} className="truncate">
                      {d.day.slice(8, 10)}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-lg bg-[#F7F8FA] text-[13px] text-[#7A7F8C]">
                No finalized receipts in the selected date range.
              </div>
            )}
          </div>
        </div>

        {/* Verification Health Card */}
        <div className="flex flex-col justify-between rounded-xl border border-[#E6E8EF] bg-white p-6 lg:col-span-4">
          <div>
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Verification health</h2>
            <p className="mt-0.5 text-[12px] text-[#7A7F8C]">This period&apos;s receipt checks</p>

            <p className="mt-6 font-display text-[36px] font-extrabold tracking-tight tabular text-[#20232D]">
              {verifyTotal}
            </p>
            <p className="text-[12.5px] text-[#7A7F8C]">total verification attempts</p>

            <div className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-[#F6D2D6]">
              <div
                style={{ width: `${verifyBarPct}%` }}
                className="h-full rounded-full bg-[#5848D6]"
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-[12.5px] font-semibold">
              <span className="text-[#16794F]">{verifyValid} valid</span>
              <span className="text-[#B4343B]">{verifyInvalid} invalid</span>
            </div>
          </div>

          <p className="mt-6 text-[12px] text-[#7A7F8C]">
            {verifyRate}% verified successfully
          </p>
        </div>
      </div>

      {/* Report Library Card matching 08 · Reports.svg */}
      <div className="no-print rounded-xl border border-[#E6E8EF] bg-white p-6">
        <h2 className="font-display text-[16px] font-bold text-[#20232D]">Report library</h2>
        <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
          Export the detail behind your numbers.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-[#E6E8EF] p-4">
            <div>
              <p className="text-[13.5px] font-bold text-[#20232D]">Receipt reports</p>
              <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
                Daily, weekly, and monthly receipt detail
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportExcel("all")}
              className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
            >
              Export ↓
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#E6E8EF] p-4">
            <div>
              <p className="text-[13.5px] font-bold text-[#20232D]">Revenue reports</p>
              <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
                Revenue totals and period comparisons
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportExcel("revenue")}
              className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
            >
              Export ↓
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#E6E8EF] p-4">
            <div>
              <p className="text-[13.5px] font-bold text-[#20232D]">Client transactions</p>
              <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
                Client spending and transaction history
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportExcel("clients")}
              className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
            >
              Export ↓
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#E6E8EF] p-4">
            <div>
              <p className="text-[13.5px] font-bold text-[#20232D]">Verification reports</p>
              <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
                Valid / invalid checks and receipt activity
              </p>
            </div>
            <Link
              href="/activity"
              className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
            >
              Export ↓
            </Link>
          </div>
        </div>
      </div>

      {/* Detailed Ledger Breakdown Tabs */}
      <div className="rounded-xl border border-[#E6E8EF] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8EF] px-6 py-4">
          <h3 className="font-display text-[15px] font-bold text-[#20232D]">Detailed breakdown</h3>
          <div className="inline-flex rounded-lg bg-[#F3F4F8] p-1 text-[12px]">
            {(
              [
                ["by-day", "By day"],
                ["by-client", "By client"],
                ["all", `All receipts (${data.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDetailTab(key)}
                className={`rounded-md px-3 py-1 font-medium transition-all ${
                  detailTab === key
                    ? "bg-white font-semibold text-[#5848D6] shadow-2xs"
                    : "text-[#7A7F8C] hover:text-[#20232D]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          {detailTab === "by-day" && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Receipts</th>
                  <th className="px-6 py-3 text-right">Total revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {byDay.map((d) => (
                  <tr key={d.day}>
                    <td className="px-6 py-3.5 font-mono text-[#20232D]">{d.day}</td>
                    <td className="px-4 py-3.5 text-right tabular text-[#4A4F5C]">{d.count}</td>
                    <td className="px-6 py-3.5 text-right font-semibold tabular text-[#20232D]">
                      {formatMoney(d.total, currency)}
                    </td>
                  </tr>
                ))}
                {byDay.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-[#7A7F8C]">
                      No finalized receipts in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {detailTab === "by-client" && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                  <th className="px-6 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Receipts</th>
                  <th className="px-6 py-3 text-right">Total spending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {byClient.map((c) => (
                  <tr key={c.name}>
                    <td className="px-6 py-3.5 font-semibold text-[#20232D]">{c.name}</td>
                    <td className="px-4 py-3.5 text-right tabular text-[#4A4F5C]">{c.count}</td>
                    <td className="px-6 py-3.5 text-right font-semibold tabular text-[#20232D]">
                      {formatMoney(c.total, currency)}
                    </td>
                  </tr>
                ))}
                {byClient.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-[#7A7F8C]">
                      No finalized receipts in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {detailTab === "all" && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                  <th className="px-6 py-3">Receipt number</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {data.map((r) => (
                  <tr key={r.id}>
                    <td className="px-6 py-3.5">
                      <Link
                        href={`/receipts/${r.id}`}
                        className="font-semibold text-[#5848D6] hover:underline"
                      >
                        {r.receipt_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-[#20232D]">
                      {r.clients?.name ?? r.customer_name}
                    </td>
                    <td className="px-4 py-3.5 text-[#4A4F5C]">{dateTime(r.finalized_at)}</td>
                    <td className="px-4 py-3.5 capitalize">{r.status}</td>
                    <td className="px-6 py-3.5 text-right font-semibold tabular text-[#20232D]">
                      {formatMoney(r.total, r.currency)}
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-[#7A7F8C]">
                      No receipts in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
