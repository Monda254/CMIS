/**
 * Centralized Typed API Client for the IBMS Frontend (Section 8).
 * Communicates with the MP-15 `/api/v1/*` endpoints, normalizes errors,
 * supports Idempotency-Key headers for financial mutations, and never uses mock fallback data.
 */

import { normalizeApiError } from "./errors";
import type {
  ApiErrorPayload,
  ApiResponse,
  ClientLedgerSummaryDTO,
  DashboardSummaryDTO,
  EmailLogDTO,
  InvoiceDTO,
  NotificationTemplateDTO,
  PaginatedResponse,
  PaymentDTO,
  QuoteDTO,
  ReconciliationBatchDTO,
  ReconciliationMatchDTO,
  SmsLogDTO,
  TaxConfigDTO,
} from "./types";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  idempotencyKey?: string;
}

export async function v1Request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith("/api/v1") ? path : `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(options.headers);

  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  let serializedBody: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      serializedBody = options.body;
    } else {
      headers.set("Content-Type", "application/json");
      serializedBody = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body: serializedBody,
    credentials: "include",
  });

  if (!res.ok) {
    let errBody: ApiErrorPayload | null = null;
    try {
      errBody = (await res.json()) as ApiErrorPayload;
    } catch {
      errBody = null;
    }
    throw normalizeApiError(res.status, errBody);
  }

  return (await res.json()) as T;
}

export function generateIdempotencyKey(prefix = "ibms"): string {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

/**
 * Exact integer-cents preview helper for line items so the UI never uses raw IEEE 754 float math
 * for financial previews (while the backend remains authoritative on submission).
 */
export function computeLinePreview(params: {
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  taxRate?: string;
  isInclusive?: boolean;
}): {
  gross: string;
  subtotal: string;
  taxAmount: string;
  lineTotal: string;
} {
  const qtyMilli = Math.round((Number(params.quantity) || 0) * 1000);
  const priceCents = Math.round((Number(params.unitPrice) || 0) * 100);
  const discountCents = Math.round((Number(params.discountAmount) || 0) * 100);
  const rateBasis = Math.round((Number(params.taxRate) || 0) * 10000); // 16% -> 160000

  if (qtyMilli <= 0 || priceCents < 0) {
    return { gross: "0.00", subtotal: "0.00", taxAmount: "0.00", lineTotal: "0.00" };
  }

  const grossCents = Math.round((qtyMilli * priceCents) / 1000);
  const netBeforeTaxCents = Math.max(0, grossCents - Math.max(0, discountCents));

  let subtotalCents = netBeforeTaxCents;
  let taxCents = 0;
  let totalCents = netBeforeTaxCents;

  if (rateBasis > 0) {
    if (params.isInclusive) {
      subtotalCents = Math.round((netBeforeTaxCents * 1000000) / (1000000 + rateBasis));
      taxCents = netBeforeTaxCents - subtotalCents;
      totalCents = netBeforeTaxCents;
    } else {
      subtotalCents = netBeforeTaxCents;
      taxCents = Math.round((subtotalCents * rateBasis) / 1000000);
      totalCents = subtotalCents + taxCents;
    }
  }

  return {
    gross: (grossCents / 100).toFixed(2),
    subtotal: (subtotalCents / 100).toFixed(2),
    taxAmount: (taxCents / 100).toFixed(2),
    lineTotal: (totalCents / 100).toFixed(2),
  };
}

export const ibmsApi = {
  dashboard: {
    getSummary: () => v1Request<ApiResponse<DashboardSummaryDTO>>("/dashboard/summary"),
    getRevenueReport: (fromDate: string, toDate: string) =>
      v1Request<
        ApiResponse<{
          period: { from_date: string; to_date: string };
          currency: string;
          metrics: {
            invoiced_amount: string;
            gross_confirmed_payments: string;
            total_refunds: string;
            net_collections: string;
            receipted_acknowledgments: string;
          };
          by_payment_method: {
            payment_method: string;
            count: number;
            gross_amount: string;
            refunded_amount: string;
            net_amount: string;
          }[];
        }>
      >(`/reports/revenue?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`),
    getReceivablesReport: () =>
      v1Request<
        ApiResponse<{
          currency: string;
          total_open_invoices: number;
          total_outstanding_receivables: string;
          invoices: {
            invoice_id: string;
            invoice_number: string | null;
            client_id: string;
            client_name: string;
            status: string;
            issue_date: string;
            due_date: string | null;
            total: string;
            amount_allocated: string;
            balance_due: string;
          }[];
        }>
      >("/reports/receivables"),
  },

  quotations: {
    list: (qs = "") => v1Request<PaginatedResponse<QuoteDTO>>(`/quotations${qs ? `?${qs}` : ""}`),
    get: (id: string) => v1Request<ApiResponse<QuoteDTO>>(`/quotations/${id}`),
    create: (payload: unknown) => v1Request<ApiResponse<QuoteDTO>>("/quotations", { method: "POST", body: payload }),
    issue: (id: string) =>
      v1Request<ApiResponse<QuoteDTO>>(`/quotations/${id}/issue`, {
        method: "POST",
        idempotencyKey: generateIdempotencyKey("quote-issue"),
      }),
    accept: (id: string) => v1Request<ApiResponse<QuoteDTO>>(`/quotations/${id}/accept`, { method: "POST" }),
    reject: (id: string) => v1Request<ApiResponse<QuoteDTO>>(`/quotations/${id}/reject`, { method: "POST" }),
    convertToInvoice: (id: string, payload: { due_date?: string | null; issue_immediately?: boolean; notes?: string }) =>
      v1Request<
        ApiResponse<{
          quotation_id: string;
          quote_number: string | null;
          quote_status: string;
          invoice_id: string;
          invoice_number: string | null;
          invoice_status: string;
          total: string;
        }>
      >(`/quotations/${id}/convert-to-invoice`, {
        method: "POST",
        body: payload,
        idempotencyKey: generateIdempotencyKey("quote-convert"),
      }),
  },

  invoices: {
    list: (qs = "") => v1Request<PaginatedResponse<InvoiceDTO>>(`/invoices${qs ? `?${qs}` : ""}`),
    get: (id: string) => v1Request<ApiResponse<InvoiceDTO>>(`/invoices/${id}`),
    create: (payload: unknown) =>
      v1Request<ApiResponse<InvoiceDTO>>("/invoices", {
        method: "POST",
        body: payload,
        idempotencyKey: generateIdempotencyKey("inv-create"),
      }),
    issue: (id: string) =>
      v1Request<ApiResponse<InvoiceDTO>>(`/invoices/${id}/issue`, {
        method: "POST",
        idempotencyKey: generateIdempotencyKey("inv-issue"),
      }),
    cancel: (id: string, reason: string) =>
      v1Request<ApiResponse<InvoiceDTO>>(`/invoices/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
  },

  payments: {
    list: (qs = "") => v1Request<PaginatedResponse<PaymentDTO>>(`/payments${qs ? `?${qs}` : ""}`),
    get: (id: string) => v1Request<ApiResponse<PaymentDTO>>(`/payments/${id}`),
    create: (payload: unknown) =>
      v1Request<ApiResponse<PaymentDTO>>("/payments", {
        method: "POST",
        body: payload,
        idempotencyKey: generateIdempotencyKey("pay-create"),
      }),
    confirm: (id: string) =>
      v1Request<ApiResponse<PaymentDTO>>(`/payments/${id}/confirm`, {
        method: "POST",
        idempotencyKey: generateIdempotencyKey("pay-confirm"),
      }),
    allocate: (id: string, allocations: { invoice_id: string; amount: string; notes?: string }[]) =>
      v1Request<ApiResponse<PaymentDTO>>(`/payments/${id}/allocate`, {
        method: "POST",
        body: { allocations },
        idempotencyKey: generateIdempotencyKey("pay-alloc"),
      }),
    reverse: (id: string, reason: string) =>
      v1Request<ApiResponse<PaymentDTO>>(`/payments/${id}/reverse`, {
        method: "POST",
        body: { reason },
      }),
    refund: (id: string, payload: { amount: string; reason: string; external_reference?: string }) =>
      v1Request<ApiResponse<PaymentDTO>>(`/payments/${id}/refund`, {
        method: "POST",
        body: payload,
        idempotencyKey: generateIdempotencyKey("pay-refund"),
      }),
  },

  receipts: {
    generateFromPayment: (payload: { payment_id: string; invoice_id?: string | null; amount_acknowledged?: string; notes?: string }) =>
      v1Request<ApiResponse<{ id: string; receipt_number: string; verification_code: string; amount_paid: string }>>(
        "/receipts/from-payment",
        {
          method: "POST",
          body: payload,
          idempotencyKey: generateIdempotencyKey("rcp-from-pay"),
        },
      ),
  },

  reconciliation: {
    listBatches: (qs = "") => v1Request<PaginatedResponse<ReconciliationBatchDTO>>(`/reconciliation/batches${qs ? `?${qs}` : ""}`),
    importBatch: (payload: unknown) =>
      v1Request<ApiResponse<ReconciliationBatchDTO>>("/reconciliation/batches", {
        method: "POST",
        body: payload,
        idempotencyKey: generateIdempotencyKey("recon-import"),
      }),
    createMatch: (payload: {
      reconciliation_record_id: string;
      payment_id?: string | null;
      invoice_id?: string | null;
      matched_amount: string;
      notes?: string;
      confirm_immediately?: boolean;
    }) =>
      v1Request<ApiResponse<ReconciliationMatchDTO>>("/reconciliation/matches", {
        method: "POST",
        body: payload,
      }),
    confirmMatch: (matchId: string) =>
      v1Request<ApiResponse<ReconciliationMatchDTO>>(`/reconciliation/matches/${matchId}/confirm`, {
        method: "POST",
        idempotencyKey: generateIdempotencyKey("recon-confirm"),
      }),
    rejectMatch: (matchId: string) =>
      v1Request<ApiResponse<ReconciliationMatchDTO>>(`/reconciliation/matches/${matchId}/reject`, {
        method: "POST",
      }),
  },

  communications: {
    listTemplates: () => v1Request<ApiResponse<NotificationTemplateDTO[]>>("/communications/templates"),
    createTemplate: (payload: {
      code: string;
      channel: "email" | "sms";
      name: string;
      subject_template?: string;
      body_template: string;
    }) =>
      v1Request<ApiResponse<NotificationTemplateDTO>>("/communications/templates", {
        method: "POST",
        body: payload,
      }),
    queueEmail: (payload: {
      client_id?: string | null;
      recipient: string;
      subject: string;
      message_type: string;
      body: string;
    }) => v1Request<ApiResponse<EmailLogDTO>>("/communications/email", { method: "POST", body: payload }),
    queueSms: (payload: {
      client_id?: string | null;
      recipient: string;
      message_type: string;
      body: string;
    }) => v1Request<ApiResponse<SmsLogDTO>>("/communications/sms", { method: "POST", body: payload }),
    listEmailLogs: () => v1Request<PaginatedResponse<EmailLogDTO>>("/communications/email-logs"),
    listSmsLogs: () => v1Request<PaginatedResponse<SmsLogDTO>>("/communications/sms-logs"),
  },

  taxes: {
    list: (activeOnly = false) =>
      v1Request<ApiResponse<TaxConfigDTO[]>>(`/taxes${activeOnly ? "?active_only=true" : ""}`),
    create: (payload: {
      code: string;
      name: string;
      rate: string;
      tax_type: "vat" | "withholding" | "excise" | "levy" | "exempt";
      is_inclusive: boolean;
      applicable_to: "all" | "quote" | "invoice" | "receipt";
      effective_from?: string;
      effective_to?: string | null;
    }) => v1Request<ApiResponse<TaxConfigDTO>>("/taxes", { method: "POST", body: payload }),
    toggleActive: (id: string, active: boolean) =>
      v1Request<ApiResponse<TaxConfigDTO>>(`/taxes/${id}`, {
        method: "PATCH",
        body: { active },
      }),
  },

  clients: {
    getLedger: (clientId: string) =>
      v1Request<ApiResponse<ClientLedgerSummaryDTO>>(`/clients/${clientId}/ledger`),
    getTransactions: (clientId: string) =>
      v1Request<
        ApiResponse<{
          client_id: string;
          client_name: string;
          ledger_summary: ClientLedgerSummaryDTO;
          quotations: { id: string; quote_number: string | null; status: string; total: string; issue_date: string }[];
          invoices: {
            id: string;
            invoice_number: string | null;
            status: string;
            total: string;
            amount_allocated: string;
            balance_due: string;
            issue_date: string;
          }[];
          payments: {
            id: string;
            payment_reference: string;
            status: string;
            payment_method: string;
            amount: string;
            amount_allocated: string;
            unallocated_amount: string;
            payment_date: string;
          }[];
          receipts: {
            id: string;
            receipt_number: string | null;
            status: string;
            amount_paid: string;
            finalized_at: string | null;
          }[];
        }>
      >(`/clients/${clientId}/transactions`),
  },
};
