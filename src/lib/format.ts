export function money(value: number | string | null | undefined, currency = "KES") {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return `${currency} ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export function dateOnly(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-KE", { dateStyle: "medium" });
}

/** Preview-only line total in cents to avoid float drift; server is authoritative. */
export function previewLineTotal(qty: string, price: string) {
  const q = Number(qty);
  const p = Math.round(Number(price) * 100);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
  return Math.round(q * p) / 100;
}

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
