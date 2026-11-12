export function money(value: number | string | null | undefined, currency = "KES") {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return `${currency} ${safe.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const formatMoney = money;

export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export function dateOnly(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-KE", { dateStyle: "medium" });
}

export const formatDate = dateOnly;

/**
 * Sanitize user-typed strings before exporting to CSV/Excel to prevent
 * spreadsheet formula injection (=, +, -, @, tab, CR).
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
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
