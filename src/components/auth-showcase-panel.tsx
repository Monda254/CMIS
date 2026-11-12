"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Check } from "lucide-react";

export function AuthShowcasePanel() {
  return (
    <div className="hidden flex-col justify-between bg-[#221D42] p-12 text-white lg:flex">
      <div>
        <Link href="/" className="font-display text-[28px] font-extrabold tracking-tight text-white">
          folio
        </Link>
      </div>

      <div className="my-auto max-w-md py-8">
        <h2 className="font-display text-[40px] font-extrabold leading-[1.12] tracking-tight text-white">
          The details matter.
          <br />
          So does the trust.
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/70">
          Beautiful receipts. Organized clients.
          <br />A clearer picture of your business.
        </p>

        {/* Floating Verified Receipt Preview Card */}
        <div className="mt-9 rounded-2xl bg-white p-6 text-[#20232D] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#E6E8EF] pb-3.5">
            <span className="font-display text-[11px] font-extrabold tracking-wider text-[#20232D] uppercase">
              NORTHSTAR STUDIO
            </span>
            <span className="font-mono text-[11px] text-[#7A7F8C]">RCP-2026-000125</span>
          </div>

          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold tracking-[0.08em] text-[#7A7F8C] uppercase">
                Receipt for
              </p>
              <p className="mt-1 font-display text-[18px] font-bold text-[#20232D]">Olivia Rhye</p>
              <p className="mt-0.5 text-[11.5px] text-[#7A7F8C]">
                Brand consultation &amp; print production
              </p>
              <p className="mt-4 font-display text-[26px] font-extrabold tracking-tight tabular text-[#20232D]">
                $1,250.00
              </p>
            </div>

            <div className="shrink-0 rounded-lg bg-white p-1">
              <QRCodeSVG value="https://folio.example/verify/DTX7K9P2A5" size={82} level="M" />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-[#E8F6EE] px-3.5 py-2 text-[11.5px] font-semibold text-[#16794F]">
            <span className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 stroke-[2.5]" />
              Verified receipt
            </span>
            <span className="font-mono">DTX7K9P2A5</span>
          </div>
        </div>

        <div className="mt-8">
          <p className="text-[13.5px] font-semibold text-white">
            One workspace. Every transaction, accounted for.
          </p>
          <p className="mt-1 text-[12px] text-white/60">
            Create in seconds · Print professionally · Verify instantly
          </p>
        </div>
      </div>

      <p className="text-[11.5px] text-white/50">© 2026 folio. Built for everyday business.</p>
    </div>
  );
}
