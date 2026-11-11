import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, QrCode, Receipt, ShieldCheck, Users } from "lucide-react";
import { PublicNav } from "@/components/public-nav";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#20232D]">
      <PublicNav />
      <main className="mx-auto max-w-[1160px] px-6 pb-24 pt-14 md:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          {/* Left Hero Column */}
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#D8D3F8] bg-[#EEECFC] px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#5848D6]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Receipt &amp; Client Management Suite
            </div>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] tracking-tight text-[#20232D] sm:text-5xl md:text-[54px]">
              Receipts your clients can trust — and anyone can verify.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#7A7F8C]">
              Create, finalize, and print crisp A4 receipts backed by sequential numbering, immutable company snapshots, and QR verification codes that confirm authenticity in seconds.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#5848D6] px-5 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#493AC0]"
              >
                Open workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/verify"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#E6E8EF] bg-white px-5 text-[14px] font-semibold text-[#20232D] shadow-xs transition-colors hover:bg-[#F7F8FA]"
              >
                <QrCode className="h-4 w-4 text-[#5848D6]" />
                Verify a receipt
              </Link>
              <Link
                href="/auth"
                className="inline-flex h-11 items-center px-3 text-[13px] font-semibold text-[#7A7F8C] transition-colors hover:text-[#20232D]"
              >
                Sign in →
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-3 gap-6 border-t border-[#E6E8EF] pt-7">
              <div>
                <p className="font-mono text-xl font-bold text-[#20232D]">100%</p>
                <p className="mt-0.5 text-[12px] text-[#7A7F8C]">Immutable issued snapshots</p>
              </div>
              <div>
                <p className="font-mono text-xl font-bold text-[#20232D]">QR + Code</p>
                <p className="mt-0.5 text-[12px] text-[#7A7F8C]">Dual-layer public verification</p>
              </div>
              <div>
                <p className="font-mono text-xl font-bold text-[#20232D]">A4 PDF</p>
                <p className="mt-0.5 text-[12px] text-[#7A7F8C]">Vector print &amp; reprint tracking</p>
              </div>
            </div>
          </div>

          {/* Right Showcase Card */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl bg-[#221D42] p-6 shadow-xl sm:p-8">
              <div className="rounded-xl bg-white p-6 text-[#20232D] shadow-lg">
                <div className="flex items-start justify-between border-b border-[#E6E8EF] pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5848D6] text-xs font-bold text-white">
                      A
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-[#20232D]">Alder Studio LLC</p>
                      <p className="text-[11px] text-[#7A7F8C]">San Francisco, CA</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F6EF] px-2.5 py-0.5 text-[10px] font-bold text-[#16794F]">
                      <CheckCircle2 className="h-3 w-3" /> Verified
                    </span>
                    <p className="mt-1 font-mono text-[11px] font-semibold text-[#7A7F8C]">RCT-2026-0184</p>
                  </div>
                </div>

                <div className="mt-4 flex items-baseline justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#7A7F8C]">Billed To</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-[#20232D]">Northwind Traders</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#7A7F8C]">Total Paid</p>
                    <p className="mt-0.5 font-display text-2xl font-bold text-[#20232D]">$2,400.00</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] p-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#7A7F8C]">Verification Code</p>
                    <p className="mt-0.5 font-mono text-[12px] font-bold text-[#5848D6]">VRF-9K4M-2810-ALDR</p>
                    <p className="mt-0.5 text-[10px] text-[#7A7F8C]">Issued Apr 18, 2026 · Bank transfer</p>
                  </div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#E6E8EF] bg-white">
                    <QrCode className="h-6 w-6 text-[#20232D]" />
                  </div>
                </div>
              </div>
              <p className="mt-4 text-center text-[12px] text-[#C5C1E8]">
                Every finalized receipt generates a unique cryptographic code &amp; QR deep-link.
              </p>
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Receipt,
              t: "Sealed on finalize",
              d: "Server-calculated totals, sequential receipt numbers, and an immutable snapshot of your company branding.",
            },
            {
              icon: Users,
              t: "Client directory & profiles",
              d: "Track every client's transaction history, lifetime spending, notes, and recent audit trail in one place.",
            },
            {
              icon: FileText,
              t: "Executive reports & exports",
              d: "Analyze daily, weekly, and monthly revenue alongside verification health and formula-safe CSV/Excel exports.",
            },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border border-[#E6E8EF] bg-white p-6 shadow-xs">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EEECFC] text-[#5848D6]">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="mt-4 text-[15px] font-bold text-[#20232D]">{f.t}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#7A7F8C]">{f.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
