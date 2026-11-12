"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { AuthShowcasePanel } from "@/components/auth-showcase-panel";
import { errMsg } from "@/lib/format";

function ResetForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? undefined;

  async function submitResetLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      toast.success("If an account exists for that email, a reset link is on its way.");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ password, token }),
      });
      toast.success("Password updated.");
      router.push("/dashboard");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <Link
        href="/auth"
        className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
      >
        ← Back to sign in
      </Link>

      {token ? (
        <>
          <h1 className="mt-5 font-display text-[30px] font-extrabold tracking-tight text-[#20232D]">
            Set a new password
          </h1>
          <p className="mt-1.5 text-[14px] text-[#7A7F8C]">
            Choose a strong password for your workspace account.
          </p>

          <form onSubmit={submitNewPassword} className="mt-7 space-y-5">
            <div>
              <label htmlFor="pw" className="block text-[12px] font-semibold text-[#20232D]">
                New password
              </label>
              <input
                id="pw"
                type="password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="mt-1.5 h-11 w-full rounded-xl border border-[#E6E8EF] bg-white px-4 text-[13.5px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-[#5848D6] px-5 text-[13.5px] font-semibold text-white shadow-xs transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
            >
              {busy ? "Updating…" : "Save new password →"}
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 className="mt-5 font-display text-[30px] font-extrabold tracking-tight text-[#20232D]">
            Forgot your password?
          </h1>
          <p className="mt-1.5 text-[14px] text-[#7A7F8C]">
            No worries. I&apos;ll help you get back to business.
          </p>

          <form onSubmit={submitResetLink} className="mt-7 space-y-5">
            <div>
              <label htmlFor="email" className="block text-[12px] font-semibold text-[#20232D]">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sarah@northstar.example"
                className="mt-1.5 h-11 w-full rounded-xl border border-[#E6E8EF] bg-white px-4 text-[13.5px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-[#5848D6] px-5 text-[13.5px] font-semibold text-white shadow-xs transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send reset link →"}
            </button>
          </form>

          <div className="mt-6 rounded-xl bg-[#EEECFC] p-5">
            <p className="text-[12.5px] font-bold text-[#5848D6]">
              Check your inbox after submitting.
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#5E6373]">
              If an account exists for this email, you&apos;ll receive a link to securely reset your
              password. The link expires in 30 minutes.
            </p>
          </div>

          <p className="mt-6 text-[12px] text-[#7A7F8C]">
            Can&apos;t access your email? Contact your administrator.
          </p>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <AuthShowcasePanel />

      <div className="flex flex-col justify-between bg-white p-6 sm:p-12">
        <div className="lg:hidden">
          <Link href="/" className="font-display text-[24px] font-extrabold tracking-tight text-[#20232D]">
            folio
          </Link>
        </div>
        <div className="hidden lg:block" />

        <div className="my-auto flex justify-center py-8">
          <Suspense fallback={<p className="text-[13px] text-[#7A7F8C]">Loading…</p>}>
            <ResetForm />
          </Suspense>
        </div>

        <div className="space-y-3 text-center text-[12px]">
          <div>
            <Link
              href="/verify"
              className="inline-flex items-center gap-1 font-semibold text-[#5848D6] hover:underline"
            >
              Need to check a receipt? Verify a receipt
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <p className="text-[#7A7F8C]">Privacy policy · Terms of service</p>
        </div>
      </div>
    </div>
  );
}
