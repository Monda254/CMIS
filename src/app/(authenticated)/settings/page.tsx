"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { BrandingImg } from "@/components/branding-img";
import { errMsg } from "@/lib/format";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"];

type SettingsRow = {
  id: number;
  name: string;
  address: string;
  phone: string;
  email: string;
  footer: string;
  currency: string;
  number_prefix: string;
  logo_url: string | null;
  stamp_url: string | null;
  signature_url: string | null;
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const s = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsRow>("/api/settings"),
  });

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [footer, setFooter] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [prefix, setPrefix] = useState("RCP");
  const [timeZone, setTimeZone] = useState("Africa/Nairobi (UTC+03:00)");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!s.data) return;
    setName(s.data.name ?? "");
    setAddress(s.data.address ?? "");
    setPhone(s.data.phone ?? "");
    setEmail(s.data.email ?? "");
    setFooter(s.data.footer ?? "");
    setCurrency(s.data.currency ?? "KES");
    setPrefix(s.data.number_prefix ?? "RCP");
  }, [s.data]);

  function discardChanges() {
    if (!s.data) return;
    setName(s.data.name ?? "");
    setAddress(s.data.address ?? "");
    setPhone(s.data.phone ?? "");
    setEmail(s.data.email ?? "");
    setFooter(s.data.footer ?? "");
    setCurrency(s.data.currency ?? "KES");
    setPrefix(s.data.number_prefix ?? "RCP");
    setError(null);
    toast.info("Reverted unsaved changes");
  }

  async function save(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    const cur = currency.trim().toUpperCase();
    const pfx = prefix.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) {
      setError("Currency must be a 3-letter ISO code (e.g. KES, USD).");
      return;
    }
    if (!/^[A-Z0-9]{1,8}$/.test(pfx)) {
      setError("Receipt number prefix must be 1–8 letters or digits (e.g. RCP).");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim(),
          phone: phone.trim(),
          email: email.trim(),
          footer: footer.trim(),
          currency: cur,
          number_prefix: pfx,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      await qc.invalidateQueries({ queryKey: ["shell-quick-stats"] });
      toast.success("Company settings saved");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function uploadAsset(field: "logo_url" | "stamp_url" | "signature_url", file: File) {
    setError(null);
    if (!ALLOWED_MIME.includes(file.type)) {
      setError("Please upload a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image is larger than 2 MB. Please choose a smaller file.");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("field", field);
      formData.append("file", file);
      const res = await fetch("/api/settings/branding", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Upload failed");
      }
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Branding asset updated");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function removeAsset(field: "logo_url" | "stamp_url" | "signature_url") {
    setError(null);
    try {
      const res = await fetch(`/api/settings/branding?field=${field}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Could not remove asset");
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Branding asset removed");
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const nextReceiptPreview = `${prefix.trim().toUpperCase() || "RCP"}-${new Date().getFullYear()}-000129`;

  const brandingCards = [
    {
      field: "logo_url" as const,
      title: "Company logo",
      path: s.data?.logo_url ?? null,
      fallback: (
        <div className="text-center">
          <p className="font-display text-[15px] font-extrabold tracking-tight text-[#20232D] uppercase">
            {name || "NORTHSTAR"}
          </p>
          <p className="text-[8.5px] tracking-[0.22em] text-[#7A7F8C] uppercase">STUDIO</p>
        </div>
      ),
    },
    {
      field: "stamp_url" as const,
      title: "Company stamp",
      path: s.data?.stamp_url ?? null,
      fallback: (
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-[#5848D6]/70">
          <span className="font-display text-[11px] font-bold text-[#5848D6]">PAID</span>
        </div>
      ),
    },
    {
      field: "signature_url" as const,
      title: "Authorized signature",
      path: s.data?.signature_url ?? null,
      fallback: (
        <span className="font-serif text-[17px] italic text-[#20232D]">S. Mitchell</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header matching 09 · Company settings.svg */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Company settings
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Make every receipt feel like your business.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={discardChanges}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[#E6E8EF] bg-white px-4 text-[13px] font-semibold text-[#20232D] shadow-2xs transition-colors hover:bg-[#F7F8FA]"
          >
            Discard changes
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => save()}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#5848D6] px-5 text-[13px] font-semibold text-white shadow-2xs transition-colors hover:bg-[#4C3EC2] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#F6D2D6] bg-[#FCECEE] px-4 py-3 text-[13px] font-medium text-[#B4343B]">
          {error}
        </div>
      )}

      {/* Main 2-Column Layout (8:4 split) */}
      <form onSubmit={save} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Company Information + Receipt Branding (8 cols) */}
        <div className="space-y-6 lg:col-span-8">
          {/* Company Information Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 space-y-5">
            <div>
              <h2 className="font-display text-[16px] font-bold text-[#20232D]">
                Company information
              </h2>
              <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
                These details appear on every receipt you issue.
              </p>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Company name</label>
              <input
                type="text"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Northstar Studio"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Address</label>
              <input
                type="text"
                maxLength={500}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="18 W 27th Street, New York, NY 10001"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Phone number</label>
                <input
                  type="text"
                  maxLength={60}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (212) 555-0100"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Email address</label>
                <input
                  type="email"
                  maxLength={200}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="hello@northstar.example"
                  className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">
                Receipt footer message
              </label>
              <textarea
                rows={3}
                maxLength={500}
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Thank you for your business. We look forward to working with you again."
                className="mt-1.5 w-full rounded-lg border border-[#E6E8EF] bg-white p-3.5 text-[13px] text-[#20232D] outline-none focus:border-[#5848D6]"
              />
              <p className="mt-1.5 text-[11px] text-[#7A7F8C]">
                Shown at the bottom of printed and downloaded receipts.
              </p>
            </div>
          </div>

          {/* Receipt Branding Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Receipt branding</h2>
            <p className="mt-0.5 text-[12.5px] text-[#7A7F8C]">
              Upload PNG, JPG, or WebP · Up to 2 MB per asset
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {brandingCards.map((item) => (
                <div
                  key={item.field}
                  className="flex flex-col justify-between rounded-xl border border-[#E6E8EF] p-4"
                >
                  <div>
                    <p className="text-[12px] font-semibold text-[#20232D]">{item.title}</p>
                    <div className="mt-3 flex h-24 items-center justify-center rounded-lg bg-[#F7F8FA] p-3">
                      {item.path ? (
                        <BrandingImg
                          path={item.path}
                          alt={item.title}
                          className="max-h-16 max-w-full object-contain"
                        />
                      ) : (
                        item.fallback
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-[#16794F]">
                      <Check className="h-3 w-3" />
                      {item.path ? "Uploaded" : "Default active"}
                    </p>

                    <div className="mt-2 flex items-center justify-between text-[11.5px]">
                      <label className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[#5848D6] hover:underline">
                        <Upload className="h-3 w-3" />
                        Replace
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadAsset(item.field, f);
                            e.target.value = "";
                          }}
                        />
                      </label>

                      {item.path && (
                        <button
                          type="button"
                          onClick={() => removeAsset(item.field)}
                          className="text-[#7A7F8C] hover:text-[#B4343B]"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Receipt Defaults + Info Cards (4 cols) */}
        <div className="space-y-5 lg:col-span-4">
          {/* Receipt Defaults Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 space-y-4">
            <h2 className="font-display text-[16px] font-bold text-[#20232D]">Receipt defaults</h2>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">
                Receipt number prefix
              </label>
              <input
                type="text"
                maxLength={8}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                placeholder="RCP"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3.5 font-mono text-[13px] font-semibold text-[#20232D] outline-none focus:border-[#5848D6]"
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">
                Default currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                aria-label="Default currency"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="KES">KES — Kenyan Shilling</option>
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="UGX">UGX — Ugandan Shilling</option>
                <option value="TZS">TZS — Tanzanian Shilling</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Time zone</label>
              <select
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                aria-label="Time zone"
                className="mt-1.5 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px] font-medium text-[#20232D] outline-none focus:border-[#5848D6]"
              >
                <option value="Africa/Nairobi (UTC+03:00)">Nairobi (UTC+03:00)</option>
                <option value="America/New_York (UTC-05:00)">New York (UTC-05:00)</option>
                <option value="Europe/London (UTC+00:00)">London (UTC+00:00)</option>
              </select>
            </div>

            <p className="pt-2 text-[11.5px] text-[#7A7F8C]">
              Next receipt: <span className="font-mono font-medium">{nextReceiptPreview}</span>
            </p>
          </div>

          {/* Authenticity Is Always On Card */}
          <div className="rounded-xl bg-[#EEECFC] p-6">
            <h3 className="font-display text-[15px] font-bold text-[#5848D6]">
              Authenticity is always on.
            </h3>
            <ul className="mt-3.5 space-y-2.5 text-[12.5px] text-[#5E6373]">
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-[#5848D6]" />
                Unique verification codes
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-[#5848D6]" />
                QR code on every finalized receipt
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-[#5848D6]" />
                Finalized receipt tamper protection
              </li>
            </ul>
          </div>

          {/* Looking Good On Paper Card */}
          <div className="rounded-xl border border-[#E6E8EF] bg-white p-6">
            <h3 className="font-display text-[15px] font-bold text-[#20232D]">
              Looking good on paper.
            </h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#7A7F8C]">
              Preview how your company details, logo, stamp, and signature appear on an A4 receipt.
            </p>
            <div className="mt-4">
              <Link
                href="/receipts/new"
                className="text-[12.5px] font-semibold text-[#5848D6] hover:underline"
              >
                Open receipt preview →
              </Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
