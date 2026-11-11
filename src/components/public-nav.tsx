"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function PublicNav({ companyName }: { companyName?: string }) {
  return (
    <header className="border-b border-[#E6E8EF] bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Folio home"
            className="font-display text-[24px] font-extrabold tracking-tight text-[#20232D]"
          >
            folio
          </Link>
          <span className="text-[#C4C8D4]">/</span>
          <Link href="/verify" className="text-[13px] font-medium text-[#7A7F8C] hover:text-[#20232D]">
            Receipt verification
          </Link>
        </div>

        <nav aria-label="Main navigation" className="flex items-center gap-4">
          <span className="hidden text-[12.5px] font-medium text-[#7A7F8C] sm:inline">
            {companyName ? `For ${companyName}` : "Instant cryptographic check"}
          </span>
          <Link
            href="/auth"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[12.5px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            Sign in
            <ArrowUpRight className="h-3.5 w-3.5 text-[#7A7F8C]" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
