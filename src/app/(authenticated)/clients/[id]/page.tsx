"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { useMe } from "@/lib/auth";
import { dateTime, errMsg, formatDate, formatMoney, sanitizeSpreadsheetCell } from "@/lib/format";

type ClientProfileResponse = {
  client: {
    id: string;
    name: string;
    phone: string;
    address: string;
    active: boolean;
    created_at: string;
    updated_at: string;
    updated_by_name: string;
  };
  stats: {
    currency: string;
    total_spending: number | null;
    receipt_count: number;
    total_records: number;
    last_transaction: string | null;
  };
  receipts: {
    id: string;
    status: "draft" | "finalized" | "cancelled";
    receipt_number: string | null;
    verification_code: string | null;
    total: string | number;
    currency: string;
    finalized_at: string | null;
    created_at: string;
  }[];
  activity: {
    id: number;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    actor_name: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }[];
};

function humanizeActivity(action: string): string {
  if (action === "receipt.finalized") return "Receipt finalized";
  if (action === "receipt.created") return "Receipt draft created";
  if (action === "receipt.draft_updated") return "Receipt draft updated";
  if (action === "receipt.printed" || action === "receipt.reprinted") return "Receipt downloaded / printed";
  if (action === "receipt.cancelled") return "Receipt cancelled";
  if (action === "client.updated") return "Client details updated";
  if (action === "client.created") return "Client profile created";
  return action;
}

