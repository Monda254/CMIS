"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MessageSquare, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { ibmsApi } from "@/lib/api/client";
import { useMe } from "@/lib/auth";
import { dateTime, errMsg } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { DocumentStatusBadge } from "@/components/status-badge";

export default function CommunicationsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const canSend = hasPermission(me.data, "communications:send");

  const [tab, setTab] = useState<"email" | "sms" | "templates">("email");
  const [composeChannel, setComposeChannel] = useState<"email" | "sms" | null>(null);
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [messageType, setMessageType] = useState("invoice");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const emailLogsQuery = useQuery({
    queryKey: ["ibms-email-logs"],
    queryFn: () => ibmsApi.communications.listEmailLogs(),
  });

  const smsLogsQuery = useQuery({
    queryKey: ["ibms-sms-logs"],
    queryFn: () => ibmsApi.communications.listSmsLogs(),
  });

  const templatesQuery = useQuery({
    queryKey: ["ibms-comm-templates"],
    queryFn: () => ibmsApi.communications.listTemplates(),
  });

  const emailLogs = emailLogsQuery.data?.data ?? [];
  const smsLogs = smsLogsQuery.data?.data ?? [];
  const templates = templatesQuery.data?.data ?? [];

  async function handleQueueNotification(e: React.FormEvent) {
    e.preventDefault();
    if (!composeChannel || !recipient.trim() || !body.trim()) return;
    setBusy(true);
    try {
      if (composeChannel === "email") {
        const res = await ibmsApi.communications.queueEmail({
          recipient: recipient.trim(),
          subject: subject.trim() || "Notification from Ledgerly IBMS",
          message_type: messageType,
          body: body.trim(),
        });
        toast.info(res.message);
        await qc.invalidateQueries({ queryKey: ["ibms-email-logs"] });
      } else {
        const res = await ibmsApi.communications.queueSms({
          recipient: recipient.trim(),
          message_type: messageType,
          body: body.trim(),
        });
        toast.info(res.message);
        await qc.invalidateQueries({ queryKey: ["ibms-sms-logs"] });
      }
      setComposeChannel(null);
      setRecipient("");
      setSubject("");
      setBody("");
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
            Communications & Delivery Logs
          </h1>
          <p className="mt-0.5 text-[14px] text-[#7A7F8C]">
            Queue outbound Email and SMS notifications for quotations, invoices, payments, and receipts, and inspect actual provider delivery states.
          </p>
        </div>
        {canSend && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setComposeChannel("sms")}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#E6E8EF] bg-white px-3.5 text-[13px] font-semibold text-[#20232D] hover:bg-[#F7F8FA]"
            >
              <MessageSquare className="h-4 w-4 text-[#16794F]" />
              Queue SMS
            </button>
            <button
              type="button"
              onClick={() => setComposeChannel("email")}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#5848D6] px-4 text-[13px] font-semibold text-white hover:bg-[#4C3EC2]"
            >
              <Mail className="h-4 w-4" />
              Queue Email
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E6E8EF]">
        {[
          { id: "email" as const, label: `Email Activity (${emailLogs.length})` },
          { id: "sms" as const, label: `SMS Activity (${smsLogs.length})` },
          { id: "templates" as const, label: `Templates (${templates.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
              tab === t.id
                ? "border-[#5848D6] text-[#5848D6]"
                : "border-transparent text-[#646977] hover:text-[#20232D]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "email" && (
        <div className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white">
          {emailLogs.length === 0 ? (
            <div className="p-12 text-center">
              <Mail className="mx-auto h-8 w-8 text-[#C4C8D4]" />
              <p className="mt-2 font-display text-[15px] font-bold text-[#20232D]">No email dispatches logged</p>
              <p className="text-[13px] text-[#7A7F8C]">Queued and sent emails will appear here with their provider status.</p>
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[11px] font-semibold text-[#7A7F8C] uppercase">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Provider Status</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF]">
                {emailLogs.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium text-[#20232D]">{row.recipient}</td>
                    <td className="px-4 py-3 text-[#4A4F5C]">{row.subject}</td>
                    <td className="px-4 py-3 uppercase text-[11.5px] font-semibold text-[#646977]">{row.message_type}</td>
                    <td className="px-4 py-3">
                      <DocumentStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#646977]">{dateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "sms" && (
        <div className="overflow-hidden rounded-xl border border-[#E6E8EF] bg-white">
          {smsLogs.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-[#C4C8D4]" />
              <p className="mt-2 font-display text-[15px] font-bold text-[#20232D]">No SMS dispatches logged</p>
              <p className="text-[13px] text-[#7A7F8C]">Queued and sent SMS messages will appear here.</p>
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-[#E6E8EF] bg-[#F7F8FA] text-[11px] font-semibold text-[#7A7F8C] uppercase">
                <tr>
                  <th className="px-4 py-3">Recipient Phone</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Delivery Status</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E8EF]">
                {smsLogs.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono font-medium text-[#20232D]">{row.recipient}</td>
                    <td className="px-4 py-3 uppercase text-[11.5px] font-semibold text-[#646977]">{row.message_type}</td>
                    <td className="px-4 py-3 text-[#646977]">{row.provider}</td>
                    <td className="px-4 py-3">
                      <DocumentStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-[12px] text-[#646977]">{dateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "templates" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {templates.length === 0 ? (
            <div className="col-span-2 rounded-xl border border-[#E6E8EF] bg-white p-8 text-center text-[13px] text-[#7A7F8C]">
              No notification templates configured yet.
            </div>
          ) : (
            templates.map((tpl) => (
              <div key={tpl.id} className="rounded-xl border border-[#E6E8EF] bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[12px] font-semibold text-[#5848D6]">{tpl.code}</span>
                  <span className="rounded bg-[#F3F4F8] px-2 py-0.5 text-[11px] font-semibold uppercase text-[#4A4F5C]">
                    {tpl.channel}
                  </span>
                </div>
                <p className="mt-1.5 font-display text-[14.5px] font-bold text-[#20232D]">{tpl.name}</p>
                {tpl.subject_template && (
                  <p className="mt-1 text-[12px] font-medium text-[#646977]">Subject: {tpl.subject_template}</p>
                )}
                <p className="mt-2 rounded-lg bg-[#F7F8FA] p-2.5 text-[12px] text-[#4A4F5C]">{tpl.body_template}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Compose & Queue Modal */}
      {composeChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091426]/55 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleQueueNotification}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6E8EF] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#E6E8EF] pb-3">
              <h3 className="font-display text-[17px] font-bold text-[#20232D]">
                Queue {composeChannel === "email" ? "Email" : "SMS"} Notification
              </h3>
              <button type="button" onClick={() => setComposeChannel(null)} className="rounded p-1 text-[#7A7F8C]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">
                {composeChannel === "email" ? "Recipient Email *" : "Recipient Phone *"}
              </label>
              <input
                type={composeChannel === "email" ? "email" : "text"}
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={composeChannel === "email" ? "client@company.co.ke" : "+254700123456"}
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Notification Type</label>
              <select
                value={messageType}
                onChange={(e) => setMessageType(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] bg-white px-3 text-[13px]"
              >
                <option value="quotation">Quotation Delivery</option>
                <option value="invoice">Invoice Delivery</option>
                <option value="payment_confirmation">Payment Confirmation</option>
                <option value="receipt">Receipt Delivery</option>
                <option value="payment_reminder">Payment Reminder</option>
              </select>
            </div>
            {composeChannel === "email" && (
              <div>
                <label className="block text-[12px] font-semibold text-[#20232D]">Subject *</label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Invoice from Ledgerly"
                  className="mt-1 h-10 w-full rounded-lg border border-[#E6E8EF] px-3 text-[13px]"
                />
              </div>
            )}
            <div>
              <label className="block text-[12px] font-semibold text-[#20232D]">Message Body *</label>
              <textarea
                rows={3}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Enter notification message..."
                className="mt-1 w-full rounded-lg border border-[#E6E8EF] p-2.5 text-[13px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setComposeChannel(null)}
                className="h-9 rounded-lg border border-[#E6E8EF] px-3.5 text-[12.5px] font-medium text-[#646977]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#5848D6] px-4 text-[12.5px] font-semibold text-white hover:bg-[#4C3EC2]"
              >
                <Send className="h-3.5 w-3.5" />
                {busy ? "Queuing..." : "Queue Notification"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
