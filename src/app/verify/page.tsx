"use client";

import { useState } from "react";
import { VerifyResultCard } from "@/components/verify-result";
import { checkReceipt, type VerifyResult } from "@/lib/verify";
import { PublicNav } from "@/components/public-nav";

export default function VerifyPage() {
  const [code, setCode] = useState("");
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setRes(await checkReceipt(code));
    setBusy(false);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F7F8FA]">
      <PublicNav companyName={typeof res?.["company"] === "string" ? res["company"] : undefined} />

      <main className="mx-auto w-full max-w-[660px] flex-1 px-4 py-12 sm:px-6">
        {/* Hero */}
        <div className="text-center">
          <p className="text-[11px] font-bold tracking-[0.08em] text-[#5848D6] uppercase">
            Trust, without the guesswork
          </p>
          <h1 className="mt-2.5 font-display text-[32px] font-extrabold tracking-tight text-[#20232D] sm:text-[36px]">
            Is your receipt the real thing?
          </h1>
          <p className="mt-2 text-[14.5px] text-[#7A7F8C]">
            Verify a receipt instantly. No account needed.
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
                placeholder="DTX7K9P2A5 or RCP-2026-000125"
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
              You can find the code near the QR code on your receipt.
            </p>
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
