"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  GitCompareArrows,
  Link2,
  Plus,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ibmsApi } from "@/lib/api/client";
import type { PaymentDTO, ReconciliationRecordDTO } from "@/lib/api/types";
import { useMe } from "@/lib/auth";
import { dateTime, errMsg, formatMoney } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { DocumentStatusBadge } from "@/components/status-badge";

export default function ReconciliationPage() {
  const me = useMe();
  const qc = useQueryClient();
  const canWrite = hasPermission(me.data, "reconciliation:write");
  const canConfirm = hasPermission(me.data, "reconciliation:confirm");

  const [importOpen, setImportOpen] = useState(false);
  const [sourceType, setSourceType] = useState<"mpesa_statement" | "bank_statement">("mpesa_statement");
  const [accountId, setAccountId] = useState("Paybill 400200");
  const [extTxId, setExtTxId] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [payerName, setPayerName] = useState("");
  const [description, setDescription] = useState("");
  const [manualRecord, setManualRecord] = useState<ReconciliationRecordDTO | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [busy, setBusy] = useState(false);

  const batchesQuery = useQuery({
    queryKey: ["ibms-reconciliation-batches"],
    queryFn: () => ibmsApi.reconciliation.listBatches("page_size=50"),
  });

  const paymentsQuery = useQuery({
    queryKey: ["ibms-payments-confirmed"],
    queryFn: () => ibmsApi.payments.list("status=confirmed&page_size=100"),
  });

  const batches = batchesQuery.data?.data ?? [];
  const confirmedPayments: PaymentDTO[] = paymentsQuery.data?.data ?? [];

  async function handleImportBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!extTxId.trim() || Number(txAmount) <= 0) return;
    setBusy(true);
    try {
      await ibmsApi.reconciliation.importBatch({
        source_type: sourceType,
        account_identifier: accountId.trim(),
        records: [
          {
            external_tx_id: extTxId.trim().toUpperCase(),
            payment_method: sourceType === "mpesa_statement" ? "mpesa" : "bank_transfer",
            transaction_date: new Date().toISOString(),
            amount: Number(txAmount).toFixed(2),
            payer_name: payerName.trim(),
            description: description.trim(),
          },
        ],
      });
      toast.success("Statement batch imported; candidate matches evaluated");
      setImportOpen(false);
      setExtTxId("");
      setTxAmount("");
      setPayerName("");
      setDescription("");
      await qc.invalidateQueries({ queryKey: ["ibms-reconciliation-batches"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMatchDecision(matchId: string, action: "confirm" | "reject") {
    setBusy(true);
    try {
      if (action === "confirm") {
        await ibmsApi.reconciliation.confirmMatch(matchId);
        toast.success("Reconciliation match confirmed");
      } else {
        await ibmsApi.reconciliation.rejectMatch(matchId);
        toast.info("Suggested match rejected");
      }
      await qc.invalidateQueries({ queryKey: ["ibms-reconciliation-batches"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleManualMatchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualRecord || !selectedPaymentId) return;
    setBusy(true);
    try {
      await ibmsApi.reconciliation.createMatch({
        reconciliation_record_id: manualRecord.id,
        payment_id: selectedPaymentId,
        matched_amount: manualRecord.amount,
        confirm_immediately: canConfirm,
      });
      toast.success("Manual reconciliation match saved");
      setManualRecord(null);
      setSelectedPaymentId("");
      await qc.invalidateQueries({ queryKey: ["ibms-reconciliation-batches"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Transaction Reconciliation
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Match imported M-Pesa and bank statement lines against internal payment records. Uncertain matches require explicit human confirmation.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white hover:bg-[#4C3EC2]"
          >
            <Plus className="h-4 w-4" />
            Import Statement Batch
          </button>
        )}
      </div>

      {batchesQuery.isLoading ? (
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-8 text-center text-[13px] text-[#7A7F8C]">
          Loading reconciliation batches...
        </div>
      ) : batches.length === 0 ? (
        <div className="rounded-xl border border-[#E6E8EF] bg-white p-12 text-center">
          <GitCompareArrows className="mx-auto h-9 w-9 text-[#C4C8D4]" />
          <p className="mt-3 font-display text-[15px] font-bold text-[#20232D]">No statement batches imported</p>
          <p className="mt-1 text-[13px] text-[#7A7F8C]">
            Import an M-Pesa Paybill or bank statement batch to compare external transactions against recorded payments.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {batches.map((b) => (
            <div key={b.id} className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8EF] bg-[#F7F8FA] px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[13.5px] font-bold text-[#5848D6]">{b.batch_number}</span>
                  <span className="text-[13px] font-semibold text-[#20232D]">
                    {b.source_type.replace("_", " ").toUpperCase()} ({b.account_identifier || "Account"})
                  </span>
                  <DocumentStatusBadge status={b.status} />
                </div>
                <div className="text-[12px] text-[#646977]">
                  Total: <strong>{b.total_records}</strong> · Matched:{" "}
                  <strong className="text-[#16794F]">{b.matched_records}</strong> · Unmatched:{" "}
                  <strong className="text-[#9A6316]">{b.unmatched_records}</strong>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-[#E6E8EF] text-[11px] font-semibold text-[#7A7F8C] uppercase">
                    <tr>
                      <th className="px-4 py-2.5">External TX ID</th>
                      <th className="px-4 py-2.5">Payer / Description</th>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5">Match Status</th>
                      <th className="px-4 py-2.5 text-right">Reconciliation Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E8EF]">
                    {b.records.map((rec) => {
                      const activeMatch = rec.matches[0];
                      return (
                        <tr key={rec.id} className="hover:bg-[#F7F8FA]/60">
                          <td className="px-4 py-3 font-mono font-semibold text-[#20232D]">
                            {rec.external_tx_id}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[#20232D]">{rec.payer_name || "External Payer"}</div>
                            {rec.description && <div className="text-[11.5px] text-[#7A7F8C]">{rec.description}</div>}
                          </td>
                          <td className="px-4 py-3 text-[12px] text-[#646977]">{dateTime(rec.transaction_date)}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular">
                            {formatMoney(rec.amount, rec.currency)}
                          </td>
                          <td className="px-4 py-3">
                            <DocumentStatusBadge status={rec.match_status} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {activeMatch && activeMatch.match_state === "suggested" && canConfirm ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleMatchDecision(activeMatch.id, "confirm")}
                                  className="inline-flex items-center gap-1 rounded-md bg-[#16794F] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#12633F]"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Confirm Match
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleMatchDecision(activeMatch.id, "reject")}
                                  className="inline-flex items-center gap-1 rounded-md border border-[#F6D2D6] bg-[#FCECEE] px-2.5 py-1 text-[11.5px] font-semibold text-[#B4343B]"
                                >
                                  <XCircle className="h-3 w-3" />
                                  Reject
                                </button>
                              </div>
                            ) : rec.match_status === "unmatched" && canWrite ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setManualRecord(rec);
                                  setSelectedPaymentId("");
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-[#5848D6] bg-[#EEECFC] px-2.5 py-1 text-[11.5px] font-semibold text-[#5848D6]"
                              >
                                <Link2 className="h-3 w-3" />
                                Match Manually
                              </button>
                            ) : (
                              <span className="text-[12px] text-[#7A7F8C]">
                                {rec.match_status === "matched" ? "Reconciled ✓" : "—"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Batch Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleImportBatch}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#E6E8EF] pb-3">
              <h3 className="font-display text-[17px] font-bold text-[#20232D]">Import Statement Transaction</h3>
              <button type="button" onClick={() => setImportOpen(false)} className="rounded p-1 text-[#7A7F8C]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Statement Source</label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
              >
                <option value="mpesa_statement">M-Pesa Paybill / Till Statement</option>
                <option value="bank_statement">Bank Account Statement</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Account / Paybill Identifier</label>
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">External TX Code *</label>
                <input
                  type="text"
                  required
                  value={extTxId}
                  onChange={(e) => setExtTxId(e.target.value)}
                  placeholder="QWE8912KLP"
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 font-mono text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Amount (KES) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  placeholder="25000.00"
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px] tabular"
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Payer Name</label>
              <input
                type="text"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="Name on statement..."
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2]"
              >
                {busy ? "Importing..." : "Import & Analyze"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Manual Match Modal */}
      {manualRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleManualMatchSubmit}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <h3 className="font-display text-[17px] font-bold text-[#20232D]">
              Match Statement Line {manualRecord.external_tx_id}
            </h3>
            <p className="text-[12.5px] text-[#646977]">
              Statement Amount:{" "}
              <strong>{formatMoney(manualRecord.amount, manualRecord.currency)}</strong>
            </p>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Select Internal Confirmed Payment *</label>
              <select
                required
                value={selectedPaymentId}
                onChange={(e) => setSelectedPaymentId(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
              >
                <option value="">Choose payment...</option>
                {confirmedPayments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.payment_reference} ({p.external_reference || p.payment_method}) — {formatMoney(p.amount, p.currency)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setManualRecord(null)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !selectedPaymentId}
                className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2] disabled:opacity-50"
              >
                {busy ? "Matching..." : "Link & Confirm"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
