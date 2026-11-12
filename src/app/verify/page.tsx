"use client";

import { useState } from "react";
import { VerifyResultCard } from "@/components/verify-result";
import { checkReceipt, type VerifyResult } from "@/lib/verify";
import { PublicNav } from "@/components/public-nav";

const SAMPLE_RECEIPT_CHIPS: {
  label: string;
  code: string;
  badgeClass: string;
}[] = [
  { label: "Paid in Full", code: "PAID2026KE", badgeClass: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
  { label: "Half Paid", code: "HALF2026KE", badgeClass: "border-[#C7D2FE] bg-[#EEF2FF] text-[#3730A3]" },
  { label: "Not Paid", code: "UNPD2026KE", badgeClass: "border-[#F4DFB8] bg-[#FCF3E3] text-[#9A6316]" },
  { label: "In Progress", code: "PROG2026KE", badgeClass: "border-[#BAE6FD] bg-[#E0F2FE] text-[#0369A1]" },
  { label: "Failed", code: "FAIL2026KE", badgeClass: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  { label: "Overdue", code: "OVRD2026KE", badgeClass: "border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C]" },
  { label: "Refunded", code: "RFND2026KE", badgeClass: "border-[#E9D5FF] bg-[#F3E8FF] text-[#6B21A8]" },
  { label: "Disputed", code: "DISP2026KE", badgeClass: "border-[#FED7AA] bg-[#FFEDD5] text-[#C2410C]" },
  { label: "Cancelled", code: "CANC2026KE", badgeClass: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  { label: "Draft (Unfinalized)", code: "RCP-2026-DRAFT1", badgeClass: "border-[#F4DFB8] bg-[#FCF3E3] text-[#9A6316]" },
  { label: "Not Our Receipt", code: "FAKE9999XX", badgeClass: "border-[#20232D] bg-[#20232D] text-white" },
];

export default function VerifyPage() {
  const [code, setCode] = useState("");
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function runVerify(targetCode: string) {
    const clean = targetCode.trim().toUpperCase();
    if (!clean || busy) return;
    setCode(clean);
    setBusy(true);
    setRes(await checkReceipt(clean));
    setBusy(false);
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    await runVerify(code);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F7F8FA]">
      <PublicNav companyName={typeof res?.["company"] === "string" ? res["company"] : undefined} />

      <main className="mx-auto w-full max-w-[700px] flex-1 px-4 py-12 sm:px-6">
        {/* Hero */}
        <div className="text-center">
          <p className="text-[11px] font-bold tracking-[0.08em] text-[#5848D6] uppercase">
            Trust, without the guesswork
          </p>
          <h1 className="mt-2.5 font-display text-[32px] font-extrabold tracking-tight text-[#20232D] sm:text-[36px]">
            Is your receipt the real thing?
          </h1>
          <p className="mt-2 text-[14.5px] text-[#7A7F8C]">
            Verify any receipt instantly — see whether it is Paid, Half Paid, Not Paid, In Progress, Failed, Cancelled, or Not Our Receipt.
          </p>
        </div>

        {/* Search Input Card */}
        <div className="mt-8 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xs">
          <form onSubmit={check}>
            <label className="block text-[12.5px] font-semibold text-[#20232D]">
              Receipt number or verification code
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                required
                maxLength={40}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="PAID2026KE or RCP-2026-000101"
                className="h-11 flex-1 rounded-xl border border-[#E6E8EF] bg-white px-4 font-mono text-[14px] font-medium text-[#20232D] outline-none placeholder:font-sans placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-[#5848D6] px-6 text-[13.5px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
              >
                {busy ? "Checking…" : "Verify receipt →"}
              </button>
            </div>
            <p className="mt-2.5 text-[11.5px] text-[#7A7F8C]">
              You can find the code near the QR code on your receipt, or click any sample receipt type below to test live verification:
            </p>

            {/* Quick Sample Chips for All Receipt Types */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SAMPLE_RECEIPT_CHIPS.map((sample) => (
                <button
                  key={sample.code}
                  type="button"
                  disabled={busy}
                  onClick={() => runVerify(sample.code)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-transform active:scale-95 disabled:opacity-50 ${sample.badgeClass}`}
                >
                  <span>{sample.label}</span>
                  <span className="font-mono text-[10px] opacity-75">({sample.code})</span>
                </button>
              ))}
            </div>
          </form>
        </div>

        {/* Result Card */}
        {res && <VerifyResultCard res={res} code={code.trim().toUpperCase()} />}
      </main>

      <footer className="py-8 text-center text-[11.5px] text-[#7A7F8C]">
        Powered by folio · Receipt verification does not require payment or personal information.
      </footer>
    </div>
  );
}
