"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { ibmsApi } from "@/lib/api/client";
import { useMe } from "@/lib/auth";
import { errMsg, formatDate } from "@/lib/format";
import { isAdminUser } from "@/lib/permissions";

export default function TaxConfigurationPage() {
  const me = useMe();
  const qc = useQueryClient();
  const isAdmin = isAdminUser(me.data);

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [rate, setRate] = useState("16.0000");
  const [taxType, setTaxType] = useState<"vat" | "withholding" | "excise" | "levy" | "exempt">("vat");
  const [isInclusive, setIsInclusive] = useState(false);
  const [applicableTo, setApplicableTo] = useState<"all" | "quote" | "invoice" | "receipt">("all");
  const [busy, setBusy] = useState(false);

  const taxesQuery = useQuery({
    queryKey: ["ibms-taxes-all"],
    queryFn: () => ibmsApi.taxes.list(false),
  });

  const taxes = taxesQuery.data?.data ?? [];

  async function handleCreateTax(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setBusy(true);
    try {
      await ibmsApi.taxes.create({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        rate: Number(rate).toFixed(4),
        tax_type: taxType,
        is_inclusive: isInclusive,
        applicable_to: applicableTo,
      });
      toast.success("Tax configuration created");
      setCreateOpen(false);
      setCode("");
      setName("");
      await qc.invalidateQueries({ queryKey: ["ibms-taxes-all"] });
      await qc.invalidateQueries({ queryKey: ["ibms-taxes-active"] });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(id: string, nextActive: boolean) {
    try {
      await ibmsApi.taxes.toggleActive(id, nextActive);
      toast.success(nextActive ? "Tax rule activated" : "Tax rule deactivated");
      await qc.invalidateQueries({ queryKey: ["ibms-taxes-all"] });
      await qc.invalidateQueries({ queryKey: ["ibms-taxes-active"] });
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-[#20232D]">
            Tax Configuration
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Configure tax rates, inclusive/exclusive pricing behavior, and effective dates for quotations and invoices.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white hover:bg-[#4C3EC2]"
          >
            <Plus className="h-4 w-4" />
            Add Tax Rule
          </button>
        )}
      </div>

      {/* Historical Preservation Notice (Section 20.2) */}
      <div className="flex items-start gap-3 rounded-xl border border-[#C7D2FE] bg-[#EEF2FF]/70 p-4 text-[13px] text-[#3730A3]">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#5848D6]" />
        <div>
          <p className="font-semibold">Historical Financial Document Protection</p>
          <p className="mt-0.5 text-[12.5px] text-[#4A4F5C]">
            Updating or deactivating a tax configuration only affects future draft documents. Previously finalized quotations, invoices, and receipts preserve the exact `tax_rate` and `tax_amount` captured on their line items at issuance.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white">
        {taxesQuery.isLoading ? (
          <div className="p-8 text-center text-[13px] text-[#7A7F8C]">Loading tax configurations...</div>
        ) : taxes.length === 0 ? (
          <div className="p-12 text-center">
            <Percent className="mx-auto h-9 w-9 text-[#C4C8D4]" />
            <p className="mt-3 font-display text-[15px] font-bold text-[#20232D]">No tax rules configured</p>
            <p className="mt-1 text-[13px] text-[#7A7F8C]">
              Add configurable tax codes (such as VAT, Withholding, or Zero-Rated) when applicable to your business.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[11px] font-semibold text-[#7A7F8C] uppercase">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Tax Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Rate (%)</th>
                <th className="px-4 py-3">Pricing Mode</th>
                <th className="px-4 py-3">Effective From</th>
                <th className="px-4 py-3">Status</th>
                {isAdmin && <th className="px-4 py-3 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E8EF]">
              {taxes.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3.5 font-mono font-semibold text-[#5848D6]">{t.code}</td>
                  <td className="px-4 py-3.5 font-medium text-[#20232D]">{t.name}</td>
                  <td className="px-4 py-3.5 uppercase text-[11.5px] font-semibold text-[#646977]">{t.tax_type}</td>
                  <td className="px-4 py-3.5 text-right font-mono font-semibold tabular">
                    {Number(t.rate).toFixed(2)}%
                  </td>
                  <td className="px-4 py-3.5 text-[#646977]">
                    {t.is_inclusive ? "Tax-Inclusive" : "Tax-Exclusive"}
                  </td>
                  <td className="px-4 py-3.5 text-[#646977]">{formatDate(t.effective_from)}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                        t.active
                          ? "border-[#BDE5CE] bg-[#E8F6EE] text-[#16794F]"
                          : "border-[#E6E8EF] bg-[#F3F4F8] text-[#646977]"
                      }`}
                    >
                      {t.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggle(t.id, !t.active)}
                        className="rounded-md border border-[#E6E8EF] px-2.5 py-1 text-[12px] font-medium text-[#20232D] hover:bg-[#F7F8FA]"
                      >
                        {t.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleCreateTax}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#E6E8EF] pb-3">
              <h3 className="font-display text-[17px] font-bold text-[#20232D]">Add Tax Configuration</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded p-1 text-[#7A7F8C]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Tax Code *</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="VAT_16"
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 font-mono text-[13px] uppercase"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Rate (%) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px] tabular"
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Tax Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Standard VAT 16%"
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Tax Type</label>
                <select
                  value={taxType}
                  onChange={(e) => setTaxType(e.target.value as typeof taxType)}
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
                >
                  <option value="vat">VAT</option>
                  <option value="withholding">Withholding</option>
                  <option value="excise">Excise</option>
                  <option value="levy">Levy</option>
                  <option value="exempt">Exempt</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Applicable To</label>
                <select
                  value={applicableTo}
                  onChange={(e) => setApplicableTo(e.target.value as typeof applicableTo)}
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
                >
                  <option value="all">All Documents</option>
                  <option value="quote">Quotations Only</option>
                  <option value="invoice">Invoices Only</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] font-medium text-[#20232D]">
              <input
                type="checkbox"
                checked={isInclusive}
                onChange={(e) => setIsInclusive(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Unit prices already include this tax (Tax-Inclusive)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-9 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2]"
              >
                {busy ? "Saving..." : "Save Tax Rule"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
