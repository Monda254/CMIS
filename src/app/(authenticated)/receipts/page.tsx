"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Download,
  FileDown,
  MoreHorizontal,
  Plus,
  Printer,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatMoney, sanitizeSpreadsheetCell } from "@/lib/format";

type ReceiptRow = {
  id: string;
  status: "draft" | "finalized" | "cancelled";
  receipt_number: string | null;
  verification_code?: string | null;
  client_id?: string | null;
  customer_name: string;
  total: string | number;
  currency: string;
  finalized_at: string | null;
  created_at: string;
  print_count: number;
  clients?: { name: string } | null;
};

const PAGE_SIZE = 10;

export default function ReceiptsListPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-[#7A7F8C]">Loading receipts…</div>}>
      <ReceiptsListContent />
    </Suspense>
  );
}

function ReceiptsListContent() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const clientFilter = searchParams.get("client") ?? undefined;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["receipts", clientFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "500" });
      if (clientFilter) params.set("client", clientFilter);
      const res = await fetch(`/api/receipts?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load receipts");
      return (await res.json()) as ReceiptRow[];
    },
  });

  const allRows = list.data ?? [];
  const totalCount = allRows.length;
  const finalizedCount = allRows.filter((r) => r.status === "finalized").length;
  const draftsCount = allRows.filter((r) => r.status === "draft").length;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const now = new Date();
    return allRows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (dateFilter !== "all") {
        const dt = new Date(r.finalized_at ?? r.created_at);
        if (dateFilter === "today") {
          if (dt.toDateString() !== now.toDateString()) return false;
        } else if (dateFilter === "month") {
          if (dt.getMonth() !== now.getMonth() || dt.getFullYear() !== now.getFullYear()) return false;
        } else if (dateFilter === "30d") {
          if (now.getTime() - dt.getTime() > 30 * 24 * 60 * 60 * 1000) return false;
        }
      }
      if (!s) return true;
      return (
        (r.receipt_number ?? "draft").toLowerCase().includes(s) ||
        (r.verification_code ?? "").toLowerCase().includes(s) ||
        r.customer_name.toLowerCase().includes(s) ||
        (r.clients?.name ?? "").toLowerCase().includes(s)
      );
    });
  }, [allRows, q, status, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const handleDuplicate = async (receiptId: string) => {
    try {
      setOpenMenuId(null);
      const res = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "duplicate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not duplicate receipt");
      toast.success("Duplicated as a new draft receipt");
      await qc.invalidateQueries({ queryKey: ["receipts"] });
      router.push(`/receipts/${data.id}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to duplicate receipt");
    }
  };

  const handleExportCsv = () => {
    const headers = ["Receipt Number", "Client", "Verification Code", "Issued Date", "Amount", "Currency", "Status"];
    const lines = [
      headers.join(","),
      ...filtered.map((r) =>
        [
          sanitizeSpreadsheetCell(r.receipt_number ?? "Draft"),
          sanitizeSpreadsheetCell(r.customer_name),
          sanitizeSpreadsheetCell(r.verification_code ?? "Not issued yet"),
          sanitizeSpreadsheetCell(formatDate(r.finalized_at ?? r.created_at)),
          Number(r.total).toFixed(2),
          sanitizeSpreadsheetCell(r.currency),
          sanitizeSpreadsheetCell(r.status),
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipts-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">Receipts</h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Every receipt. Organized, protected, and easy to find.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            <Download className="h-4 w-4 text-[#7A7F8C]" />
            Export
          </button>

          <Link
            href="/receipts/new"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2]"
          >
            <Plus className="h-4 w-4" />
            Create receipt
          </Link>
        </div>
      </div>

      {/* 3 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">All receipts</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {totalCount}
          </p>
        </div>

        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Finalized</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {finalizedCount}
          </p>
        </div>

        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Drafts</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {draftsCount}
          </p>
        </div>
      </div>

      {/* Main Receipts Table Card */}
      <div className="rounded-xl border border-[#E6E8EF] bg-white">
        <div className="p-6 space-y-4">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">All receipts</h2>
            <span className="text-[12.5px] text-[#7A7F8C]">{filtered.length} receipts</span>
            {clientFilter && (
              <Link
                href="/receipts"
                className="ml-2 text-[12px] font-semibold text-[#5848D6] hover:underline"
              >
                Clear client filter ×
              </Link>
            )}
          </div>

          {/* Filter Bar */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-5">
              <input
                type="text"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search receipt no., verification code, or client"
                className="h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
              />
            </div>

            <div className="md:col-span-3">
              <select
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="Date range filter"
                className="h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="all">All dates</option>
                <option value="month">This month</option>
                <option value="30d">Last 30 days</option>
                <option value="today">Issued today</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                aria-label="Receipt status filter"
                className="h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="all">All statuses</option>
                <option value="finalized">Finalized</option>
                <option value="draft">Draft</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                  setDateFilter("all");
                  setPage(1);
                }}
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] transition-colors hover:bg-[#F7F8FA]"
              >
                <RotateCcw className="h-3.5 w-3.5 text-[#7A7F8C]" />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                <th className="px-6 py-3">Receipt number</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Verification code</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
              {pageRows.map((r) => {
                const href = r.status === "draft" ? `/receipts/${r.id}/edit` : `/receipts/${r.id}`;
                return (
                  <tr key={r.id} className="transition-colors hover:bg-[#F7F8FA]/60">
                    <td className="px-6 py-4">
                      <Link href={href} className="font-medium text-[#5848D6] hover:underline">
                        {r.receipt_number ?? `Draft (${r.id.slice(0, 6)})`}
                      </Link>
                    </td>
                    <td className="px-4 py-4 font-medium text-[#20232D]">
                      {r.client_id ? (
                        <Link href={`/clients/${r.client_id}`} className="hover:text-[#5848D6] hover:underline">
                          {r.customer_name}
                        </Link>
                      ) : (
                        r.customer_name
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {r.verification_code ? (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(r.verification_code!);
                            toast.success("Verification code copied");
                          }}
                          className="group inline-flex items-center gap-1.5 font-mono text-[12.5px] text-[#20232D] hover:text-[#5848D6]"
                        >
                          <span>{r.verification_code}</span>
                          <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      ) : (
                        <span className="text-[#7A7F8C]">Not issued yet</span>
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
                    <td className="relative px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          href={href}
                          className="text-[12.5px] font-medium text-[#20232D] hover:text-[#5848D6]"
                        >
                          {r.status === "draft" ? "Edit" : "View"}
                        </Link>
                        <span className="text-[#C4C8D4]">·</span>
                        <button
                          type="button"
                          onClick={() => setOpenMenuId(openMenuId === r.id ? null : r.id)}
                          aria-label="Receipt actions"
                          className="rounded-md p-1 text-[#4A4F5C] hover:bg-[#F3F4F8] hover:text-[#20232D]"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>

                      {openMenuId === r.id && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setOpenMenuId(null)} />
                          <div className="absolute right-6 z-30 mt-1 w-48 rounded-xl border border-[#E6E8EF] bg-white p-1.5 text-left shadow-lg">
                            {r.status !== "draft" && (
                              <>
                                <Link
                                  href={`/receipts/${r.id}/print`}
                                  onClick={() => setOpenMenuId(null)}
                                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                                >
                                  <Printer className="h-3.5 w-3.5 text-[#7A7F8C]" />
                                  Print preview
                                </Link>
                                <a
                                  href={`/api/receipts/${r.id}/pdf`}
                                  onClick={() => setOpenMenuId(null)}
                                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                                >
                                  <FileDown className="h-3.5 w-3.5 text-[#7A7F8C]" />
                                  Download PDF
                                </a>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDuplicate(r.id)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                            >
                              <Copy className="h-3.5 w-3.5 text-[#5848D6]" />
                              Duplicate as new draft
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!list.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-[13px] text-[#7A7F8C]">
                    No receipts match your current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E6E8EF] px-6 py-4">
          <p className="text-[12.5px] text-[#7A7F8C]">
            {filtered.length === 0
              ? "Showing 0 receipts"
              : `Showing ${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, filtered.length)} of ${filtered.length} receipts`}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex h-9 items-center rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[12.5px] font-semibold text-[#20232D] transition-colors hover:bg-[#F7F8FA] disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex h-9 items-center rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[12.5px] font-semibold text-[#20232D] transition-colors hover:bg-[#F7F8FA] disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Security Note */}
      <p className="text-[12px] text-[#7A7F8C]">
        Finalized receipts are locked. Use the action menu to reprint, download PDF, or duplicate as a new draft.
      </p>
    </div>
  );
}
