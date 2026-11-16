export type PaymentStatus =
  | "paid"
  | "half_paid"
  | "unpaid"
  | "in_progress"
  | "failed"
  | "refunded"
  | "overdue"
  | "disputed";

export const PAYMENT_STATUS_OPTIONS: {
  value: PaymentStatus;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    value: "paid",
    label: "Paid in Full",
    shortLabel: "Paid",
    description: "100% of the total amount has been received.",
  },
  {
    value: "half_paid",
    label: "Half Paid / Partially Paid",
    shortLabel: "Half Paid",
    description: "Deposit or partial payment received; balance remains due.",
  },
  {
    value: "unpaid",
    label: "Not Paid / Unpaid",
    shortLabel: "Not Paid",
    description: "No payment received yet; full amount is due.",
  },
  {
    value: "in_progress",
    label: "In Progress / Processing",
    shortLabel: "In Progress",
    description: "Payment confirmation or service delivery is in progress.",
  },
  {
    value: "failed",
    label: "Payment Failed / Declined",
    shortLabel: "Failed",
    description: "Payment transaction failed, bounced, or was reversed.",
  },
  {
    value: "overdue",
    label: "Overdue",
    shortLabel: "Overdue",
    description: "Payment deadline has passed with an outstanding balance.",
  },
  {
    value: "refunded",
    label: "Refunded",
    shortLabel: "Refunded",
    description: "Payment was returned/refunded to the client.",
  },
  {
    value: "disputed",
    label: "Disputed / On Hold",
    shortLabel: "Disputed",
    description: "Transaction is under review or disputed by the payer.",
  },
];

export function getPaymentStatusMeta(status?: string | null) {
  const s = (status || "paid") as PaymentStatus;
  switch (s) {
    case "paid":
      return {
        label: "Paid",
        fullLabel: "Paid in Full",
        bg: "bg-[#E8F6EE]",
        text: "text-[#16794F]",
        border: "border-[#BDE5CE]",
      };
    case "half_paid":
      return {
        label: "Half Paid",
        fullLabel: "Half Paid · Partial",
        bg: "bg-[#EEF2FF]",
        text: "text-[#3730A3]",
        border: "border-[#C7D2FE]",
      };
    case "unpaid":
      return {
        label: "Not Paid",
        fullLabel: "Not Paid · Unpaid",
        bg: "bg-[#FCF3E3]",
        text: "text-[#9A6316]",
        border: "border-[#F4DFB8]",
      };
    case "in_progress":
      return {
        label: "In Progress",
        fullLabel: "In Progress · Processing",
        bg: "bg-[#E0F2FE]",
        text: "text-[#0369A1]",
        border: "border-[#BAE6FD]",
      };
    case "failed":
      return {
        label: "Failed",
        fullLabel: "Payment Failed",
        bg: "bg-[#FCECEE]",
        text: "text-[#B4343B]",
        border: "border-[#F6D2D6]",
      };
    case "overdue":
      return {
        label: "Overdue",
        fullLabel: "Overdue Balance",
        bg: "bg-[#FFF1F2]",
        text: "text-[#BE123C]",
        border: "border-[#FECDD3]",
      };
    case "refunded":
      return {
        label: "Refunded",
        fullLabel: "Refunded",
        bg: "bg-[#F3E8FF]",
        text: "text-[#6B21A8]",
        border: "border-[#E9D5FF]",
      };
    case "disputed":
      return {
        label: "Disputed",
        fullLabel: "Disputed · On Hold",
        bg: "bg-[#FFEDD5]",
        text: "text-[#C2410C]",
        border: "border-[#FED7AA]",
      };
    default:
      return {
        label: "Paid",
        fullLabel: "Paid in Full",
        bg: "bg-[#E8F6EE]",
        text: "text-[#16794F]",
        border: "border-[#BDE5CE]",
      };
  }
}

