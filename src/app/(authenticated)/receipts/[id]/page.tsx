"use client";

import { use } from "react";
import { ReceiptPrintPreview } from "@/components/receipt-print-preview";

export default function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReceiptPrintPreview id={id} />;
}
