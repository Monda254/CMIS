export type VerifyResult = Record<string, string | number | null>;

/** Check a receipt number or verification code through the public, rate-limited endpoint. */
export async function checkReceipt(identifier: string): Promise<VerifyResult> {
  try {
    const res = await fetch("/api/public/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    if (!res.ok) return { result: "error" };
    return (await res.json()) as VerifyResult;
  } catch {
    return { result: "error" };
  }
}
