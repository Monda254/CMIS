"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Pencil,
  Printer,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { useMe } from "@/lib/auth";
import { BrandingImg } from "@/components/branding-img";
import { PaymentStatusBadge, getPaymentStatusMeta, type PaymentStatus } from "@/components/status-badge";
import { dateTime, errMsg, formatMoney } from "@/lib/format";

type Receipt = {
  id: string;
  status: "draft" | "finalized" | "cancelled";
  payment_status?: PaymentStatus;
  amount_paid?: string | number;
  balance_due?: string | number;
  payment_method?: string;
  receipt_number: string | null;
  verification_code: string | null;
  client_id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  notes: string;
  currency: string;
  total: string;
  created_at: string;
  finalized_at: string | null;
  issued_by_name: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  print_count: number;
  company_snapshot: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    footer?: string;
    logo_url?: string | null;
    stamp_url?: string | null;
    signature_url?: string | null;
  } | null;
};

type ReceiptItem = {
  id: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  line_total: string | number;
};

export function ReceiptPrintPreview({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const isAdmin = me.data?.role === "admin";

  const [copy, setCopy] = useState<number | null>(null);
  const [paperSize, setPaperSize] = useState("A4");
  const [copyType, setCopyType] = useState<"original" | "duplicate">("original");
  const [numCopies, setNumCopies] = useState("1");
  const [includeDuplicate, setIncludeDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const q = useQuery({
    queryKey: ["receipt", id],
    queryFn: () => apiFetch<{ receipt: Receipt | null; items: ReceiptItem[] }>(`/api/receipts/${id}`),
  });

  const liveSettings = useQuery({
    queryKey: ["settings"],
    enabled: q.data?.receipt?.status === "draft",
    queryFn: () =>
      apiFetch<{
        name: string;
        address: string;
        phone: string;
        email: string;
        footer: string;
        logo_url: string | null;
        stamp_url: string | null;
        signature_url: string | null;
      }>("/api/settings"),
  });

  async function invalidateAll() {
    await qc.invalidateQueries({ queryKey: ["receipt", id] });
    await qc.invalidateQueries({ queryKey: ["receipts"] });
    await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    await qc.invalidateQueries({ queryKey: ["shell-quick-stats"] });
  }

  async function handlePrint() {
    setError(null);
    try {
      const res = await apiFetch<{ copy: number }>(`/api/receipts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "record_print" }),
      });
      setCopy(res.copy);
      await invalidateAll();
      setTimeout(() => window.print(), 150);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function handleDownloadPdf() {
    setError(null);
    setDownloadingPdf(true);
    try {
      const res = await fetch(`/api/receipts/${id}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Could not generate PDF");
      }
      const copyHeader = res.headers.get("X-Receipt-Copy");
      if (copyHeader) setCopy(Number(copyHeader));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${q.data?.receipt?.receipt_number ?? `receipt-${id}`}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      await invalidateAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleFinalizeDraft() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/receipts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "finalize" }),
      });
      toast.success("Receipt finalized and locked");
      await invalidateAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteDraft() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/receipts/${id}`, { method: "DELETE" });
      toast.success("Draft deleted");
      await invalidateAll();
      router.push("/receipts");
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  async function handleDuplicateAsDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ id: string }>(`/api/receipts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "duplicate" }),
      });
      toast.success("Created new draft receipt");
      await invalidateAll();
      router.push(`/receipts/${res.id}/edit`);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  async function handleCancelReceipt() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/receipts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel", reason: cancelReason }),
      });
      setCancelOpen(false);
      setCancelReason("");
      toast.success("Receipt cancelled");
      await invalidateAll();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) {
    return <p className="text-[13px] text-[#7A7F8C]">Loading receipt preview…</p>;
  }
  if (q.isError || !q.data?.receipt) {
    return <p className="text-[13px] text-[#B4343B]">Could not load this receipt.</p>;
  }

  const r = q.data.receipt;
  const items = q.data.items;
  // Per AGENTS.md: Issued receipts ALWAYS use stored company_snapshot, never live settings.
  const snap = r.status === "draft" ? (liveSettings.data ?? {}) : (r.company_snapshot ?? {});
  const companyTitle = snap.name || "NORTHSTAR STUDIO";
  const isDuplicateBannerVisible =
    (copy !== null && copy > 1) || copyType === "duplicate" || includeDuplicate;
  const effectiveCopyNum = copy ?? (r.print_count > 0 ? r.print_count + 1 : 2);
  const verifyOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="no-print flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Print preview
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Review your receipt before sharing or printing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {r.status === "draft" ? (
            <>
              <Link
                href={`/receipts/${id}/edit`}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs hover:bg-[#F7F8FA]"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit draft
              </Link>
              <button
                type="button"
                disabled={busy}
                onClick={handleFinalizeDraft}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-2xs hover:bg-[#4C3EC2] disabled:opacity-50"
              >
                Finalize &amp; issue receipt →
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDeleteDraft}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#F6D2D6] bg-[#FCECEE] px-3.5 text-[13px] font-semibold text-[#B4343B] hover:bg-[#F6D2D6]/60 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete draft
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={downloadingPdf}
                onClick={handleDownloadPdf}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA] disabled:opacity-50"
              >
                <Download className="h-4 w-4 text-[#7A7F8C]" />
                {downloadingPdf ? "Generating PDF…" : "Download PDF"}
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5848D6] px-5 text-[13px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2]"
              >
                <Printer className="h-4 w-4" />
                Print receipt
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="no-print rounded-xl border border-[#F6D2D6] bg-[#FCECEE] px-4 py-3 text-[13px] font-medium text-[#B4343B]">
          {error}
        </div>
      )}

      {/* Main 2-Column Layout matching 04 · Print preview.svg */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Framed A4 Canvas (8 cols) */}
        <div className="rounded-2xl bg-[#EAECF2] p-4 sm:p-8 lg:col-span-8">
          <div className="print-sheet mx-auto w-full max-w-[640px] rounded-[2px] bg-white p-8 shadow-sm sm:p-12">
            {/* Duplicate Copy Banner (required when copy > 1) */}
            {isDuplicateBannerVisible && (
              <div className="print-avoid-break mb-6 rounded border-2 border-dashed border-[#B4343B] bg-[#FCECEE]/50 px-4 py-2 text-center text-[11.5px] font-bold tracking-[0.14em] text-[#B4343B] uppercase">
                DUPLICATE COPY — COPY #{effectiveCopyNum} — NOT AN ORIGINAL
              </div>
            )}

            {/* Cancelled Banner */}
            {r.status === "cancelled" && (
              <div className="print-avoid-break mb-6 rounded border-2 border-[#B4343B] bg-[#FCECEE] px-4 py-2.5 text-center text-[12px] font-bold tracking-[0.12em] text-[#B4343B] uppercase">
                CANCELLED — THIS RECEIPT IS NOT VALID
                {r.cancel_reason ? ` (${r.cancel_reason})` : ""}
              </div>
            )}

            {/* Receipt Header */}
            <header className="flex items-start justify-between gap-6 border-b border-[#E6E8EF] pb-6">
              <div>
                <div className="flex items-center gap-3">
                  {snap.logo_url && (
                    <BrandingImg
                      path={snap.logo_url}
                      alt="Company logo"
                      className="h-12 w-auto object-contain"
                    />
                  )}
                  <div>
                    <h2 className="font-display text-[20px] font-extrabold tracking-tight text-[#20232D] uppercase">
                      {companyTitle}
                    </h2>
                  </div>
                </div>
                <div className="mt-3 space-y-0.5 text-[11px] text-[#7A7F8C]">
                  {snap.address && <p>{snap.address}</p>}
                  {(snap.phone || snap.email) && (
                    <p>{[snap.phone, snap.email].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <p className="font-display text-[20px] font-extrabold tracking-wide text-[#5848D6]">
                  RECEIPT
                </p>
                <p className="mt-0.5 text-[9.5px] font-semibold tracking-[0.1em] text-[#7A7F8C] uppercase">
                  {isDuplicateBannerVisible ? "DUPLICATE COPY" : "ORIGINAL COPY"}
                </p>
              </div>
            </header>

            {/* Bill To & Metadata */}
            <section className="print-avoid-break mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
                  Bill to
                </p>
                <p className="mt-1.5 font-display text-[16px] font-bold text-[#20232D]">
                  {r.customer_name}
                </p>
                <div className="mt-1 space-y-0.5 text-[11.5px] text-[#7A7F8C]">
                  {r.customer_phone && <p>{r.customer_phone}</p>}
                  {r.customer_address && <p className="whitespace-pre-line">{r.customer_address}</p>}
                </div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <p className="text-[10.5px] text-[#7A7F8C]">Receipt no.</p>
                  <p className="mt-0.5 font-mono text-[13px] font-bold text-[#20232D]">
                    {r.receipt_number ?? "DRAFT — NOT ISSUED"}
                  </p>
                </div>
                <div>
                  <p className="text-[10.5px] text-[#7A7F8C]">Issued on</p>
                  <p className="mt-0.5 text-[12px] font-medium text-[#20232D]">
                    {dateTime(r.finalized_at ?? r.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PaymentStatusBadge status={r.payment_status ?? "paid"} full />
                  {r.status === "finalized" ? (
                    <span className="inline-flex items-center rounded-md bg-[#E8F6EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#16794F]">
                      Finalized
                    </span>
                  ) : r.status === "draft" ? (
                    <span className="inline-flex items-center rounded-md bg-[#FCF3E3] px-2.5 py-0.5 text-[11px] font-semibold text-[#9A6316]">
                      Draft
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-[#FCECEE] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4343B]">
                      Cancelled
                    </span>
                  )}
                </div>
                {r.payment_method && (
                  <p className="text-[11px] text-[#7A7F8C]">Method: {r.payment_method}</p>
                )}
              </div>
            </section>

            {/* Line Items Table */}
            <table className="mt-7 w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="bg-[#F3F2FA] text-[9.5px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
                  <th className="px-3.5 py-2.5">Description</th>
                  <th className="px-3.5 py-2.5 text-right">Qty</th>
                  <th className="px-3.5 py-2.5 text-right">Rate</th>
                  <th className="px-3.5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF]">
                {items.map((it) => (
                  <tr key={it.id} className="print-avoid-break">
                    <td className="px-3.5 py-3.5 font-medium text-[#20232D]">{it.description}</td>
                    <td className="px-3.5 py-3.5 text-right tabular text-[#4A4F5C]">
                      {Number(it.quantity)}
                    </td>
                    <td className="px-3.5 py-3.5 text-right tabular text-[#4A4F5C]">
                      {formatMoney(it.unit_price, r.currency)}
                    </td>
                    <td className="px-3.5 py-3.5 text-right font-semibold tabular text-[#20232D]">
                      {formatMoney(it.line_total, r.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Notes & Total Paid */}
            <div className="print-avoid-break mt-6 flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-[260px]">
                <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[#7A7F8C] uppercase">
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[#7A7F8C]">
                  {r.notes || "Thank you for your business."}
                </p>
              </div>

              <div className="space-y-1.5 text-right">
                <div className="flex items-baseline justify-end gap-4">
                  <span className="text-[11px] font-bold tracking-[0.06em] text-[#7A7F8C] uppercase">
                    Receipt Total
                  </span>
                  <span className="font-display text-[18px] font-bold tabular text-[#20232D]">
                    {formatMoney(r.total, r.currency)}
                  </span>
                </div>
                <div className="flex items-baseline justify-end gap-4">
                  <span className="text-[11px] font-bold tracking-[0.06em] text-[#16794F] uppercase">
                    Amount Paid
                  </span>
                  <span className="font-display text-[22px] font-extrabold tabular text-[#5848D6]">
                    {formatMoney(
                      r.amount_paid !== undefined && r.amount_paid !== null
                        ? r.amount_paid
                        : (r.payment_status ?? "paid") === "paid"
                          ? r.total
                          : 0,
                      r.currency,
                    )}
                  </span>
                </div>
                {Number(r.balance_due ?? 0) > 0 && (
                  <div className="flex items-baseline justify-end gap-4">
                    <span className="text-[11px] font-bold tracking-[0.06em] text-[#B4343B] uppercase">
                      Balance Due
                    </span>
                    <span className="font-display text-[16px] font-bold tabular text-[#B4343B]">
                      {formatMoney(r.balance_due ?? 0, r.currency)}
                    </span>
                  </div>
                )}
                <p className="mt-0.5 text-[10px] font-medium text-[#7A7F8C] uppercase">{r.currency}</p>
              </div>
            </div>

            {/* Stamp & Authorized Signature */}
            <div className="print-avoid-break mt-10 grid grid-cols-2 items-end gap-8">
              <div>
                {snap.stamp_url ? (
                  <BrandingImg
                    path={snap.stamp_url}
                    alt="Company stamp"
                    className="h-20 w-auto object-contain"
                  />
                ) : (
                  <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-[1.75px] border-[#6356D8]/70 text-center">
                    <span className="text-[7.5px] font-bold tracking-wider text-[#6356D8] uppercase">
                      {(snap.name || "NORTHSTAR").split(" ")[0]}
                    </span>
                    <span className="mt-0.5 px-1 font-display text-[10.5px] font-extrabold leading-tight text-[#6356D8] uppercase">
                      {getPaymentStatusMeta(r.payment_status).label}
                    </span>
                  </div>
                )}
                <p className="mt-2 text-[10px] text-[#7A7F8C]">Company stamp</p>
              </div>

              <div>
                {snap.signature_url ? (
                  <BrandingImg
                    path={snap.signature_url}
                    alt="Authorized signature"
                    className="h-14 w-auto object-contain"
                  />
                ) : (
                  <p className="font-serif text-[18px] italic text-[#20232D]">
                    {r.issued_by_name || "Authorized Signatory"}
                  </p>
                )}
                <div className="mt-2 border-t border-[#E6E8EF] pt-1.5">
                  <p className="text-[10px] text-[#7A7F8C]">Authorized signature</p>
                </div>
              </div>
            </div>

            {/* QR Verification Block */}
            {r.verification_code && (
              <div className="print-avoid-break mt-9 flex items-center gap-4 pt-4">
                <div className="shrink-0 rounded bg-white p-1">
                  <QRCodeSVG
                    value={`${verifyOrigin}/verify/${r.verification_code}`}
                    size={76}
                    level="M"
                  />
                </div>
                <div>
                  <p className="text-[9px] font-bold tracking-[0.08em] text-[#7A7F8C] uppercase">
                    Verify this receipt
                  </p>
                  <p className="mt-1 font-mono text-[14px] font-bold tracking-wider text-[#20232D]">
                    {r.verification_code}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-[#7A7F8C]">
                    Scan the QR code to confirm authenticity.
                  </p>
                </div>
              </div>
            )}

            {/* Bottom Footer Line */}
            <p className="mt-7 text-[10.5px] text-[#7A7F8C]">
              {snap.footer || "Thank you for your business. We look forward to working with you again."}
            </p>
          </div>
        </div>

        {/* Right Print Settings & Status Column (4 cols) */}
        <div className="no-print space-y-5 lg:col-span-4">
          {/* Print Settings Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 space-y-4">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Print settings</h2>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Paper size</label>
              <select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value)}
                aria-label="Paper size"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="Letter">US Letter (8.5 × 11 in)</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Copy type</label>
              <select
                value={copyType}
                onChange={(e) => setCopyType(e.target.value as "original" | "duplicate")}
                aria-label="Copy type"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="original">Original copy</option>
                <option value="duplicate">Duplicate copy</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Number of copies</label>
              <input
                type="number"
                min="1"
                max="10"
                value={numCopies}
                onChange={(e) => setNumCopies(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] tabular text-[#20232D] outline-none focus:border-[#5848D6]"
              />
            </div>

            <div className="pt-1">
              <label className="flex items-center gap-2.5 text-[13px] font-medium text-[#20232D] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDuplicate}
                  onChange={(e) => setIncludeDuplicate(e.target.checked)}
                  className="h-4 w-4 rounded border-[#E6E8EF] text-[#5848D6] focus:ring-[#5848D6]"
                />
                Include duplicate copy
              </label>
              <p className="mt-1 text-[11.5px] text-[#7A7F8C]">
                Duplicate copies are clearly labeled.
              </p>
            </div>

            <div className="border-t border-[#E6E8EF] pt-3 text-[11.5px] text-[#7A7F8C]">
              1 page · Portrait · 100% scale · Printed {r.print_count}×
            </div>
          </div>

          {/* Ready to Share / Verification Card */}
          {r.status === "finalized" && r.verification_code && (
            <div className="rounded-xl border border-[#C9EAD7] bg-[#E8F6EE] p-6">
              <div className="flex items-center gap-2 text-[#16794F]">
                <Check className="h-4 w-4 stroke-[2.5]" />
                <h3 className="font-display text-[15px] font-bold">Ready to share</h3>
              </div>

              <p className="mt-2.5 text-[12.5px] leading-relaxed text-[#2F5C47]">
                Receipt finalized on {dateTime(r.finalized_at)}. The original details are protected from
                further changes.
              </p>

              <div className="mt-5">
                <p className="text-[11px] font-medium text-[#2F5C47]">Verification code</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-mono text-[20px] font-bold tracking-wider text-[#16794F]">
                    {r.verification_code}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(r.verification_code!);
                        toast.success("Verification code copied");
                      }}
                      title="Copy verification code"
                      className="rounded-lg bg-white/80 p-2 text-[#16794F] hover:bg-white"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <Link
                      href={`/verify/${r.verification_code}`}
                      title="Open public verification link"
                      className="rounded-lg bg-white/80 p-2 text-[#16794F] hover:bg-white"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Duplicate as new draft button */}
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={handleDuplicateAsDraft}
              className="flex h-11 w-full items-center justify-between rounded-xl border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA] disabled:opacity-50"
            >
              <span>Duplicate as new draft</span>
              <Copy className="h-4 w-4 text-[#7A7F8C]" />
            </button>
            <p className="mt-2 px-1 text-[11.5px] text-[#7A7F8C]">
              A new receipt number and code will be issued.
            </p>
          </div>

          {/* Admin-Only Cancel Receipt Action */}
          {r.status === "finalized" && isAdmin && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#F6D2D6] bg-[#FCECEE]/60 px-4 text-[12.5px] font-semibold text-[#B4343B] transition-colors hover:bg-[#FCECEE]"
              >
                <ShieldAlert className="h-4 w-4" />
                Cancel finalized receipt
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cancel Receipt Modal */}
      {cancelOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#20232D]/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl">
            <h3 className="font-display text-[17px] font-bold text-[#20232D]">
              Cancel receipt {r.receipt_number}?
            </h3>
            <p className="mt-1.5 text-[13px] text-[#7A7F8C]">
              Cancelled receipts stay in the register for audit purposes and show as cancelled if someone
              tries to verify them. This cannot be undone.
            </p>
            <div className="mt-4">
              <label className="block text-[12px] font-semibold text-[#20232D]">
                Reason for cancellation *
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                maxLength={500}
                placeholder="e.g. Duplicate entry, reissued as RCP-2026-000126"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#B4343B]"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-4 text-[12.5px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
              >
                Keep receipt
              </button>
              <button
                type="button"
                disabled={!cancelReason.trim() || busy}
                onClick={handleCancelReceipt}
                className="h-9 rounded-lg bg-[#B4343B] px-4 text-[12.5px] font-semibold text-white hover:bg-[#992930] disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Confirm cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
