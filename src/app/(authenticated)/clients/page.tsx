"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { useMe } from "@/lib/auth";
import { errMsg, formatDate, formatMoney, sanitizeSpreadsheetCell } from "@/lib/format";

type ClientRow = {
  id: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
  created_at: string;
  receipt_count: number;
  total_spending: number | null;
  currency: string;
  last_activity: string;
};

const PAGE_SIZE = 10;

export default function ClientsPage() {
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "returning">("all");
  const [sortBy, setSortBy] = useState<"recent" | "spending" | "name">("recent");
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<ClientRow[]>("/api/clients"),
  });

  const allClients = list.data ?? [];
  const totalClients = allClients.length;
  const now = new Date();
  const newThisMonth = allClients.filter((c) => {
    const dt = new Date(c.created_at);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  }).length;
  const returningCount = allClients.filter((c) => c.receipt_count >= 2).length;
  const returningPct = totalClients > 0 ? Math.round((returningCount / totalClients) * 100) : 0;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const matches = allClients.filter((c) => {
      if (filterMode === "active" && !c.active) return false;
      if (filterMode === "returning" && c.receipt_count < 2) return false;
      if (!s) return true;
      return (
        c.name.toLowerCase().includes(s) ||
        c.phone.toLowerCase().includes(s) ||
        c.address.toLowerCase().includes(s)
      );
    });

    return [...matches].sort((a, b) => {
      if (sortBy === "recent") {
        return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
      }
      if (sortBy === "spending") {
        return (b.total_spending ?? 0) - (a.total_spending ?? 0);
      }
      return a.name.localeCompare(b.name);
    });
  }, [allClients, q, filterMode, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Client name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          active: true,
        }),
      });
      toast.success("Client added to your directory");
      setName("");
      setPhone("");
      setAddress("");
      setAddOpen(false);
      await qc.invalidateQueries({ queryKey: ["clients"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  function handleExportClients() {
    const headers = ["Client Name", "Phone Number", "Address", "Receipts", "Total Spending", "Last Activity"];
    const lines = [
      headers.join(","),
      ...filtered.map((c) =>
        [
          sanitizeSpreadsheetCell(c.name),
          sanitizeSpreadsheetCell(c.phone),
          sanitizeSpreadsheetCell(c.address),
          c.receipt_count,
          c.total_spending !== null ? c.total_spending.toFixed(2) : "0.00",
          sanitizeSpreadsheetCell(formatDate(c.last_activity)),
        ]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clients-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header matching 05 · Clients.svg */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">Clients</h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Good relationships start with a complete picture.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportClients}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            <Download className="h-4 w-4 text-[#7A7F8C]" />
            Export clients
          </button>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setAddOpen(true);
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2]"
          >
            <Plus className="h-4 w-4" />
            Add client
          </button>
        </div>
      </div>

      {/* 3 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Total clients</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {totalClients}
          </p>
          <p className="mt-2.5 text-[12px] text-[#7A7F8C]">All your relationships in one place</p>
        </div>

        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">New this month</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {newThisMonth}
          </p>
          <p className="mt-2.5 text-[12px] font-semibold text-[#16794F]">
            + {newThisMonth} added this month
          </p>
        </div>

        <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
          <p className="text-[12.5px] font-medium text-[#7A7F8C]">Returning clients</p>
          <p className="mt-2 font-display text-[26px] font-bold tracking-tight tabular text-[#20232D]">
            {returningCount}
          </p>
          <p className="mt-2.5 text-[12px] text-[#7A7F8C]">{returningPct}% of your client base</p>
        </div>
      </div>

      {/* All Clients Table Card */}
      <div className="rounded-xl border border-[#E6E8EF] bg-white">
        <div className="p-6 space-y-4">
          <div>
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">All clients</h2>
            <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
              Automatically connected to their receipts.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <input
                type="text"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by client name or phone number"
                className="h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
              />
            </div>

            <div className="md:col-span-3">
              <select
                value={filterMode}
                onChange={(e) => {
                  setFilterMode(e.target.value as "all" | "active" | "returning");
                  setPage(1);
                }}
                aria-label="Filter clients"
                className="h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="all">All clients</option>
                <option value="active">Active clients</option>
                <option value="returning">Returning clients (2+ receipts)</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "recent" | "spending" | "name")}
                aria-label="Sort clients"
                className="h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="recent">Recently active</option>
                <option value="spending">Highest spending</option>
                <option value="name">Name (A–Z)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-y border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                <th className="px-6 py-3">Client name</th>
                <th className="px-4 py-3">Phone number</th>
                <th className="px-4 py-3">Receipts</th>
                <th className="px-4 py-3">Total spending</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-6 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
              {pageRows.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-[#F7F8FA]/60">
                  <td className="px-6 py-4">
                    <Link
                      href={`/clients/${c.id}`}
                      className="font-semibold text-[#5848D6] hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-4 tabular text-[#4A4F5C]">{c.phone || "—"}</td>
                  <td className="px-4 py-4 tabular text-[#20232D]">{c.receipt_count}</td>
                  <td className="px-4 py-4 font-semibold tabular text-[#20232D]">
                    {isAdmin && c.total_spending !== null
                      ? formatMoney(c.total_spending, c.currency)
                      : `${c.receipt_count} finalized`}
                  </td>
                  <td className="px-4 py-4 text-[#4A4F5C]">{formatDate(c.last_activity)}</td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/clients/${c.id}`}
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#20232D] hover:text-[#5848D6]"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}

              {!list.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-[13px] text-[#7A7F8C]">
                    No clients found. Add a client or create a receipt to get started.
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
              ? "Showing 0 clients"
              : `Showing ${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, filtered.length)} of ${filtered.length} clients`}
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

      {/* Add Client Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#20232D]/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[17px] font-bold text-[#20232D]">Add client</h3>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-lg p-1 text-[#7A7F8C] hover:bg-[#F3F4F8] hover:text-[#20232D]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-[#7A7F8C]">
              Create a client record to connect future receipts and track spending.
            </p>

            <form onSubmit={handleCreateClient} className="mt-4 space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Client name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Olivia Rhye"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Phone number</label>
                <input
                  type="text"
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (212) 555-0148"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Address</label>
                <input
                  type="text"
                  maxLength={500}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="128 Crosby Street, New York, NY 10012"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
                />
              </div>

              {error && <p className="text-[12.5px] text-[#B4343B]">{error}</p>}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[12.5px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2] disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save client"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
