export function StatusBadge({ status }: { status: "draft" | "finalized" | "cancelled" }) {
  const cls =
    status === "finalized"
      ? "border-success text-success"
      : status === "cancelled"
        ? "border-destructive text-destructive"
        : "border-muted-foreground text-muted-foreground";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status === "finalized" ? "Issued" : status === "cancelled" ? "Cancelled" : "Draft"}
    </span>
  );
}
