"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Plus,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { computeLinePreview, ibmsApi } from "@/lib/api/client";
import type { QuoteDTO, TaxConfigDTO } from "@/lib/api/types";
import { useMe } from "@/lib/auth";
import { errMsg, formatDate, formatMoney } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
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

export default function QuotationsPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const canWrite = hasPermission(me.data, "quotations:write");
  const canIssue = hasPermission(me.data, "quotations:issue");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<QuoteDTO | null>(null);
  const [convertTarget, setConvertTarget] = useState<QuoteDTO | null>(null);
  const [convertIssueNow, setConvertIssueNow] = useState(true);
  const [convertDueDate, setConvertDueDate] = useState("");
  const [busyAction, setBusyAction] = useState(false);

  // Create form state
  const [clientId, setClientId] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [terms, setTerms] = useState("Valid for 30 days. 50% deposit upon acceptance.");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { description: "", quantity: "1", unit_price: "", discount_amount: "0.00", tax_config_id: "", tax_rate: "0" },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const quotesQuery = useQuery({
    queryKey: ["ibms-quotations", statusFilter],
    queryFn: () =>
      ibmsApi.quotations.list(
        statusFilter !== "all" ? `status_filter=${encodeURIComponent(statusFilter)}&page_size=100` : "page_size=100",
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

  const allQuotes = quotesQuery.data?.data ?? [];
  const clients = clientsQuery.data ?? [];
  const taxes: TaxConfigDTO[] = taxesQuery.data?.data ?? [];

  const clientMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const filteredQuotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allQuotes;
    return allQuotes.filter((row) => {
      const cName = (clientMap.get(row.client_id) ?? "").toLowerCase();
      return (
        (row.quote_number ?? "draft").toLowerCase().includes(q) ||
        cName.includes(q) ||
        row.notes.toLowerCase().includes(q)
      );
    });
  }, [allQuotes, search, clientMap]);

  const previewTotals = useMemo(() => {
    let sub = 0;
    let disc = 0;
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
      disc += Math.round((Number(l.discount_amount) || 0) * 100);
      tax += Math.round(Number(p.taxAmount) * 100);
      tot += Math.round(Number(p.lineTotal) * 100);
    }
    return {
      subtotal: (sub / 100).toFixed(2),
      discount: (disc / 100).toFixed(2),
      tax: (tax / 100).toFixed(2),
      total: (tot / 100).toFixed(2),
    };
  }, [lines, taxes]);

  async function handleCreateQuote(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!clientId) {
      setFormError("Please select a client.");
      return;
    }
    const validLines = lines.filter((l) => l.description.trim() && Number(l.unit_price) >= 0 && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      setFormError("Please provide at least one valid line item with description, quantity, and unit price.");
      return;
    }

    setBusyAction(true);
    try {
      await ibmsApi.quotations.create({
        client_id: clientId,
        expiry_date: expiryDate || null,
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
      toast.success("Quotation draft created");
      setCreateOpen(false);
      setLines([{ description: "", quantity: "1", unit_price: "", discount_amount: "0.00", tax_config_id: "", tax_rate: "0" }]);
      await qc.invalidateQueries({ queryKey: ["ibms-quotations"] });
    } catch (err) {
      setFormError(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleTransition(quote: QuoteDTO, action: "issue" | "accept" | "reject") {
    setBusyAction(true);
    try {
      const res =
        action === "issue"
          ? await ibmsApi.quotations.issue(quote.id)
          : action === "accept"
            ? await ibmsApi.quotations.accept(quote.id)
            : await ibmsApi.quotations.reject(quote.id);
      toast.success(res.message);
      setSelectedQuote(res.data);
      await qc.invalidateQueries({ queryKey: ["ibms-quotations"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleConfirmConversion(e: React.FormEvent) {
    e.preventDefault();
    if (!convertTarget) return;
    setBusyAction(true);
    try {
      const res = await ibmsApi.quotations.convertToInvoice(convertTarget.id, {
        due_date: convertDueDate || null,
        issue_immediately: convertIssueNow,
      });
      toast.success(
        `Converted to Invoice ${res.data.invoice_number ?? "Draft"} (original quotation preserved)`,
      );
      setConvertTarget(null);
      setSelectedQuote(null);
      await qc.invalidateQueries({ queryKey: ["ibms-quotations"] });
      await qc.invalidateQueries({ queryKey: ["ibms-invoices"] });
      router.push("/invoices");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Quotations & Proposals
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Prepare commercial proposals, track client approvals, and convert accepted quotes into invoices.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              if (!clientId && clients[0]) setClientId(clients[0].id);
              setCreateOpen(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-xs transition-colors hover:bg-[#4C3EC2]"
          >
            <Plus className="h-4 w-4" />
            New Quotation
          </button>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Total Quotations</p>
          <p className="mt-1 font-display text-[24px] font-bold tabular text-[#20232D]">{allQuotes.length}</p>
        </div>
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Issued / Pending</p>
          <p className="mt-1 font-display text-[24px] font-bold tabular text-[#0369A1]">
            {allQuotes.filter((q) => q.status === "sent").length}
          </p>
        </div>
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Accepted</p>
          <p className="mt-1 font-display text-[24px] font-bold tabular text-[#16794F]">
            {allQuotes.filter((q) => q.status === "approved").length}
          </p>
        </div>
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Converted to Invoice</p>
          <p className="mt-1 font-display text-[24px] font-bold tabular text-[#5848D6]">
            {allQuotes.filter((q) => q.status === "converted").length}
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6E8EF] bg-white p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", "draft", "sent", "approved", "converted", "rejected"].map((st) => (
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
              {st === "sent" ? "Issued" : st === "approved" ? "Accepted" : st}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search quote no., client, or notes..."
          aria-label="Search quotations"
          className="h-9 w-full rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] px-3 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6] sm:w-72"
        />
      </div>

      {/* Quotations Table */}
      <div className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white">
        {quotesQuery.isLoading ? (
          <div className="p-8 text-center text-[13px] text-[#7A7F8C]">Loading quotations...</div>
        ) : quotesQuery.isError ? (
          <div className="p-8 text-center text-[13px] text-[#B4343B]">
            Failed to load quotations: {errMsg(quotesQuery.error)}
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-12 text-center">
            <FileSpreadsheet className="mx-auto h-9 w-9 text-[#C4C8D4]" />
            <p className="mt-3 font-display text-[15px] font-bold text-[#20232D]">No quotations found</p>
            <p className="mt-1 text-[13px] text-[#7A7F8C]">
              Create a new quotation to send an itemized commercial offer to a client.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">
                  <th className="px-4 py-3">Quotation No.</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Issue Date</th>
                  <th className="px-4 py-3">Valid Until</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {filteredQuotes.map((q) => {
                  const snapName = (q.client_snapshot as { name?: string } | null)?.name;
                  const cName = snapName || clientMap.get(q.client_id) || "Client";
                  return (
                    <tr key={q.id} className="hover:bg-[#F7F8FA]/70">
                      <td className="px-4 py-3.5 font-mono font-semibold text-[#5848D6]">
                        {q.quote_number ?? "DRAFT"}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-[#20232D]">{cName}</td>
                      <td className="px-4 py-3.5 text-[#646977]">{formatDate(q.issue_date)}</td>
                      <td className="px-4 py-3.5 text-[#646977]">
                        {q.expiry_date ? formatDate(q.expiry_date) : "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <DocumentStatusBadge status={q.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold tabular text-[#20232D]">
                        {formatMoney(q.total, q.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedQuote(q)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#E6E8EF] bg-white px-2.5 py-1 text-[12px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                          >
                            <Eye className="h-3.5 w-3.5 text-[#7A7F8C]" />
                            View
                          </button>
                          {q.status === "approved" && canIssue && (
                            <button
                              type="button"
                              onClick={() => setConvertTarget(q)}
                              className="inline-flex items-center gap-1 rounded-md bg-[#5848D6] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#4C3EC2]"
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              Convert to Invoice
                            </button>
                          )}
                          <a
                            href={`/api/v1/quotations/${q.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-[#E6E8EF] bg-white px-2 py-1 text-[12px] text-[#646977] hover:text-[#20232D]"
                            title="Download Quotation PDF"
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

      {/* Create Quotation Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E6E8EF] pb-4">
              <div>
                <h2 className="font-display text-[18px] font-bold text-[#20232D]">Create Quotation</h2>
                <p className="text-[12.5px] text-[#7A7F8C]">
                  Authoritative line totals and taxes are verified by the backend on save.
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

            <form onSubmit={handleCreateQuote} className="mt-5 space-y-5">
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
                  <label className="block text-[12px] font-semibold text-[#20232D]">Expiry / Validity Date</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
                  />
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-semibold text-[#20232D]">Quotation Line Items *</label>
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
                        placeholder="Service or deliverable..."
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
                          title="Remove item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-semibold text-[#20232D]">Terms & Conditions</label>
                  <textarea
                    rows={2}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#E6E8EF] p-2.5 text-[12.5px]"
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
                    <span>Estimated Total:</span>
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
                  {busyAction ? "Saving..." : "Save Quotation Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quotation Detail & Workflow Modal */}
      {selectedQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#E6E8EF] pb-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="font-display text-[18px] font-bold text-[#20232D]">
                    {selectedQuote.quote_number ?? "Draft Quotation"}
                  </h3>
                  <DocumentStatusBadge status={selectedQuote.status} />
                </div>
                <p className="mt-1 text-[12.5px] text-[#7A7F8C]">
                  Client:{" "}
                  {(selectedQuote.client_snapshot as { name?: string } | null)?.name ||
                    clientMap.get(selectedQuote.client_id) ||
                    "Client"}{" "}
                  · Issued: {formatDate(selectedQuote.issue_date)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedQuote(null)}
                className="rounded-lg p-1.5 text-[#7A7F8C] hover:bg-[#F3F4F8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <div className="overflow-hidden rounded-lg border border-[#E6E8EF]">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-[#F7F8FA] text-[11px] font-semibold text-[#7A7F8C] uppercase">
                    <tr>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right">Tax</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E8EF]">
                    {selectedQuote.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2.5 font-medium text-[#20232D]">{it.description}</td>
                        <td className="px-3 py-2.5 text-right tabular">{Number(it.quantity).toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {formatMoney(it.unit_price, selectedQuote.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {formatMoney(it.tax_amount, selectedQuote.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular">
                          {formatMoney(it.line_total, selectedQuote.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-[13px]">
                  <div className="flex justify-between text-[#646977]">
                    <span>Subtotal:</span>
                    <span className="tabular">{formatMoney(selectedQuote.subtotal, selectedQuote.currency)}</span>
                  </div>
                  <div className="flex justify-between text-[#646977]">
                    <span>Tax:</span>
                    <span className="tabular">{formatMoney(selectedQuote.tax_total, selectedQuote.currency)}</span>
                  </div>
                  <div className="flex justify-between border-t border-[#E6E8EF] pt-1.5 font-display text-[15px] font-bold text-[#20232D]">
                    <span>Total:</span>
                    <span className="tabular">{formatMoney(selectedQuote.total, selectedQuote.currency)}</span>
                  </div>
                </div>
              </div>

              {/* Lifecycle Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6E8EF] pt-4">
                <a
                  href={`/api/v1/quotations/${selectedQuote.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E8EF] px-3.5 py-2 text-[12.5px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
                >
                  <Download className="h-4 w-4 text-[#5848D6]" />
                  Download A4 PDF
                </a>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedQuote.status === "draft" && canIssue && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => handleTransition(selectedQuote, "issue")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2]"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Issue Quotation
                    </button>
                  )}
                  {selectedQuote.status === "sent" && canIssue && (
                    <>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleTransition(selectedQuote, "reject")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#F6D2D6] bg-[#FCECEE] px-3.5 py-2 text-[12.5px] font-semibold text-[#B4343B]"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Mark Rejected
                      </button>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => handleTransition(selectedQuote, "accept")}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#16794F] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#12633F]"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Mark Accepted
                      </button>
                    </>
                  )}
                  {selectedQuote.status === "approved" && canIssue && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => setConvertTarget(selectedQuote)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2]"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      Convert to Invoice
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog Before Converting Quotation to Invoice (Section 12) */}
      {convertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmConversion}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <h3 className="font-display text-[17px] font-bold text-[#20232D]">
              Convert Quotation to Invoice
            </h3>
            <p className="text-[13px] text-[#646977]">
              This will create a new linked Invoice for{" "}
              <strong className="text-[#20232D]">
                {formatMoney(convertTarget.total, convertTarget.currency)}
              </strong>{" "}
              while preserving original quotation{" "}
              <span className="font-mono font-semibold text-[#5848D6]">
                {convertTarget.quote_number}
              </span>{" "}
              in your audit history.
            </p>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Invoice Due Date</label>
              <input
                type="date"
                value={convertDueDate}
                onChange={(e) => setConvertDueDate(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px]"
              />
            </div>
            <label className="flex items-center gap-2 text-[13px] font-medium text-[#20232D]">
              <input
                type="checkbox"
                checked={convertIssueNow}
                onChange={(e) => setConvertIssueNow(e.target.checked)}
                className="h-4 w-4 rounded border-[#E6E8EF] text-[#5848D6]"
              />
              Issue invoice immediately with sequential number & snapshot
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2] disabled:opacity-50"
              >
                {busyAction ? "Converting..." : "Confirm Conversion"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
