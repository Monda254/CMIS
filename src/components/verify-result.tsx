"use client";

import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Check,
  Clock,
  HelpCircle,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { dateTime, formatMoney } from "@/lib/format";
import { PaymentStatusBadge, getPaymentStatusMeta, type PaymentStatus } from "@/components/status-badge";
import type { VerifyResult } from "@/lib/verify";

export function VerifyResultCard({ res, code }: { res: VerifyResult; code?: string }) {
  const r = res["result"];
  const verifyOrigin = typeof window !== "undefined" ? window.location.origin : "";

  if (r === "rate_limited") {
    return (
      <div className="mt-6 rounded-2xl border border-[#F4DFB8] bg-[#FCF3E3] p-6 text-[13.5px] text-[#9A6316]">
        <p className="font-display text-[16px] font-bold">Too many verification attempts</p>
        <p className="mt-1 text-[13px]">
          Please wait a few minutes before checking another receipt code.
        </p>
      </div>
    );
  }

  if (r === "error") {
    return (
      <div className="mt-6 rounded-2xl border border-[#E6E8EF] bg-white p-6 text-[13.5px] text-[#20232D]">
        <p className="font-display text-[16px] font-bold">Verification is temporarily unavailable</p>
        <p className="mt-1 text-[13px] text-[#7A7F8C]">Please try again shortly.</p>
      </div>
    );
  }

  // 1. Not Our Receipt / Unrecognized / Foreign Receipt State
  if (r === "invalid" || r === "not_found") {
    return (
      <div className="mt-6 space-y-4">
        <div className="overflow-hidden rounded-2xl border border-[#F6D2D6] bg-white shadow-2xs">
          <div className="flex items-start justify-between gap-4 bg-[#FCECEE] px-6 py-5">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#B4343B]/15 text-[#B4343B]">
                <ShieldAlert className="h-5 w-5 stroke-[2.25]" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-[#B4343B] px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-white uppercase">
                    NOT OUR RECEIPT
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-[#8E3B41]">
                    {code || "UNKNOWN CODE"}
                  </span>
                </div>
                <h2 className="mt-1.5 font-display text-[18px] font-bold text-[#B4343B]">
                  This is not our receipt — unrecognized code or number.
                </h2>
                <p className="mt-0.5 text-[13px] text-[#8E3B41]">
                  No receipt matching <span className="font-mono font-semibold">{code || "this identifier"}</span> exists in our official register. It was either not issued by us, mistyped, or fabricated.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">
              Why this receipt shows as &ldquo;Not Our Receipt&rdquo;
            </h3>

            <div className="mt-4 space-y-4">
              <div className="flex items-start gap-4">
                <span className="font-mono text-[12px] font-semibold text-[#B4343B]">01</span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#20232D]">
                    Issued by another company or third party
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                    This document does not originate from our billing system and cannot be accepted as proof of payment to us.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <span className="font-mono text-[12px] font-semibold text-[#7A7F8C]">02</span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#20232D]">
                    Check for typos in the receipt number or 10-character code
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                    Confirm the exact characters printed next to the QR code (for example, <code className="rounded bg-[#F3F4F8] px-1.5 py-0.5">RCP-2026-000101</code>).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <span className="font-mono text-[12px] font-semibold text-[#7A7F8C]">03</span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#20232D]">
                    Contact our finance team immediately
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                    If someone presented this receipt to you as proof of payment, do not release goods or services until verified directly with the issuer.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Cancelled / Voided Receipt State
  if (r === "cancelled") {
    return (
      <div className="mt-6 space-y-4">
        <div className="overflow-hidden rounded-2xl border border-[#F6D2D6] bg-white shadow-2xs">
          <div className="flex items-start gap-3.5 bg-[#FCECEE] px-6 py-5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#B4343B]/15 text-[#B4343B]">
              <Ban className="h-5 w-5 stroke-[2.25]" />
            </div>
            <div>
              <span className="inline-flex items-center rounded-md bg-[#B4343B] px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-white uppercase">
                CANCELLED / VOIDED RECEIPT
              </span>
              <h2 className="mt-1.5 font-display text-[18px] font-bold text-[#B4343B]">
                This receipt was cancelled by the issuer.
              </h2>
              <p className="mt-0.5 text-[13px] text-[#8E3B41]">
                Receipt <span className="font-mono font-semibold">{String(res["receipt_number"] ?? "")}</span> was cancelled on{" "}
                {dateTime(res["cancelled_at"] as string)} and is no longer valid as proof of payment.
              </p>
            </div>
          </div>

          <div className="p-6">
            <dl className="divide-y divide-[#E6E8EF] text-[13px]">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Receipt number</dt>
                <dd className="font-mono font-semibold text-[#20232D]">{String(res["receipt_number"] ?? "—")}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Client name</dt>
                <dd className="font-semibold text-[#20232D]">{String(res["customer"] ?? "—")}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Original total</dt>
                <dd className="font-semibold tabular text-[#20232D]">
                  {formatMoney(Number(res["total"] ?? 0), String(res["currency"] || "KES"))}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Cancellation reason</dt>
                <dd className="font-semibold text-[#B4343B]">
                  {String(res["cancel_reason"] || "Cancelled by administrator")}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    );
  }

  // 3. Draft / Unfinalized Receipt ("In Progress — Draft")
  if (r === "draft") {
    const currency = String(res["currency"] || "KES");
    const total = Number(res["total"] ?? 0);
    const amountPaid = Number(res["amount_paid"] ?? 0);
    const balanceDue = Number(res["balance_due"] ?? total);
    const pStatus = String(res["payment_status"] || "in_progress") as PaymentStatus;

    return (
      <div className="mt-6 space-y-4">
        <div className="overflow-hidden rounded-2xl border border-[#F4DFB8] bg-white shadow-2xs">
          <div className="flex items-start gap-3.5 bg-[#FCF3E3] px-6 py-5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#9A6316]/15 text-[#9A6316]">
              <Clock className="h-5 w-5 stroke-[2.25]" />
            </div>
            <div>
              <span className="inline-flex items-center rounded-md bg-[#9A6316] px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-white uppercase">
                DRAFT · IN PROGRESS (UNFINALIZED)
              </span>
              <h2 className="mt-1.5 font-display text-[18px] font-bold text-[#9A6316]">
                This receipt is still a draft in progress.
              </h2>
              <p className="mt-0.5 text-[13px] text-[#7A5216]">
                It exists in our workspace for <strong>{String(res["customer"] || "Client")}</strong>, but has not been finalized or locked yet.
              </p>
            </div>
          </div>

          <div className="p-6">
            <dl className="divide-y divide-[#E6E8EF] text-[13px]">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Draft reference</dt>
                <dd className="font-mono font-semibold text-[#20232D]">{String(res["receipt_number"] ?? "DRAFT")}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Client name</dt>
                <dd className="font-semibold text-[#20232D]">{String(res["customer"] ?? "—")}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Payment status</dt>
                <dd>
                  <PaymentStatusBadge status={pStatus} full />
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Draft total</dt>
                <dd className="font-semibold tabular text-[#20232D]">{formatMoney(total, currency)}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Amount paid / Balance due</dt>
                <dd className="font-semibold tabular text-[#20232D]">
                  {formatMoney(amountPaid, currency)} paid · {formatMoney(balanceDue, currency)} due
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    );
  }

  if (r !== "valid") return null;

  const companyName = String(res["company"] || "Northstar Studio");
  const receiptNumber = String(res["receipt_number"] || "");
  const codeDisplay = code || String(res["code_hint"] || "");
  const customer = String(res["customer"] || "");
  const issuedAt = dateTime(res["issued_at"] as string);
  const total = Number(res["total"] ?? 0);
  const paymentStatus = String(res["payment_status"] || "paid") as PaymentStatus;
  const amountPaid =
    res["amount_paid"] !== undefined && res["amount_paid"] !== null
      ? Number(res["amount_paid"])
      : paymentStatus === "paid"
        ? total
        : 0;
  const balanceDue =
    res["balance_due"] !== undefined && res["balance_due"] !== null
      ? Number(res["balance_due"])
      : Math.max(0, total - amountPaid);
  const paymentMethod = String(res["payment_method"] || "M-Pesa / Bank Transfer");
  const currency = String(res["currency"] || "KES");
  const qrTarget = `${verifyOrigin}/verify/${encodeURIComponent(code || receiptNumber)}`;
  const pMeta = getPaymentStatusMeta(paymentStatus);

  // Determine banner theme based on payment_status
  const bannerConfig = (() => {
    switch (paymentStatus) {
      case "paid":
        return {
          bg: "bg-[#E8F6EE]",
          titleColor: "text-[#16794F]",
          subColor: "text-[#2F5C47]",
          badgeBg: "bg-[#16794F]",
          badgeLabel: "AUTHENTIC · PAID IN FULL",
          title: "This receipt is authentic and paid in full.",
          subtitle: `Issued and verified by ${companyName}. Full payment of ${formatMoney(total, currency)} received.`,
          icon: <Check className="h-5 w-5 stroke-[2.5]" />,
        };
      case "half_paid":
        return {
          bg: "bg-[#EEF2FF]",
          titleColor: "text-[#3730A3]",
          subColor: "text-[#4338CA]",
          badgeBg: "bg-[#3730A3]",
          badgeLabel: "AUTHENTIC · HALF PAID / PARTIAL",
          title: "Authentic receipt — partially paid (balance remaining).",
          subtitle: `Verified by ${companyName}. ${formatMoney(amountPaid, currency)} paid so far; ${formatMoney(balanceDue, currency)} balance remains due.`,
          icon: <Clock className="h-5 w-5 stroke-[2.25]" />,
        };
      case "unpaid":
        return {
          bg: "bg-[#FCF3E3]",
          titleColor: "text-[#9A6316]",
          subColor: "text-[#7A5216]",
          badgeBg: "bg-[#9A6316]",
          badgeLabel: "AUTHENTIC · NOT PAID / UNPAID",
          title: "Authentic receipt — payment not yet received.",
          subtitle: `Issued by ${companyName}, but no payment has been recorded yet. Full balance of ${formatMoney(balanceDue, currency)} is due.`,
          icon: <AlertTriangle className="h-5 w-5 stroke-[2.25]" />,
        };
      case "in_progress":
        return {
          bg: "bg-[#E0F2FE]",
          titleColor: "text-[#0369A1]",
          subColor: "text-[#075985]",
          badgeBg: "bg-[#0369A1]",
          badgeLabel: "AUTHENTIC · IN PROGRESS / PROCESSING",
          title: "Authentic receipt — payment / settlement in progress.",
          subtitle: `Issued by ${companyName}. Payment confirmation or bank/M-Pesa settlement is currently being processed.`,
          icon: <Clock className="h-5 w-5 stroke-[2.25]" />,
        };
      case "failed":
        return {
          bg: "bg-[#FCECEE]",
          titleColor: "text-[#B4343B]",
          subColor: "text-[#8E3B41]",
          badgeBg: "bg-[#B4343B]",
          badgeLabel: "AUTHENTIC · PAYMENT FAILED / DECLINED",
          title: "Authentic receipt record — payment transaction failed.",
          subtitle: `Issued by ${companyName}, but the associated payment failed, bounced, or was reversed. ${formatMoney(balanceDue, currency)} remains unpaid.`,
          icon: <XCircle className="h-5 w-5 stroke-[2.25]" />,
        };
      case "overdue":
        return {
          bg: "bg-[#FFF1F2]",
          titleColor: "text-[#BE123C]",
          subColor: "text-[#9F1239]",
          badgeBg: "bg-[#BE123C]",
          badgeLabel: "AUTHENTIC · OVERDUE BALANCE",
          title: "Authentic receipt — balance is past due.",
          subtitle: `Issued by ${companyName}. Outstanding balance of ${formatMoney(balanceDue, currency)} is overdue for settlement.`,
          icon: <AlertCircle className="h-5 w-5 stroke-[2.25]" />,
        };
      case "refunded":
        return {
          bg: "bg-[#F3E8FF]",
          titleColor: "text-[#6B21A8]",
          subColor: "text-[#581C87]",
          badgeBg: "bg-[#6B21A8]",
          badgeLabel: "AUTHENTIC · REFUNDED",
          title: "Authentic receipt — payment was refunded to client.",
          subtitle: `Issued by ${companyName}. The payment for this receipt was returned/refunded to the client.`,
          icon: <RotateCcw className="h-5 w-5 stroke-[2.25]" />,
        };
      case "disputed":
        return {
          bg: "bg-[#FFEDD5]",
          titleColor: "text-[#C2410C]",
          subColor: "text-[#9A3412]",
          badgeBg: "bg-[#C2410C]",
          badgeLabel: "AUTHENTIC · DISPUTED / ON HOLD",
          title: "Authentic receipt — transaction under dispute or hold.",
          subtitle: `Issued by ${companyName}. This receipt is currently flagged for payment review or dispute resolution.`,
          icon: <HelpCircle className="h-5 w-5 stroke-[2.25]" />,
        };
    }
  })();

  return (
    <div className="mt-6 space-y-4">
      <div className="overflow-hidden rounded-2xl border border-[#E6E8EF] bg-white shadow-2xs">
        {/* Top Status-Specific Banner */}
        <div className={`flex items-start gap-3.5 ${bannerConfig.bg} px-6 py-5`}>
          <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${bannerConfig.titleColor}`}>
            {bannerConfig.icon}
          </div>
          <div>
            <span
              className={`inline-flex items-center rounded-md ${bannerConfig.badgeBg} px-2 py-0.5 text-[10.5px] font-bold tracking-wider text-white uppercase`}
            >
              {bannerConfig.badgeLabel}
            </span>
            <h2 className={`mt-1.5 font-display text-[18px] font-bold ${bannerConfig.titleColor}`}>
              {bannerConfig.title}
            </h2>
            <p className={`mt-0.5 text-[13px] ${bannerConfig.subColor}`}>
              {bannerConfig.subtitle}
            </p>
          </div>
        </div>

        {/* Receipt Details & QR Code */}
        <div className="grid grid-cols-1 items-center gap-6 p-6 md:grid-cols-12">
          <div className="md:col-span-8">
            <p className="text-[10px] font-bold tracking-[0.08em] text-[#7A7F8C] uppercase">
              Receipt &amp; payment details
            </p>

            <dl className="mt-3 divide-y divide-[#E6E8EF] text-[13px]">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Receipt number</dt>
                <dd className="font-mono font-semibold text-[#20232D]">{receiptNumber}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Verification code</dt>
                <dd className="font-mono font-semibold text-[#20232D]">{codeDisplay}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Client name</dt>
                <dd className="font-semibold text-[#20232D]">{customer}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Date issued</dt>
                <dd className="font-semibold text-[#20232D]">{issuedAt}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Payment status</dt>
                <dd>
                  <PaymentStatusBadge status={paymentStatus} full />
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-[#7A7F8C]">Payment method</dt>
                <dd className="font-semibold text-[#20232D]">{paymentMethod}</dd>
              </div>
            </dl>
          </div>

          <div className="md:col-span-4">
            <div className="flex flex-col items-center rounded-xl bg-[#F7F8FA] p-5 text-center">
              <div className="rounded-lg bg-white p-2.5 shadow-2xs">
                <QRCodeSVG value={qrTarget} size={104} level="M" />
              </div>
              <p className="mt-3 text-[12.5px] font-semibold text-[#20232D]">Scan to verify</p>
              <p className="mt-0.5 text-[11px] text-[#7A7F8C]">Unique to this receipt</p>
            </div>
          </div>
        </div>

        {/* Total / Paid / Balance Breakdown Footer */}
        <div className="grid grid-cols-1 gap-4 border-t border-[#E6E8EF] bg-[#FAFBFD] px-6 py-5 sm:grid-cols-3">
          <div>
            <p className="text-[11.5px] font-medium text-[#7A7F8C]">Total receipt amount</p>
            <p className="mt-1 font-display text-[20px] font-extrabold tracking-tight tabular text-[#20232D]">
              {formatMoney(total, currency)}
            </p>
          </div>

          <div>
            <p className="text-[11.5px] font-medium text-[#7A7F8C]">Amount paid</p>
            <p className="mt-1 font-display text-[20px] font-extrabold tracking-tight tabular text-[#16794F]">
              {formatMoney(amountPaid, currency)}
            </p>
          </div>

          <div>
            <p className="text-[11.5px] font-medium text-[#7A7F8C]">Balance due</p>
            <p
              className={`mt-1 font-display text-[20px] font-extrabold tracking-tight tabular ${
                balanceDue > 0 ? "text-[#B4343B]" : "text-[#20232D]"
              }`}
            >
              {formatMoney(balanceDue, currency)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E6E8EF] px-6 py-3.5 text-[12px]">
          <span className="text-[#7A7F8C]">
            Document state: <strong className="text-[#20232D]">Finalized &amp; Locked</strong>
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-[11.5px] font-semibold ${pMeta.bg} ${pMeta.text} ${pMeta.border}`}
          >
            {pMeta.fullLabel}
          </span>
        </div>
      </div>

      {/* Bottom Lavender Callout */}
      <div className="rounded-xl bg-[#EEECFC] px-6 py-4">
        <p className="text-[13px] font-bold text-[#5848D6]">Does something look different?</p>
        <p className="mt-1 text-[12.5px] text-[#5E6373]">
          Compare the payment status, amount paid, and balance due above with the physical or PDF receipt presented to you.
        </p>
      </div>
    </div>
  );
}

export function VerifyCheckAgain() {
  return (
    <div className="mt-5 text-center">
      <Link
        href="/verify"
        className="inline-flex h-9 items-center rounded-lg border border-[#E6E8EF] bg-white px-4 text-[12.5px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
      >
        Check another receipt
      </Link>
    </div>
  );
}
