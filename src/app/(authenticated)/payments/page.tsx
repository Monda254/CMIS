"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CheckCircle2,
  CreditCard,
  FileText,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { ibmsApi } from "@/lib/api/client";
import type { InvoiceDTO, PaymentDTO } from "@/lib/api/types";
import { useMe } from "@/lib/auth";
import { dateTime, errMsg, formatMoney } from "@/lib/format";
import { hasPermission, isAdminUser } from "@/lib/permissions";
import { DocumentStatusBadge } from "@/components/status-badge";

type ClientOption = { id: string; name: string; phone: string; address: string };

export default function PaymentsPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const canWrite = hasPermission(me.data, "payments:write");
  const canConfirm = hasPermission(me.data, "payments:confirm");
  const canAllocate = hasPermission(me.data, "payments:allocate");
  const canFinalizeReceipt = hasPermission(me.data, "receipts:finalize");
  const isAdmin = isAdminUser(me.data);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");

  // Record Payment Modal
  const [recordOpen, setRecordOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"mpesa" | "bank_transfer" | "cash" | "card" | "cheque">("mpesa");
  const [externalRef, setExternalRef] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmImmediately, setConfirmImmediately] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Allocate Modal
  const [allocateTarget, setAllocateTarget] = useState<PaymentDTO | null>(null);
  const [targetInvoiceId, setTargetInvoiceId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");

  // Reverse / Refund Modal
  const [reverseTarget, setReverseTarget] = useState<PaymentDTO | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [busyAction, setBusyAction] = useState(false);

  const paymentsQuery = useQuery({
    queryKey: ["ibms-payments", statusFilter, methodFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ page_size: "100" });
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (methodFilter !== "all") qs.set("payment_method", methodFilter);
      return ibmsApi.payments.list(qs.toString());
    },
  });

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<ClientOption[]>("/api/clients"),
  });

  const invoicesQuery = useQuery({
    queryKey: ["ibms-invoices-open"],
    queryFn: () => ibmsApi.invoices.list("page_size=100"),
  });

  const allPayments = paymentsQuery.data?.data ?? [];
  const clients = clientsQuery.data ?? [];
  const allInvoices: InvoiceDTO[] = invoicesQuery.data?.data ?? [];

  const clientMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allPayments;
    return allPayments.filter((p) => {
      const cName = (clientMap.get(p.client_id) ?? "").toLowerCase();
      return (
        p.payment_reference.toLowerCase().includes(q) ||
        (p.external_reference ?? "").toLowerCase().includes(q) ||
        cName.includes(q)
      );
    });
  }, [allPayments, search, clientMap]);

  const eligibleClientInvoices = useMemo(() => {
    if (!allocateTarget) return [];
    return allInvoices.filter(
      (inv) =>
        inv.client_id === allocateTarget.client_id &&
        ["issued", "partially_paid", "overdue"].includes(inv.status) &&
        Number(inv.balance_due) > 0,
    );
  }, [allInvoices, allocateTarget]);

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!clientId) {
      setFormError("Please select a client.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setFormError("Payment amount must be greater than zero.");
      return;
    }
    setBusyAction(true);
    try {
      const res = await ibmsApi.payments.create({
        client_id: clientId,
        amount: Number(amount).toFixed(2),
        payment_method: paymentMethod,
        external_reference: externalRef.trim() || null,
        notes: notes.trim(),
        confirm_immediately: confirmImmediately,
      });
      toast.success(res.message);
      setRecordOpen(false);
      setAmount("");
      setExternalRef("");
      setNotes("");
      await qc.invalidateQueries({ queryKey: ["ibms-payments"] });
    } catch (err) {
      setFormError(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleConfirmPayment(pay: PaymentDTO) {
    setBusyAction(true);
    try {
      const res = await ibmsApi.payments.confirm(pay.id);
      toast.success(`Payment ${res.data.payment_reference} confirmed`);
      await qc.invalidateQueries({ queryKey: ["ibms-payments"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleAllocateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allocateTarget || !targetInvoiceId || Number(allocAmount) <= 0) return;
    setBusyAction(true);
    try {
      await ibmsApi.payments.allocate(allocateTarget.id, [
        { invoice_id: targetInvoiceId, amount: Number(allocAmount).toFixed(2) },
      ]);
      toast.success("Payment allocated to invoice successfully");
      setAllocateTarget(null);
      setTargetInvoiceId("");
      setAllocAmount("");
      await qc.invalidateQueries({ queryKey: ["ibms-payments"] });
      await qc.invalidateQueries({ queryKey: ["ibms-invoices"] });
      await qc.invalidateQueries({ queryKey: ["ibms-invoices-open"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleGenerateReceipt(pay: PaymentDTO) {
    setBusyAction(true);
    try {
      const firstInvoiceId = pay.allocations.find((a) => a.status === "active")?.invoice_id ?? null;
      const res = await ibmsApi.receipts.generateFromPayment({
        payment_id: pay.id,
        invoice_id: firstInvoiceId,
      });
      toast.success(`Official Receipt ${res.data.receipt_number} generated`);
      await qc.invalidateQueries({ queryKey: ["ibms-payments"] });
      router.push(`/receipts/${res.data.id}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReverseSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reverseTarget || reverseReason.trim().length < 3) return;
    setBusyAction(true);
    try {
      await ibmsApi.payments.reverse(reverseTarget.id, reverseReason.trim());
      toast.success("Payment reversed while preserving historical audit trail");
      setReverseTarget(null);
      setReverseReason("");
      await qc.invalidateQueries({ queryKey: ["ibms-payments"] });
      await qc.invalidateQueries({ queryKey: ["ibms-invoices"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusyAction(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Payments & Allocations
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Record incoming payments, confirm receipt of funds, allocate partial or full amounts to invoices, and issue verifiable receipts.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              if (!clientId && clients[0]) setClientId(clients[0].id);
              setRecordOpen(true);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white shadow-xs hover:bg-[#4C3EC2]"
          >
            <Plus className="h-4 w-4" />
            Record Payment
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6E8EF] bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {["all", "pending", "confirmed", "partially_refunded", "refunded", "reversed"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium capitalize transition-colors ${
                statusFilter === st
                  ? "bg-[#EEECFC] font-semibold text-[#5848D6]"
                  : "text-[#646977] hover:bg-[#F7F8FA] hover:text-[#20232D]"
              }`}
            >
              {st.replace("_", " ")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            aria-label="Filter by payment method"
            className="h-9 rounded-lg border border-[#E6E8EF] bg-white px-3 text-[12.5px]"
          >
            <option value="all">All Methods</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, M-Pesa code, client..."
            aria-label="Search payments"
            className="h-9 w-full rounded-lg border border-[#E6E8EF] bg-[#F7F8FA] px-3 text-[13px] outline-none focus:border-[#5848D6] sm:w-64"
          />
        </div>
      </div>

      {/* Payments Table */}
      <div className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white">
        {paymentsQuery.isLoading ? (
          <div className="p-8 text-center text-[13px] text-[#7A7F8C]">Loading payments...</div>
        ) : paymentsQuery.isError ? (
          <div className="p-8 text-center text-[13px] text-[#B4343B]">
            Failed to load payments: {errMsg(paymentsQuery.error)}
          </div>
        ) : filteredPayments.length === 0 ? (
          <div className="p-12 text-center">
            <CreditCard className="mx-auto h-9 w-9 text-[#C4C8D4]" />
            <p className="mt-3 font-display text-[15px] font-bold text-[#20232D]">No payments recorded yet</p>
            <p className="mt-1 text-[13px] text-[#7A7F8C]">
              Record a payment to confirm funds received and allocate against open client invoices.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[11px] font-semibold tracking-wider text-[#7A7F8C] uppercase">
                  <th className="px-4 py-3">Payment Ref</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Method & Ext. Ref</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Unallocated</th>
                  <th className="px-4 py-3 text-right">Receipted</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF] text-[13px]">
                {filteredPayments.map((pay) => {
                  const unreceiptedBalance =
                    Math.round(
                      (Number(pay.amount) - Number(pay.amount_refunded) - Number(pay.amount_receipted)) * 100,
                    ) / 100;
                  return (
                    <tr key={pay.id} className="hover:bg-[#F7F8FA]/70">
                      <td className="px-4 py-3.5 font-mono font-semibold text-[#5848D6]">
                        {pay.payment_reference}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-[#20232D]">
                        {clientMap.get(pay.client_id) || "Client"}
                      </td>
                      <td className="px-4 py-3.5 text-[12.5px]">
                        <span className="font-semibold uppercase text-[#20232D]">{pay.payment_method}</span>
                        {pay.external_reference && (
                          <span className="ml-1.5 font-mono text-[11.5px] text-[#7A7F8C]">
                            ({pay.external_reference})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-[12px] text-[#646977]">{dateTime(pay.payment_date)}</td>
                      <td className="px-4 py-3.5">
                        <DocumentStatusBadge status={pay.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold tabular text-[#20232D]">
                        {formatMoney(pay.amount, pay.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular text-[#0369A1]">
                        {formatMoney(pay.unallocated_amount, pay.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular text-[#16794F]">
                        {formatMoney(pay.amount_receipted, pay.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {pay.status === "pending" && canConfirm && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => handleConfirmPayment(pay)}
                              className="inline-flex items-center gap-1 rounded-md bg-[#16794F] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#12633F]"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Confirm
                            </button>
                          )}
                          {pay.status === "confirmed" && Number(pay.unallocated_amount) > 0 && canAllocate && (
                            <button
                              type="button"
                              onClick={() => {
                                setAllocateTarget(pay);
                                setAllocAmount(pay.unallocated_amount);
                                setTargetInvoiceId("");
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-[#5848D6] bg-[#EEECFC] px-2.5 py-1 text-[11.5px] font-semibold text-[#5848D6]"
                            >
                              <ArrowRightLeft className="h-3 w-3" />
                              Allocate
                            </button>
                          )}
                          {pay.status === "confirmed" && unreceiptedBalance > 0 && canFinalizeReceipt && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => handleGenerateReceipt(pay)}
                              className="inline-flex items-center gap-1 rounded-md bg-[#5848D6] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#4C3EC2]"
                            >
                              <FileText className="h-3 w-3" />
                              Issue Receipt
                            </button>
                          )}
                          {pay.status === "confirmed" && isAdmin && (
                            <button
                              type="button"
                              onClick={() => setReverseTarget(pay)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#F6D2D6] bg-[#FCECEE] px-2 py-1 text-[11.5px] font-medium text-[#B4343B]"
                              title="Reverse Payment"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {recordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleRecordPayment}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#E6E8EF] pb-3">
              <div>
                <h2 className="font-display text-[18px] font-bold text-[#20232D]">Record Client Payment</h2>
                <p className="text-[12px] text-[#7A7F8C]">
                  Do not enter payment card PANs or CVVs. Use external transaction references only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRecordOpen(false)}
                className="rounded-lg p-1.5 text-[#7A7F8C] hover:bg-[#F3F4F8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError && (
              <div role="alert" className="rounded-lg border border-[#F6D2D6] bg-[#FCECEE] px-3.5 py-2.5 text-[12.5px] text-[#B4343B]">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Client *</label>
              <select
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
              >
                <option value="">Select client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Amount (KES) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="40000.00"
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px] tabular"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Payment Method *</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
                >
                  <option value="mpesa">M-Pesa / Mobile Money</option>
                  <option value="bank_transfer">Bank Transfer / EFT</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card (POS Reference Only)</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">
                External Transaction Reference (M-Pesa Code / Bank Ref)
              </label>
              <input
                type="text"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder="e.g. QWE8912KLP"
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 font-mono text-[13px]"
              />
            </div>

            {canConfirm && (
              <label className="flex items-center gap-2 rounded-lg border border-[#BDE5CE] bg-[#E8F6EE]/60 p-3 text-[12.5px] font-medium text-[#16794F]">
                <input
                  type="checkbox"
                  checked={confirmImmediately}
                  onChange={(e) => setConfirmImmediately(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                Confirm immediately (funds have been verified as received)
              </label>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRecordOpen(false)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-4 text-[12.5px] font-medium text-[#646977]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2]"
              >
                {busyAction ? "Saving..." : "Record Payment"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Allocate Payment to Invoice Modal */}
      {allocateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleAllocateSubmit}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <h3 className="font-display text-[17px] font-bold text-[#20232D]">
              Allocate Payment {allocateTarget.payment_reference}
            </h3>
            <p className="text-[12.5px] text-[#646977]">
              Unallocated balance available:{" "}
              <strong className="font-mono text-[#16794F]">
                {formatMoney(allocateTarget.unallocated_amount, allocateTarget.currency)}
              </strong>
            </p>

            {eligibleClientInvoices.length === 0 ? (
              <p className="rounded-lg border border-[#F4DFB8] bg-[#FCF3E3] p-3 text-[12.5px] text-[#9A6316]">
                This client has no open issued invoices with an outstanding balance.
              </p>
            ) : (
              <>
                <div>
                  <label className="block text-[12px] font-semibold text-[#20232D]">Target Open Invoice *</label>
                  <select
                    required
                    value={targetInvoiceId}
                    onChange={(e) => {
                      setTargetInvoiceId(e.target.value);
                      const inv = eligibleClientInvoices.find((i) => i.id === e.target.value);
                      if (inv) {
                        const maxApply = Math.min(
                          Number(allocateTarget.unallocated_amount),
                          Number(inv.balance_due),
                        );
                        setAllocAmount(maxApply.toFixed(2));
                      }
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
                  >
                    <option value="">Select open invoice...</option>
                    {eligibleClientInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} — Balance Due: {formatMoney(inv.balance_due, inv.currency)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-[#20232D]">Allocation Amount (KES) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={allocateTarget.unallocated_amount}
                    required
                    value={allocAmount}
                    onChange={(e) => setAllocAmount(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px] tabular"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAllocateTarget(null)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Close
              </button>
              {eligibleClientInvoices.length > 0 && (
                <button
                  type="submit"
                  disabled={busyAction || !targetInvoiceId}
                  className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2] disabled:opacity-50"
                >
                  {busyAction ? "Allocating..." : "Apply Allocation"}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Reverse Payment Modal */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleReverseSubmit}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <h3 className="font-display text-[17px] font-bold text-[#B4343B]">
              Reverse Payment {reverseTarget.payment_reference}
            </h3>
            <p className="text-[12.5px] text-[#646977]">
              Reversing a payment preserves the original payment record, reverses any active invoice allocations (re-opening the invoice balance), and cancels any linked receipts.
            </p>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Reversal Reason *</label>
              <textarea
                required
                minLength={3}
                rows={3}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="e.g. Dishonoured cheque or M-Pesa reversal..."
                className="mt-1 w-full rounded-lg border border-[#E6E8EF] p-2.5 text-[13px]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction}
                className="h-9 rounded-lg bg-[#B4343B] px-4 text-[12.5px] font-semibold text-white hover:bg-[#992930]"
              >
                {busyAction ? "Reversing..." : "Confirm Reversal"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
