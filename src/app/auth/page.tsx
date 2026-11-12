"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { AuthShowcasePanel } from "@/components/auth-showcase-panel";
import { apiFetch } from "@/lib/api-client";
import { errMsg } from "@/lib/format";

function safePath(p?: string | null) {
  if (!p) return "/dashboard";
  if (p.startsWith("/") && !p.startsWith("//")) return p;
  try {
    const u = new URL(p, window.location.origin);
    if (u.origin !== window.location.origin) return "/dashboard";
    return u.pathname + u.search;
  } catch {
    return "/dashboard";
  }
}

function AuthForm() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const router = useRouter();
  const qc = useQueryClient();

  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        await qc.invalidateQueries({ queryKey: ["me"] });
        router.push(safePath(redirect));
        router.refresh();
      } else if (mode === "signup") {
        await apiFetch("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, password, fullName: name }),
        });
        await qc.invalidateQueries({ queryKey: ["me"] });
        toast.success("Account created and signed in.");
        router.push(safePath(redirect));
        router.refresh();
      } else {
        await apiFetch("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        toast.success("If an account exists for that email, a reset link is on its way.");
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  // Forgot Password Mode (matches 14 · Reset password.svg)
  if (mode === "forgot") {
    return (
      <div className="w-full max-w-[400px]">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
        >
          ← Back to sign in
        </button>

        <h1 className="mt-5 font-display text-[30px] font-extrabold tracking-tight text-[#20232D]">
          Forgot your password?
        </h1>
        <p className="mt-1.5 text-[14px] text-[#7A7F8C]">
          No worries. I&apos;ll help you get back to business.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-5">
          <div>
            <label htmlFor="forgot-email" className="block text-[12px] font-semibold text-[#20232D]">
              Email address
            </label>
            <input
              id="forgot-email"
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
      </div>
    );
  }

  // Sign In / Sign Up Mode (matches 12 · Sign in.svg)
  return (
    <div className="w-full max-w-[400px]">
      <h1 className="font-display text-[30px] font-extrabold tracking-tight text-[#20232D]">
        {mode === "signin" ? "Welcome back." : "Create workspace account."}
      </h1>
      <p className="mt-1.5 text-[14px] text-[#7A7F8C]">
        {mode === "signin"
          ? "Sign in to your Northstar Studio workspace."
          : "The very first account created automatically becomes the workspace administrator."}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-5">
        {mode === "signup" && (
          <div>
            <label htmlFor="name" className="block text-[12px] font-semibold text-[#20232D]">
              Full name
            </label>
            <input
              id="name"
              type="text"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sarah Mitchell"
              className="mt-1.5 h-11 w-full rounded-xl border border-[#E6E8EF] bg-white px-4 text-[13.5px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
            />
          </div>
        )}

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

        <div>
          <label htmlFor="password" className="block text-[12px] font-semibold text-[#20232D]">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="mt-1.5 h-11 w-full rounded-xl border border-[#E6E8EF] bg-white px-4 text-[13.5px] text-[#20232D] outline-none placeholder:text-[#7A7F8C] focus:border-[#5848D6]"
          />
        </div>

        {mode === "signin" && (
          <div className="flex items-center justify-between text-[12.5px]">
            <label className="flex items-center gap-2 font-medium text-[#20232D] cursor-pointer">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
                className="h-4 w-4 rounded border-[#E6E8EF] text-[#5848D6]"
              />
              Keep me signed in
            </label>

            <button
              type="button"
              onClick={() => setMode("forgot")}
              className="font-semibold text-[#5848D6] hover:underline"
            >
              Forgot password?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-[#5848D6] px-5 text-[13.5px] font-semibold text-white shadow-xs transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
        >
          {busy
            ? "Signing in…"
            : mode === "signin"
              ? "Sign in to workspace →"
              : "Create workspace account →"}
        </button>
      </form>

      <p className="mt-4 text-[11.5px] text-[#7A7F8C]">
        Your access is based on your assigned workspace role.
      </p>

      <div className="mt-6 border-t border-[#E6E8EF] pt-5 text-[12.5px] text-[#7A7F8C]">
        {mode === "signin" ? (
          <div className="flex items-center justify-between">
            <span>Need an account?</span>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className="font-semibold text-[#5848D6] hover:underline"
            >
              Create staff account →
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMode("signin")}
            className="font-semibold text-[#5848D6] hover:underline"
          >
            ← Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

export default function AuthPage() {
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
            <AuthForm />
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