export function PaymentStatusBadge({
  status,
  full = false,
}: {
  status?: string | null;
  full?: boolean;
}) {
  const meta = getPaymentStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11.5px] font-semibold ${meta.bg} ${meta.text} ${meta.border}`}
    >
      {full ? meta.fullLabel : meta.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: "draft" | "finalized" | "cancelled" }) {
  const cls =
    status === "finalized"
      ? "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]"
      : status === "cancelled"
        ? "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]"
        : "border-[#F4DFB8] bg-[#FCF3E3] text-[#9A6316]";
  return (
    <span className={`inline-block rounded-md border px-2.5 py-0.5 text-[11.5px] font-semibold ${cls}`}>
      {status === "finalized" ? "Issued" : status === "cancelled" ? "Cancelled" : "Draft"}
    </span>
  );
}

const LIFECYCLE_STYLES: Record<string, { label: string; symbol: string; cls: string }> = {
  // Quotations & Invoices & Receipts
  draft: { label: "Draft", symbol: "○", cls: "border-[#F4DFB8] bg-[#FCF3E3] text-[#9A6316]" },
  sent: { label: "Issued / Sent", symbol: "●", cls: "border-[#BAE6FD] bg-[#E0F2FE] text-[#0369A1]" },
  issued: { label: "Issued", symbol: "●", cls: "border-[#BAE6FD] bg-[#E0F2FE] text-[#0369A1]" },
  approved: { label: "Accepted", symbol: "✓", cls: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
  converted: { label: "Converted to Invoice", symbol: "↗", cls: "border-[#C7D2FE] bg-[#EEF2FF] text-[#3730A3]" },
  partially_paid: { label: "Partially Paid", symbol: "◐", cls: "border-[#C7D2FE] bg-[#EEF2FF] text-[#3730A3]" },
  paid: { label: "Paid in Full", symbol: "✓", cls: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
  finalized: { label: "Finalized", symbol: "✓", cls: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
  overdue: { label: "Overdue", symbol: "!", cls: "border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C]" },
  rejected: { label: "Rejected", symbol: "✕", cls: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  expired: { label: "Expired", symbol: "◷", cls: "border-[#E6E8EF] bg-[#F3F4F8] text-[#646977]" },
  cancelled: { label: "Cancelled", symbol: "✕", cls: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  void: { label: "Void", symbol: "✕", cls: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  // Payments
  pending: { label: "Pending Confirmation", symbol: "◷", cls: "border-[#F4DFB8] bg-[#FCF3E3] text-[#9A6316]" },
  confirmed: { label: "Confirmed", symbol: "✓", cls: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
  partially_refunded: { label: "Partially Refunded", symbol: "↺", cls: "border-[#E9D5FF] bg-[#F3E8FF] text-[#6B21A8]" },
  refunded: { label: "Refunded", symbol: "↺", cls: "border-[#E9D5FF] bg-[#F3E8FF] text-[#6B21A8]" },
  reversed: { label: "Reversed", symbol: "✕", cls: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  failed: { label: "Failed", symbol: "✕", cls: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  // Reconciliation & Communications
  unmatched: { label: "Unmatched", symbol: "○", cls: "border-[#F4DFB8] bg-[#FCF3E3] text-[#9A6316]" },
  suggested: { label: "Suggested Match", symbol: "?", cls: "border-[#C7D2FE] bg-[#EEF2FF] text-[#3730A3]" },
  matched: { label: "Confirmed Match", symbol: "✓", cls: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
  queued: { label: "Queued", symbol: "◷", cls: "border-[#BAE6FD] bg-[#E0F2FE] text-[#0369A1]" },
  delivered: { label: "Delivered", symbol: "✓", cls: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
  bounced: { label: "Bounced", symbol: "!", cls: "border-[#F6D2D6] bg-[#FCECEE] text-[#B4343B]" },
  open: { label: "Open Batch", symbol: "●", cls: "border-[#BAE6FD] bg-[#E0F2FE] text-[#0369A1]" },
  in_review: { label: "In Review", symbol: "◐", cls: "border-[#C7D2FE] bg-[#EEF2FF] text-[#3730A3]" },
  completed: { label: "Completed", symbol: "✓", cls: "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]" },
};

export function DocumentStatusBadge({ status }: { status?: string | null }) {
  const key = (status ?? "draft").toLowerCase();
  const meta = LIFECYCLE_STYLES[key] ?? {
    label: status || "Unknown",
    symbol: "•",
    cls: "border-[#E6E8EF] bg-[#F3F4F8] text-[#4A4F5C]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-[11.5px] font-semibold ${meta.cls}`}
    >
      <span aria-hidden="true" className="text-[10px]">
        {meta.symbol}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
