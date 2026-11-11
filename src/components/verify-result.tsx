"use client";

import Link from "next/link";
import { Check, AlertCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { dateTime, formatMoney } from "@/lib/format";
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

  // Invalid / Not Found / Cancelled State matching 13 · Receipt verification · invalid.svg
  if (r === "invalid" || r === "not_found" || r === "cancelled") {
    const isCancelled = r === "cancelled";
    return (
      <div className="mt-6 space-y-4">
        <div className="overflow-hidden rounded-2xl border border-[#E6E8EF] bg-white shadow-2xs">
          {/* Rose Top Banner */}
          <div className="flex items-start gap-3.5 bg-[#FCECEE] px-6 py-5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#B4343B]">
              <AlertCircle className="h-5 w-5 stroke-[2.25]" />
            </div>
            <div>
              <h2 className="font-display text-[18px] font-bold text-[#B4343B]">
                {isCancelled
                  ? "This receipt was cancelled by the issuer."
                  : "We couldn’t verify this receipt."}
              </h2>
              <p className="mt-0.5 text-[13px] text-[#8E3B41]">
                {isCancelled
                  ? `Receipt ${String(res["receipt_number"] ?? "")} was cancelled on ${dateTime(res["cancelled_at"] as string)} and is no longer valid.`
                  : "No finalized receipt matches the number or code you entered."}
              </p>
            </div>
          </div>

          {/* What you can do next */}
          <div className="p-6">
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">
              What you can do next
            </h3>

            <div className="mt-5 space-y-5">
              <div className="flex items-start gap-4">
                <span className="font-mono text-[12px] font-semibold text-[#7A7F8C]">01</span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#20232D]">
                    Check your receipt number or code
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                    Look for typos, extra spaces, or similar characters.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <span className="font-mono text-[12px] font-semibold text-[#7A7F8C]">02</span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#20232D]">
                    Scan the QR code on your receipt
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                    It takes you directly to that receipt&apos;s verification page.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <span className="font-mono text-[12px] font-semibold text-[#7A7F8C]">03</span>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#20232D]">
                    Contact the issuing business
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                    Reach out to the issuer directly if the details still don&apos;t match.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Lavender Callout */}
        <div className="rounded-xl bg-[#EEECFC] px-6 py-4">
          <p className="text-[13px] font-bold text-[#5848D6]">
            Invalid does not always mean fraudulent.
          </p>
          <p className="mt-1 text-[12.5px] text-[#5E6373]">
            The code may be mistyped, the receipt may still be a draft, or it may not have been issued by
            this business.
          </p>
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
  const currency = String(res["currency"] || "KES");
  const qrTarget = `${verifyOrigin}/verify/${encodeURIComponent(code || receiptNumber)}`;

  // Valid State matching 07 · Public receipt verification.svg
  return (
    <div className="mt-6 space-y-4">
      <div className="overflow-hidden rounded-2xl border border-[#E6E8EF] bg-white shadow-2xs">
        {/* Top Green Authentic Banner */}
        <div className="flex items-start gap-3.5 bg-[#E8F6EE] px-6 py-5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#16794F]">
            <Check className="h-5 w-5 stroke-[2.5]" />
          </div>
          <div>
            <h2 className="font-display text-[18px] font-bold text-[#16794F]">
              This receipt is authentic.
            </h2>
            <p className="mt-0.5 text-[13px] text-[#2F5C47]">
              Issued and verified by {companyName}.
            </p>
          </div>
        </div>

        {/* Receipt Details & QR Code */}
        <div className="grid grid-cols-1 items-center gap-6 p-6 md:grid-cols-12">
          <div className="md:col-span-8">
            <p className="text-[10px] font-bold tracking-[0.08em] text-[#7A7F8C] uppercase">
              Receipt details
            </p>

            <dl className="mt-3 divide-y divide-[#E6E8EF] text-[13px]">
              <div className="flex items-center justify-between py-3">
                <dt className="text-[#7A7F8C]">Receipt number</dt>
                <dd className="font-mono font-semibold text-[#20232D]">{receiptNumber}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-[#7A7F8C]">Verification code</dt>
                <dd className="font-mono font-semibold text-[#20232D]">{codeDisplay}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-[#7A7F8C]">Client name</dt>
                <dd className="font-semibold text-[#20232D]">{customer}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-[#7A7F8C]">Date issued</dt>
                <dd className="font-semibold text-[#20232D]">{issuedAt}</dd>
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

        {/* Total Amount Footer */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#E6E8EF] px-6 py-5">
          <div className="flex items-baseline gap-8">
            <span className="text-[13px] text-[#7A7F8C]">Total amount</span>
            <span className="font-display text-[24px] font-extrabold tracking-tight tabular text-[#20232D]">
              {formatMoney(total, currency)}
            </span>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#E8F6EE] px-3 py-1.5 text-[12px] font-semibold text-[#16794F]">
            <Check className="h-3.5 w-3.5 stroke-[2.5]" />
            Valid · Finalized
          </span>
        </div>
      </div>

      {/* Bottom Lavender Callout */}
      <div className="rounded-xl bg-[#EEECFC] px-6 py-4">
        <p className="text-[13px] font-bold text-[#5848D6]">Does something look different?</p>
        <p className="mt-1 text-[12.5px] text-[#5E6373]">
          Compare these details with your receipt. Contact the issuer if the amount or client does not
          match.
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
