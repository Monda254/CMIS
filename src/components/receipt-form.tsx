"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Check, Eye, Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { errMsg, formatMoney, previewLineTotal } from "@/lib/format";

export type ItemRow = { description: string; quantity: string; unit_price: string };

type Props = {
  receiptId?: string;
  initial?: {
    client_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    notes: string;
    items: ItemRow[];
  };
};

const QTY_RE = /^\d+(\.\d{1,3})?$/;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const NEW_CLIENT = "__new__";

export function ReceiptForm({ receiptId, initial }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const [clientId, setClientId] = useState<string>(initial?.client_id ?? NEW_CLIENT);
  const [customerName, setCustomerName] = useState(initial?.customer_name ?? "");
  const [customerPhone, setCustomerPhone] = useState(initial?.customer_phone ?? "");
  const [customerAddress, setCustomerAddress] = useState(initial?.customer_address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<ItemRow[]>(
    initial?.items?.length ? initial.items : [{ description: "", quantity: "1", unit_price: "" }],
  );
  const [busy, setBusy] = useState<"draft" | "issue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLiveSheet, setShowLiveSheet] = useState(false);

  const clients = useQuery({
    queryKey: ["clients", "active"],
    queryFn: () =>
      apiFetch<{ id: string; name: string; phone: string; address: string }[]>("/api/clients?active=true"),
  });

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      apiFetch<{
        name: string;
        address: string;
        phone: string;
        email: string;
        footer: string;
        currency: string;
        number_prefix: string;
      }>("/api/settings"),
  });

  const currency = settings.data?.currency || "KES";
  const prefix = settings.data?.number_prefix || "RCP";
  const previewNumber = `${prefix}-${new Date().getFullYear()}-000XXX`;
  const nowFormatted = new Date().toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const previewTotal = items.reduce((sum, it) => sum + previewLineTotal(it.quantity, it.unit_price), 0);
  const totalUnits = items.reduce((sum, it) => {
    const q = Number(it.quantity);
    return sum + (Number.isFinite(q) && q > 0 ? q : 0);
  }, 0);

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function validate(): string | null {
    if (clientId !== NEW_CLIENT && !clientId) return "Choose an existing client or add a new one.";
    if (!customerName.trim()) return "Customer name is required.";
    if (customerName.trim().length > 200) return "Customer name is too long.";
    for (const [i, it] of items.entries()) {
      if (!it.description.trim()) return `Item ${i + 1}: description is required.`;
      if (it.description.trim().length > 500) return `Item ${i + 1}: description is too long.`;
      if (!QTY_RE.test(it.quantity) || Number(it.quantity) <= 0) {
        return `Item ${i + 1}: quantity must be a positive number (up to 3 decimals).`;
      }
      if (!PRICE_RE.test(it.unit_price)) {
        return `Item ${i + 1}: unit price must be a non-negative number (up to 2 decimals).`;
      }
    }
    return null;
  }

  async function save(kind: "draft" | "issue") {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      const res = await apiFetch<{ id: string; receiptNumber: string | null }>("/api/receipts", {
        method: "POST",
        body: JSON.stringify({
          receiptId: receiptId ?? null,
          clientId: clientId === NEW_CLIENT ? null : clientId,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerAddress: customerAddress.trim(),
          notes: notes.trim(),
          items: items.map((it) => ({
            description: it.description.trim(),
            quantity: Number(it.quantity),
            unit_price: Number(it.unit_price),
          })),
          issue: kind === "issue",
        }),
      });
      await qc.invalidateQueries({ queryKey: ["receipt", res.id] });
      await qc.invalidateQueries({ queryKey: ["receipts"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      await qc.invalidateQueries({ queryKey: ["shell-quick-stats"] });
      router.push(kind === "issue" ? `/receipts/${res.id}/print` : `/receipts/${res.id}`);
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header Row matching 03 · Create receipt.svg */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            {receiptId ? "Edit receipt" : "Create receipt"}
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Create a professional receipt in just a few steps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowLiveSheet((prev) => !prev)}
            className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-semibold transition-colors ${
              showLiveSheet
                ? "border-[#5848D6] bg-[#EEECFC] text-[#5848D6]"
                : "border-[#E6E8EF] bg-white text-[#20232D] hover:bg-[#F7F8FA]"
            }`}
          >
            <Eye className="h-4 w-4" />
            {showLiveSheet ? "Hide live A4 preview" : "Live A4 preview"}
          </button>

          <button
            type="button"
            disabled={!!busy}
            onClick={() => (receiptId ? router.push(`/receipts/${receiptId}`) : router.push("/receipts"))}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] transition-colors hover:bg-[#F7F8FA] disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!!busy}
            onClick={() => save("draft")}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[#E6E8EF] bg-white px-5 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA] disabled:opacity-50"
          >
            {busy === "draft" ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#F6D2D6] bg-[#FCECEE] px-4 py-3 text-[13px] font-medium text-[#B4343B]">
          {error}
        </div>
      )}

      {/* Main 2-Column Studio Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Form Card (8 cols) */}
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 space-y-7 lg:col-span-8">
          {/* Section 1: Receipt Details */}
          <div>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[16px] font-bold text-[#20232D]">Receipt details</h2>
              <span className="text-[11px] font-bold tracking-wider text-[#9A6316] uppercase">Draft</span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Receipt number</label>
                <input
                  type="text"
                  readOnly
                  value={previewNumber}
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] px-3.5 text-[13px] font-medium text-[#20232D] outline-none"
                />
                <p className="mt-1.5 text-[11px] text-[#7A7F8C]">
                  Automatically generated · editable until finalized
                </p>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Issue date &amp; time</label>
                <input
                  type="text"
                  readOnly
                  value={nowFormatted}
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] px-3.5 text-[13px] font-medium text-[#20232D] outline-none"
                />
              </div>
            </div>
          </div>

          <hr className="border-[#E6E8EF]" />

          {/* Section 2: Client Information */}
          <div>
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Client information</h2>
            <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
              Choose an existing client or enter a new one.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Existing client</label>
                <select
                  value={clientId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setClientId(v);
                    const c = clients.data?.find((x) => x.id === v);
                    if (c) {
                      setCustomerName(c.name);
                      setCustomerPhone(c.phone || "");
                      setCustomerAddress(c.address || "");
                    }
                  }}
                  aria-label="Select existing client"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
                >
                  <option value={NEW_CLIENT}>+ New client (create automatically)</option>
                  {clients.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Customer name *</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Olivia Rhye"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Phone number *</label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  maxLength={40}
                  placeholder="+1 (212) 555-0148"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Address (optional)</label>
                <input
                  type="text"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  maxLength={500}
                  placeholder="128 Crosby Street, New York, NY 10012"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
                />
              </div>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-[#16794F]">
              <Check className="h-3.5 w-3.5" />
              {clientId === NEW_CLIENT
                ? "A client record is created automatically when you finalize."
                : "Linked to existing client profile."}
            </p>
          </div>

          <hr className="border-[#E6E8EF]" />

          {/* Section 3: Services / Products */}
          <div>
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Services / products</h2>

            <div className="mt-4 hidden grid-cols-[1fr_5.5rem_8rem_8rem_2rem] gap-2.5 rounded-lg bg-[#F7F8FA] px-3.5 py-2.5 text-[10.5px] font-semibold tracking-[0.06em] text-[#7A7F8C] uppercase sm:grid">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span>Amount</span>
              <span></span>
            </div>

            <div className="mt-2.5 space-y-2.5">
              {items.map((it, i) => {
                const lineVal = previewLineTotal(it.quantity, it.unit_price);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-1 items-center gap-2.5 sm:grid-cols-[1fr_5.5rem_8rem_8rem_2rem]"
                  >
                    <input
                      type="text"
                      placeholder={`Item ${i + 1} description`}
                      value={it.description}
                      maxLength={500}
                      onChange={(e) => setItem(i, { description: e.target.value })}
                      className="h-10 rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="1"
                      value={it.quantity}
                      aria-label={`Item ${i + 1} quantity`}
                      onChange={(e) => setItem(i, { quantity: e.target.value })}
                      className="h-10 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] tabular text-[#20232D] outline-none focus:border-[#5848D6]"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={it.unit_price}
                      aria-label={`Item ${i + 1} unit price`}
                      onChange={(e) => setItem(i, { unit_price: e.target.value })}
                      className="h-10 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] tabular text-[#20232D] outline-none focus:border-[#5848D6]"
                    />
                    <div className="flex h-10 items-center rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] px-3 text-[13px] font-medium tabular text-[#20232D]">
                      {formatMoney(lineVal, currency)}
                    </div>
                    <button
                      type="button"
                      disabled={items.length === 1}
                      aria-label={`Remove item ${i + 1}`}
                      onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-[#7A7F8C] transition-colors hover:bg-[#F3F4F8] hover:text-[#20232D] disabled:opacity-30"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setItems((r) => [...r, { description: "", quantity: "1", unit_price: "" }])}
              className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#5848D6] hover:underline"
            >
              <Plus className="h-4 w-4" />
              Add line item
            </button>

            <div className="mt-6">
              <label className="block text-[12px] font-semibold text-[#20232D]">Notes</label>
              <textarea
                rows={3}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Brand identity consultation and print production."
                className="mt-1.5 w-full rounded-lg border border-[#E6E8EF] bg-white p-3.5 text-[13px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
              />
            </div>
          </div>
        </div>

        {/* Right Summary & Info Column (4 cols) */}
        <div className="space-y-5 lg:col-span-4">
          {/* Receipt Summary Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Receipt summary</h2>
            <p className="mt-0.5 text-[12px] text-[#7A7F8C]">
              {items.length} line item{items.length === 1 ? "" : "s"} · {totalUnits} unit
              {totalUnits === 1 ? "" : "s"}
            </p>

            <div className="mt-5 flex items-center justify-between border-b border-[#E6E8EF] pb-4 text-[13px]">
              <span className="text-[#7A7F8C]">Subtotal</span>
              <span className="font-semibold tabular text-[#20232D]">
                {formatMoney(previewTotal, currency)}
              </span>
            </div>

            <div className="mt-5">
              <p className="text-[12.5px] font-semibold text-[#20232D]">Total amount</p>
              <p className="mt-1.5 font-display text-[32px] font-extrabold tracking-tight tabular text-[#20232D]">
                {formatMoney(previewTotal, currency)}
              </p>
              <p className="mt-1 text-[11.5px] text-[#7A7F8C]">
                {currency} · automatically calculated
              </p>
            </div>

            <button
              type="button"
              disabled={!!busy}
              onClick={() => save("issue")}
              className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#5848D6] px-4 text-[13.5px] font-semibold text-white shadow-xs transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
            >
              {busy === "issue" ? "Finalizing & issuing…" : "Preview & finalize →"}
            </button>
          </div>

          {/* Unique by design Lavender Card */}
          <div className="rounded-xl bg-[#EEECFC] p-6">
            <h3 className="font-display text-[16px] font-bold text-[#5848D6]">Unique by design.</h3>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-[#5E6373]">
              A unique verification code and QR code are generated when you finalize.
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-[#5E6373]">
              Finalized receipts are locked to protect their authenticity.
            </p>
          </div>

          {/* Not quite ready Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">Not quite ready?</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#7A7F8C]">
              Save a draft and come back later. Draft receipts cannot be verified or used as proof of payment.
            </p>
            <p className="mt-4 text-[11.5px] text-[#7A7F8C]">Your work stays in your workspace.</p>
          </div>
        </div>
      </div>

      {/* Optional Live A4 Document Preview (from Stitch DESIGN.md Dual-Pane Studio) */}
      {showLiveSheet && (
        <div className="rounded-2xl border border-[#E6E8EF] bg-[#EAECF2] p-6 sm:p-10">
          <div className="mx-auto max-w-[680px] rounded-sm bg-white p-8 shadow-md sm:p-12">
            <div className="flex items-start justify-between border-b border-[#E6E8EF] pb-6">
              <div>
                <p className="font-display text-[20px] font-extrabold tracking-tight uppercase text-[#20232D]">
                  {settings.data?.name || "NORTHSTAR STUDIO"}
                </p>
                <p className="mt-2 text-[11.5px] text-[#7A7F8C]">
                  {settings.data?.address || "18 W 27th Street, New York, NY 10001"}
                </p>
                <p className="text-[11.5px] text-[#7A7F8C]">
                  {[settings.data?.phone, settings.data?.email].filter(Boolean).join(" · ") ||
                    "+1 (212) 555-0100 · hello@northstar.example"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-[20px] font-extrabold tracking-wide text-[#5848D6]">
                  RECEIPT
                </p>
                <p className="text-[10px] font-semibold tracking-wider text-[#7A7F8C] uppercase">
                  DRAFT PREVIEW
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Bill to</p>
                <p className="mt-1 font-display text-[15px] font-bold text-[#20232D]">
                  {customerName || "Customer Name"}
                </p>
                {customerPhone && <p className="mt-0.5 text-[12px] text-[#7A7F8C]">{customerPhone}</p>}
                {customerAddress && <p className="text-[12px] text-[#7A7F8C]">{customerAddress}</p>}
              </div>
              <div>
                <p className="text-[11px] text-[#7A7F8C]">Receipt no.</p>
                <p className="font-mono text-[13px] font-bold text-[#20232D]">{previewNumber}</p>
                <p className="mt-2 text-[11px] text-[#7A7F8C]">Issued on</p>
                <p className="text-[12.5px] font-medium text-[#20232D]">{nowFormatted}</p>
              </div>
            </div>

            <table className="mt-6 w-full text-left text-[12.5px]">
              <thead>
                <tr className="bg-[#F3F2FA] text-[10px] font-semibold tracking-wider text-[#7A7F8C] uppercase">
                  <th className="px-3 py-2.5">Description</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF]">
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="px-3 py-3 font-medium text-[#20232D]">
                      {it.description || `Line item ${i + 1}`}
                    </td>
                    <td className="px-3 py-3 text-right tabular text-[#4A4F5C]">{it.quantity || "1"}</td>
                    <td className="px-3 py-3 text-right tabular text-[#4A4F5C]">
                      {formatMoney(Number(it.unit_price) || 0, currency)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular text-[#20232D]">
                      {formatMoney(previewLineTotal(it.quantity, it.unit_price), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-6 flex items-start justify-between">
              <div className="max-w-xs">
                <p className="text-[10px] font-semibold tracking-wider text-[#7A7F8C] uppercase">Notes</p>
                <p className="mt-1 text-[11.5px] text-[#7A7F8C]">
                  {notes || "Thank you for your business."}
                </p>
              </div>
              <div className="text-right">
                <div className="flex items-baseline gap-4">
                  <span className="text-[11px] font-bold tracking-wider text-[#20232D] uppercase">
                    Total Paid
                  </span>
                  <span className="font-display text-[22px] font-extrabold tabular text-[#5848D6]">
                    {formatMoney(previewTotal, currency)}
                  </span>
                </div>
                <p className="text-[10px] text-[#7A7F8C]">{currency}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
