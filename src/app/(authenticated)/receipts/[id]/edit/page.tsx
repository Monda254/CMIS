"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ReceiptForm, type ItemRow } from "@/components/receipt-form";

type ReceiptDetailResponse = {
  receipt: {
    id: string;
    status: "draft" | "finalized" | "cancelled";
    client_id: string;
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    notes: string;
  } | null;
  items: {
    description: string;
    quantity: string | number;
    unit_price: string | number;
  }[];
};

export default function EditReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ["receipt", id],
    queryFn: () => apiFetch<ReceiptDetailResponse>(`/api/receipts/${id}`),
  });

  if (q.isLoading) {
    return <p className="text-[13px] text-[#7A7F8C]">Loading draft receipt…</p>;
  }
  if (q.isError) {
    return <p className="text-[13px] text-[#B4343B]">Could not load this receipt.</p>;
  }
  const r = q.data!.receipt;
  if (!r) {
    return <p className="text-[13px] text-[#7A7F8C]">Receipt not found.</p>;
  }
  if (r.status !== "draft") {
    return (
      <div className="rounded-xl border border-[#E6E8EF] bg-white p-6 text-[13.5px]">
        Only drafts can be edited. Issued receipts are locked to protect authenticity —{" "}
        <Link href={`/receipts/${id}`} className="font-semibold text-[#5848D6] hover:underline">
          view print preview instead →
        </Link>
      </div>
    );
  }

  return (
    <ReceiptForm
      receiptId={id}
      initial={{
        client_id: r.client_id,
        customer_name: r.customer_name,
        customer_phone: r.customer_phone,
        customer_address: r.customer_address,
        notes: r.notes,
        items: q.data!.items.map((it) => ({
          description: it.description,
          quantity: String(it.quantity),
          unit_price: String(it.unit_price),
        })) as ItemRow[],
      }}
    />
  );
}