export default function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const qc = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["client-profile", id],
    queryFn: () => apiFetch<ClientProfileResponse>(`/api/clients/${id}`),
  });

  if (q.isLoading) {
    return <p className="text-[13px] text-[#7A7F8C]">Loading client profile…</p>;
  }
  if (q.isError || !q.data) {
    return <p className="text-[13px] text-[#B4343B]">Could not load client profile.</p>;
  }

  const { client, stats, receipts, activity } = q.data;
  const sinceLabel = new Date(client.created_at).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const lastTxLabel = stats.last_transaction
    ? new Date(stats.last_transaction).toDateString() === new Date().toDateString()
      ? "Today"
      : formatDate(stats.last_transaction)
    : "—";

  function openEditModal() {
    setName(client.name);
    setPhone(client.phone);
    setAddress(client.address);
    setActive(client.active);
    setError(null);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Client name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/clients", {
        method: "PATCH",
        body: JSON.stringify({
          id: client.id,
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          active,
        }),
      });
      toast.success("Client details updated");
      setEditOpen(false);
      await qc.invalidateQueries({ queryKey: ["client-profile", id] });
      await qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  function handleExportHistory() {
    const headers = ["Receipt Number", "Date", "Amount", "Currency", "Status"];
    const lines = [
      headers.join(","),
      ...receipts.map((r) =>
        [
          sanitizeSpreadsheetCell(r.receipt_number ?? "Draft"),
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
    a.download = `client-${client.name.toLowerCase().replace(/\s+/g, "-")}-history.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header matching 06 · Client profile.svg */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Client profile
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Client details, receipts, and recent activity.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={openEditModal}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            Edit client
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

      {/* Main 2-Column Layout (4:8 split) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Profile Column (4 cols) */}
        <div className="space-y-5 lg:col-span-4">
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <p className="text-[10.5px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
              Client profile
            </p>
            <h2 className="mt-2.5 font-display text-[24px] font-bold tracking-tight text-[#20232D]">
              {client.name}
            </h2>
            <p className="mt-1 text-[12.5px] text-[#7A7F8C]">Client since {sinceLabel}</p>

            <hr className="my-5 border-[#E6E8EF]" />

            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
                  Phone number
                </p>
                <p className="mt-1 text-[13.5px] font-medium tabular text-[#20232D]">
                  {client.phone || "Not provided"}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
                  Account status
                </p>
                <p className="mt-1 text-[13.5px] font-medium text-[#20232D]">
                  {client.active ? "Active client" : "Archived client"}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
                  Address
                </p>
                <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-[#20232D]">
                  {client.address || "No billing address on file"}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">Client notes</h3>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-[#7A7F8C]">
              All finalized receipts for {client.name} are automatically linked to this profile and
              protected with cryptographic verification codes.
            </p>
            <p className="mt-5 text-[11px] text-[#7A7F8C]">
              Updated {formatDate(client.updated_at)} by {client.updated_by_name}
            </p>
          </div>
        </div>

        {/* Right Metrics, Transactions & Activity Column (8 cols) */}
        <div className="space-y-5 lg:col-span-8">
          {/* 3 KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
              <p className="text-[12px] font-medium text-[#7A7F8C]">Total spending</p>
              <p className="mt-2 font-display text-[24px] font-bold tracking-tight tabular text-[#20232D]">
                {isAdmin && stats.total_spending !== null
                  ? formatMoney(stats.total_spending, stats.currency)
                  : `${stats.receipt_count} receipts`}
              </p>
            </div>

            <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
              <p className="text-[12px] font-medium text-[#7A7F8C]">Receipts issued</p>
              <p className="mt-2 font-display text-[24px] font-bold tracking-tight tabular text-[#20232D]">
                {stats.receipt_count}
              </p>
            </div>

            <div className="rounded-xl border border-[#E6E8EF] bg-white p-5">
              <p className="text-[12px] font-medium text-[#7A7F8C]">Last transaction</p>
              <p className="mt-2 font-display text-[24px] font-bold tracking-tight text-[#20232D]">
                {lastTxLabel}
              </p>
            </div>
          </div>

          {/* Transaction History Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
              <div>
                <h2 className="font-display text-[16px] font-bold text-[#20232D]">
                  Transaction history
                </h2>
                <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
                  {receipts.length} receipts · Lifetime spending in {stats.currency}
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportHistory}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#5848D6] hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Export history
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-y border-[#E6E8EF] bg-[#F7F8FA] text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase">
                    <th className="px-6 py-3">Receipt number</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-6 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                  {receipts.slice(0, 8).map((r) => {
                    const href = r.status === "draft" ? `/receipts/${r.id}/edit` : `/receipts/${r.id}`;
                    return (
                      <tr key={r.id} className="transition-colors hover:bg-[#F7F8FA]/60">
                        <td className="px-6 py-4">
                          <Link href={href} className="font-semibold text-[#5848D6] hover:underline">
                            {r.receipt_number ?? "Draft receipt"}
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-[#4A4F5C]">
                          {formatDate(r.finalized_at ?? r.created_at)}
                        </td>
                        <td className="px-4 py-4 font-semibold tabular text-[#20232D]">
                          {formatMoney(r.total, r.currency)}
                        </td>
                        <td className="px-4 py-4 text-[#20232D] capitalize">{r.status}</td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={href}
                            className="text-[12.5px] font-semibold text-[#20232D] hover:text-[#5848D6]"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}

                  {receipts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-[13px] text-[#7A7F8C]">
                        No receipts issued for this client yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-[#E6E8EF] px-6 py-4">
              <Link
                href={`/receipts?client=${client.id}`}
                className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
              >
                View all {receipts.length} transactions →
              </Link>
            </div>
          </div>

          {/* Recent Activity Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Recent activity</h2>

            <div className="mt-4 divide-y divide-[#E6E8EF]">
              {activity.length === 0 ? (
                <p className="py-4 text-[13px] text-[#7A7F8C]">No recent activity recorded yet.</p>
              ) : (
                activity.slice(0, 5).map((item, idx) => (
                  <div key={item.id} className="flex items-start justify-between gap-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 h-2 w-2 rounded-full ${
                          idx === 0 ? "bg-[#5848D6]" : "bg-[#C4C8D4]"
                        }`}
                      />
                      <div>
                        <p className="text-[13px] font-semibold text-[#20232D]">
                          {humanizeActivity(item.action)}
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
                          {item.metadata && typeof item.metadata.receipt_number === "string"
                            ? `${item.metadata.receipt_number} · `
                            : ""}
                          Updated by {item.actor_name}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-[12px] text-[#7A7F8C]">
                      {dateTime(item.created_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Client Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#20232D]/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[17px] font-bold text-[#20232D]">Edit client</h3>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-lg p-1 text-[#7A7F8C] hover:bg-[#F3F4F8] hover:text-[#20232D]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Client name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
                />
              </div>

              <label className="flex items-center gap-2 text-[13px] font-medium text-[#20232D]">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 rounded border-[#E6E8EF] text-[#5848D6]"
                />
                Active client
              </label>

              {error && <p className="text-[12.5px] text-[#B4343B]">{error}</p>}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[12.5px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2] disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
