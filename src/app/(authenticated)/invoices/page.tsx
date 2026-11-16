"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CreditCard,
  Download,
  Eye,
  FileCheck2,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { computeLinePreview, ibmsApi } from "@/lib/api/client";
import type { InvoiceDTO, TaxConfigDTO } from "@/lib/api/types";
import { useMe } from "@/lib/auth";
import { errMsg, formatDate, formatMoney } from "@/lib/format";
import { hasPermission, isAdminUser } from "@/lib/permissions";
import { DocumentStatusBadge } from "@/components/status-badge";

type ClientOption = { id: string; name: string; phone: string; address: string };

type LineDraft = {
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_config_id: string;
  tax_rate: string;
};

export default function InvoicesPage() {
  const me = useMe();
  const qc = useQueryClient();
  const canWrite = hasPermission(me.data, "invoices:write");
  const canIssue = hasPermission(me.data, "invoices:issue");
  const isAdmin = isAdminUser(me.data);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDTO | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvoiceDTO | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busyAction, setBusyAction] = useState(false);

  // Create form state
  const [clientId, setClientId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [issueImmediately, setIssueImmediately] = useState(true);
  const [terms, setTerms] = useState("Payment due within 14 days via M-Pesa Paybill or Bank Transfer.");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { description: "", quantity: "1", unit_price: "", discount_amount: "0.00", tax_config_id: "", tax_rate: "0" },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const invoicesQuery = useQuery({
    queryKey: ["ibms-invoices", statusFilter],
    queryFn: () =>
      ibmsApi.invoices.list(
        statusFilter !== "all" ? `status=${encodeURIComponent(statusFilter)}&page_size=100` : "page_size=100",
      ),
  });

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<ClientOption[]>("/api/clients"),
  });

  const taxesQuery = useQuery({
    queryKey: ["ibms-taxes-active"],
    queryFn: () => ibmsApi.taxes.list(true),
  });

  const allInvoices = invoicesQuery.data?.data ?? [];
  const clients = clientsQuery.data ?? [];
  const taxes: TaxConfigDTO[] = taxesQuery.data?.data ?? [];

  const clientMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const kpis = useMemo(() => {
    let billedCents = 0;
    let allocatedCents = 0;
    let dueCents = 0;
    let overdueCount = 0;
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const inv of allInvoices) {
      if (["issued", "partially_paid", "paid", "overdue"].includes(inv.status)) {
        billedCents += Math.round(Number(inv.total) * 100);
        allocatedCents += Math.round(Number(inv.amount_allocated) * 100);
        dueCents += Math.round(Number(inv.balance_due) * 100);
        if (
          inv.status === "overdue" ||
          (Number(inv.balance_due) > 0 && inv.due_date && inv.due_date < todayStr)
        ) {
          overdueCount += 1;
        }
      }
    }
    return {
      totalBilled: (billedCents / 100).toFixed(2),
      totalAllocated: (allocatedCents / 100).toFixed(2),
      totalDue: (dueCents / 100).toFixed(2),
      overdueCount,
    };
  }, [allInvoices]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allInvoices;
    return allInvoices.filter((row) => {
      const snapName = ((row.client_snapshot as { name?: string } | null)?.name ?? "").toLowerCase();
      const cName = (clientMap.get(row.client_id) ?? "").toLowerCase();
      return (
        (row.invoice_number ?? "draft").toLowerCase().includes(q) ||
        snapName.includes(q) ||
        cName.includes(q) ||
        row.notes.toLowerCase().includes(q)
      );
    });
  }, [allInvoices, search, clientMap]);

  const previewTotals = useMemo(() => {
    let sub = 0;
    let tax = 0;
    let tot = 0;
    for (const l of lines) {
      const taxCfg = taxes.find((t) => t.id === l.tax_config_id);
      const p = computeLinePreview({
        quantity: l.quantity,
        unitPrice: l.unit_price,
        discountAmount: l.discount_amount,
        taxRate: taxCfg ? taxCfg.rate : l.tax_rate,
        isInclusive: taxCfg?.is_inclusive ?? false,
      });
      sub += Math.round(Number(p.subtotal) * 100);
      tax += Math.round(Number(p.taxAmount) * 100);
      tot += Math.round(Number(p.lineTotal) * 100);
    }
    return {
      subtotal: (sub / 100).toFixed(2),
      tax: (tax / 100).toFixed(2),
      total: (tot / 100).toFixed(2),
    };
  }, [lines, taxes]);

  async function handleCreateInvoice(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!clientId) {
      setFormError("Please select a client.");
      return;
    }
    const validLines = lines.filter((l) => l.description.trim() && Number(l.unit_price) >= 0 && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      setFormError("Please enter at least one valid line item.");
      return;
    }

    setBusyAction(true);
    try {
      const res = await ibmsApi.invoices.create({
        client_id: clientId,
        due_date: dueDate || null,
        issue_immediately: issueImmediately,
        terms: terms.trim(),
        notes: notes.trim(),
        items: validLines.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity).toFixed(3),
          unit_price: Number(l.unit_price).toFixed(2),
          discount_amount: Number(l.discount_amount || "0").toFixed(2),
          tax_config_id: l.tax_config_id || null,
          tax_rate: Number(l.tax_rate || "0").toFixed(4),
        })),
      });
      toast.success(res.message);
      setCreateOpen(false);
      setLines([{ description: "", quantity: "1", unit_price: "", discount_amount: "0.00", tax_config_id: "", tax_rate: "0" }]);
      await qc.invalidateQueries({ queryKey: ["ibms-invoices"] });
    } catch (err) {
      setFormError(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleIssueDraft(inv: InvoiceDTO) {
    setBusyAction(true);
    try {
      const res = await ibmsApi.invoices.issue(inv.id);
      toast.success(`Invoice ${res.data.invoice_number} issued`);
      setSelectedInvoice(res.data);
      await qc.invalidateQueries({ queryKey: ["ibms-invoices"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleCancelInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelTarget || cancelReason.trim().length < 3) return;
    setBusyAction(true);
    try {
      const res = await ibmsApi.invoices.cancel(cancelTarget.id, cancelReason.trim());
      toast.success("Invoice cancelled and recorded in audit trail");
      setCancelTarget(null);
      setCancelReason("");
      setSelectedInvoice(res.data);
      await qc.invalidateQueries({ queryKey: ["ibms-invoices"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Invoices & Accounts Receivable
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Track amounts billed, partial payment allocations, and outstanding client receivables.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/payments"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
          >
            <CreditCard className="h-4 w-4 text-[#16794F]" />
            Record / Allocate Payment
          </Link>
          {canWrite && (
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                if (!clientId && clients[0]) setClientId(clients[0].id);
                setCreateOpen(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-xs hover:bg-[#4C3EC2]"
            >
              <Plus className="h-4 w-4" />
              New Invoice
            </button>
          )}
        </div>
      </div>

      {/* Receivables Summary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Total Invoiced (Billed)</p>
          <p className="mt-1 font-display text-[22px] font-bold tabular text-[#20232D]">
            {formatMoney(kpis.totalBilled, "KES")}
          </p>
        </div>
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Settled via Allocations</p>
          <p className="mt-1 font-display text-[22px] font-bold tabular text-[#16794F]">
            {formatMoney(kpis.totalAllocated, "KES")}
          </p>
        </div>
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Outstanding Balance Due</p>
          <p className="mt-1 font-display text-[22px] font-bold tabular text-[#9A6316]">
            {formatMoney(kpis.totalDue, "KES")}
          </p>
        </div>
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Overdue Invoices</p>
          <p className="mt-1 font-display text-[22px] font-bold tabular text-[#BE123C]">
            {kpis.overdueCount}
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6E8EF] bg-white p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", "draft", "issued", "partially_paid", "paid", "overdue", "cancelled"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium capitalize transition-colors ${
                statusFilter === st
                  ? "bg-[#EEECFC] font-semibold text-[#5848D6]"
                  : "text-[#646977] hover:bg-[#F7F8FA] hover:text-[#20232D]"
              }`}
            >
              {st.replace("_", " ")}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice no., client, or notes..."
          aria-label="Search invoices"
          className="h-9 w-full rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] px-3 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6] sm:w-72"
        />
      </div>

      {/* Invoices Table */}
      <div className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white">
        {invoicesQuery.isLoading ? (
          <div className="p-8 text-center text-[13px] text-[#7A7F8C]">Loading invoices...</div>
        ) : invoicesQuery.isError ? (
          <div className="p-8 text-center text-[13px] text-[#B4343B]">
            Failed to load invoices: {errMsg(invoicesQuery.error)}
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center">
            <FileCheck2 className="mx-auto h-9 w-9 text-[#C4C8D4]" />
            <p className="mt-3 font-display text-[15px] font-bold text-[#20232D]">No invoices found</p>
            <p className="mt-1 text-[13px] text-[#7A7F8C]">
              Create an invoice or convert an accepted quotation to bill a client.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">
                  <th className="px-4 py-3">Invoice No.</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Issue / Due Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Invoice Total</th>
                  <th className="px-4 py-3 text-right">Paid / Allocated</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {filteredInvoices.map((inv) => {
                  const snapName = (inv.client_snapshot as { name?: string } | null)?.name;
                  const cName = snapName || clientMap.get(inv.client_id) || "Client";
                  return (
                    <tr key={inv.id} className="hover:bg-[#F7F8FA]/70">
                      <td className="px-4 py-3.5 font-mono font-semibold text-[#5848D6]">
                        {inv.invoice_number ?? "DRAFT"}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-[#20232D]">{cName}</td>
                      <td className="px-4 py-3.5 text-[12px] text-[#646977]">
                        <div>{formatDate(inv.issue_date)}</div>
                        {inv.due_date && <div className="text-[11px]">Due: {formatDate(inv.due_date)}</div>}
                      </td>
                      <td className="px-4 py-3.5">
                        <DocumentStatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold tabular text-[#20232D]">
                        {formatMoney(inv.total, inv.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular text-[#16794F]">
                        {formatMoney(inv.amount_allocated, inv.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold tabular text-[#9A6316]">
                        {formatMoney(inv.balance_due, inv.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedInvoice(inv)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#E6E8EF] bg-white px-2.5 py-1 text-[12px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                          >
                            <Eye className="h-3.5 w-3.5 text-[#7A7F8C]" />
                            View
                          </button>
                          <a
                            href={`/api/v1/invoices/${inv.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-[#E6E8EF] bg-white px-2 py-1 text-[12px] text-[#646977] hover:text-[#20232D]"
                            title="Download Invoice PDF"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Invoice Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E6E8EF] pb-4">
              <div>
                <h2 className="font-display text-[18px] font-bold text-[#20232D]">Create Invoice</h2>
                <p className="text-[12.5px] text-[#7A7F8C]">
                  Issued invoices lock in historical client and company snapshots automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1.5 text-[#7A7F8C] hover:bg-[#F3F4F8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateInvoice} className="mt-5 space-y-5">
              {formError && (
                <div role="alert" className="rounded-lg border border-[#F6D2D6] bg-[#FCECEE] px-4 py-3 text-[13px] text-[#B4343B]">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-semibold text-[#20232D]">Client *</label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    required
                    className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#20232D]">Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
                  />
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-semibold text-[#20232D]">Invoice Line Items *</label>
                  <button
                    type="button"
                    onClick={() =>
                      setLines([
                        ...lines,
                        { description: "", quantity: "1", unit_price: "", discount_amount: "0.00", tax_config_id: "", tax_rate: "0" },
                      ])
                    }
                    className="text-[12px] font-semibold text-[#5848D6] hover:underline"
                  >
                    + Add line item
                  </button>
                </div>

                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] p-3">
                    <div className="col-span-12 sm:col-span-4">
                      <label className="block text-[11px] text-[#7A7F8C]">Description</label>
                      <input
                        type="text"
                        required
                        value={line.description}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx] = { ...line, description: e.target.value };
                          setLines(next);
                        }}
                        placeholder="Item or service description..."
                        className="mt-1 h-9 w-full rounded border border-[#E6E8EF] bg-white px-2.5 text-[12.5px]"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className="block text-[11px] text-[#7A7F8C]">Qty</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0.001"
                        required
                        value={line.quantity}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx] = { ...line, quantity: e.target.value };
                          setLines(next);
                        }}
                        className="mt-1 h-9 w-full rounded border border-[#E6E8EF] bg-white px-2 text-[12.5px] tabular"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className="block text-[11px] text-[#7A7F8C]">Unit Price</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={line.unit_price}
                        onChange={(e) => {
                          const next = [...lines];
                          next[idx] = { ...line, unit_price: e.target.value };
                          setLines(next);
                        }}
                        placeholder="0.00"
                        className="mt-1 h-9 w-full rounded border border-[#E6E8EF] bg-white px-2 text-[12.5px] tabular"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <label className="block text-[11px] text-[#7A7F8C]">Tax Rule</label>
                      <select
                        value={line.tax_config_id}
                        onChange={(e) => {
                          const cfg = taxes.find((t) => t.id === e.target.value);
                          const next = [...lines];
                          next[idx] = {
                            ...line,
                            tax_config_id: e.target.value,
                            tax_rate: cfg ? cfg.rate : "0",
                          };
                          setLines(next);
                        }}
                        className="mt-1 h-9 w-full rounded border border-[#E6E8EF] bg-white px-2 text-[12px]"
                      >
                        <option value="">No Tax (0%)</option>
                        {taxes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({Number(t.rate).toFixed(1)}%{t.is_inclusive ? " Incl." : ""})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-12 flex justify-end sm:col-span-1">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                          className="rounded p-1.5 text-[#B4343B] hover:bg-[#FCECEE]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-[13px] font-medium text-[#20232D]">
                    <input
                      type="checkbox"
                      checked={issueImmediately}
                      onChange={(e) => setIssueImmediately(e.target.checked)}
                      className="h-4 w-4 rounded border-[#E6E8EF] text-[#5848D6]"
                    />
                    Issue invoice immediately (allocates sequential `INV-YYYY-NNNNNN`)
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Invoice notes or payment instructions..."
                    className="w-full rounded-lg border border-[#E6E8EF] p-2.5 text-[12.5px]"
                  />
                </div>
                <div className="rounded-xl border border-[#E6E8EF] bg-[#F7F8FA] p-4 text-[13px]">
                  <div className="flex justify-between text-[#646977]">
                    <span>Subtotal (Preview):</span>
                    <span className="tabular font-medium">KES {previewTotals.subtotal}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-[#646977]">
                    <span>Tax (Preview):</span>
                    <span className="tabular font-medium">KES {previewTotals.tax}</span>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-[#E6E8EF] pt-2 font-display text-[15px] font-bold text-[#20232D]">
                    <span>Invoice Total:</span>
                    <span className="tabular">KES {previewTotals.total}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 border-t border-[#E6E8EF] pt-4">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="h-10 rounded-lg border border-[#E6E8EF] px-4 text-[13px] font-medium text-[#646977]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction}
                  className="h-10 rounded-lg bg-[#5848D6] px-5 text-[13px] font-semibold text-white hover:bg-[#4C3EC2] disabled:opacity-50"
                >
                  {busyAction ? "Saving..." : issueImmediately ? "Create & Issue Invoice" : "Save Invoice Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E6E8EF] pb-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="font-display text-[18px] font-bold text-[#20232D]">
                    {selectedInvoice.invoice_number ?? "Draft Invoice"}
                  </h3>
                  <DocumentStatusBadge status={selectedInvoice.status} />
                </div>
                <p className="mt-1 text-[12.5px] text-[#7A7F8C]">
                  Client:{" "}
                  {(selectedInvoice.client_snapshot as { name?: string } | null)?.name ||
                    clientMap.get(selectedInvoice.client_id) ||
                    "Client"}{" "}
                  · Issued: {formatDate(selectedInvoice.issue_date)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="rounded-lg p-1.5 text-[#7A7F8C] hover:bg-[#F3F4F8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedInvoice.status !== "draft" && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] px-3.5 py-2.5 text-[12px] text-[#646977]">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#9A6316]" />
                <span>
                  This invoice is finalized and immutable. Historical client & company snapshots are locked.
                </span>
              </div>
            )}

            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-3 gap-3 rounded-xl border border-[#E6E8EF] bg-[#F7F8FA] p-3.5 text-center">
                <div>
                  <p className="text-[11px] font-semibold text-[#7A7F8C] uppercase">Invoice Total</p>
                  <p className="mt-0.5 font-display text-[16px] font-bold tabular text-[#20232D]">
                    {formatMoney(selectedInvoice.total, selectedInvoice.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#7A7F8C] uppercase">Allocated / Paid</p>
                  <p className="mt-0.5 font-display text-[16px] font-bold tabular text-[#16794F]">
                    {formatMoney(selectedInvoice.amount_allocated, selectedInvoice.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#7A7F8C] uppercase">Balance Due</p>
                  <p className="mt-0.5 font-display text-[16px] font-bold tabular text-[#9A6316]">
                    {formatMoney(selectedInvoice.balance_due, selectedInvoice.currency)}
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-[#E6E8EF]">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-[#F7F8FA] text-[11px] font-semibold text-[#7A7F8C] uppercase">
                    <tr>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right">Tax</th>
                      <th className="px-3 py-2 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E8EF]">
                    {selectedInvoice.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2.5 font-medium text-[#20232D]">{it.description}</td>
                        <td className="px-3 py-2.5 text-right tabular">{Number(it.quantity).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {formatMoney(it.unit_price, selectedInvoice.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {formatMoney(it.tax_amount, selectedInvoice.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular">
                          {formatMoney(it.line_total, selectedInvoice.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6E8EF] pt-4">
                <a
                  href={`/api/v1/invoices/${selectedInvoice.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E8EF] px-3.5 py-2 text-[12.5px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
                >
                  <Download className="h-4 w-4 text-[#5848D6]" />
                  Download A4 PDF
                </a>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedInvoice.status === "draft" && canIssue && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => handleIssueDraft(selectedInvoice)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2]"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Issue Invoice
                    </button>
                  )}
                  {["issued", "overdue"].includes(selectedInvoice.status) &&
                    Number(selectedInvoice.amount_allocated) === 0 &&
                    isAdmin && (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(selectedInvoice)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#F6D2D6] bg-[#FCECEE] px-3.5 py-2 text-[12.5px] font-semibold text-[#B4343B]"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Cancel Invoice
                      </button>
                    )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Cancel Invoice Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleCancelInvoice}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <h3 className="font-display text-[17px] font-bold text-[#B4343B]">
              Cancel Issued Invoice {cancelTarget.invoice_number}
            </h3>
            <p className="text-[13px] text-[#646977]">
              Cancelling an invoice preserves the historical record while removing its balance from active accounts receivable. A mandatory audit reason is required.
            </p>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Cancellation Reason *</label>
              <textarea
                required
                minLength={3}
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="State the reason for cancelling this invoice..."
                className="mt-1 w-full rounded-lg border border-[#E6E8EF] p-2.5 text-[13px]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Keep Invoice
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="h-9 rounded-lg bg-[#B4343B] px-4 text-[12.5px] font-semibold text-white hover:bg-[#992930]"
              >
                {busyAction ? "Cancelling..." : "Confirm Cancellation"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
