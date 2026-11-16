/**
 * Centralized TypeScript Contracts aligned with MP-14 Database & MP-15 FastAPI Schemas (Sections 8 & 17).
 */

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface ApiResponse<T> {
  data: T;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
  message: string;
}

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
  message?: string;
  request_id?: string;
}

export interface TaxConfigDTO {
  id: string;
  code: string;
  name: string;
  rate: string;
  tax_type: "vat" | "withholding" | "excise" | "levy" | "exempt";
  is_inclusive: boolean;
  applicable_to: "all" | "quote" | "invoice" | "receipt";
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuoteItemDTO {
  id: string;
  quote_id: string;
  position: number;
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_config_id: string | null;
  tax_rate: string;
  tax_amount: string;
  line_subtotal: string;
  line_total: string;
}

export interface QuoteDTO {
  id: string;
  quote_number: string | null;
  client_id: string;
  status: "draft" | "sent" | "approved" | "rejected" | "expired" | "converted" | "cancelled";
  issue_date: string;
  expiry_date: string | null;
  currency: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  terms: string;
  notes: string;
  company_snapshot: Record<string, unknown> | null;
  client_snapshot: Record<string, unknown> | null;
  finalized_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  items: QuoteItemDTO[];
}

export interface InvoiceItemDTO {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_config_id: string | null;
  tax_rate: string;
  tax_amount: string;
  line_subtotal: string;
  line_total: string;
}

export interface InvoiceDTO {
  id: string;
  invoice_number: string | null;
  client_id: string;
  quote_id: string | null;
  status: "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled" | "void";
  issue_date: string;
  due_date: string | null;
  currency: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  amount_allocated: string;
  balance_due: string;
  terms: string;
  notes: string;
  company_snapshot: Record<string, unknown> | null;
  client_snapshot: Record<string, unknown> | null;
  finalized_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  items: InvoiceItemDTO[];
}

export interface PaymentAllocationDTO {
  id: string;
  payment_id: string;
  invoice_id: string;
  amount: string;
  status: "active" | "reversed";
  notes: string;
  allocated_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
}

export interface PaymentRefundDTO {
  id: string;
  refund_reference: string;
  payment_id: string;
  amount: string;
  reason: string;
  status: "pending" | "completed" | "failed";
  external_reference: string | null;
  refunded_at: string;
}

export interface PaymentDTO {
  id: string;
  payment_reference: string;
  client_id: string;
  status: "pending" | "confirmed" | "failed" | "refunded" | "partially_refunded" | "reversed";
  payment_method: "cash" | "mpesa" | "bank_transfer" | "card" | "cheque" | "other";
  external_reference: string | null;
  payment_date: string;
  currency: string;
  amount: string;
  amount_allocated: string;
  amount_refunded: string;
  amount_receipted: string;
  unallocated_amount: string;
  notes: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  allocations: PaymentAllocationDTO[];
  refunds: PaymentRefundDTO[];
}

export interface ReconciliationMatchDTO {
  id: string;
  reconciliation_record_id: string;
  payment_id: string | null;
  invoice_id: string | null;
  matched_amount: string;
  confidence_score: string;
  match_state: "suggested" | "confirmed" | "rejected" | "unmatched";
  notes: string;
  matched_at: string;
}

export interface ReconciliationRecordDTO {
  id: string;
  batch_id: string;
  external_tx_id: string;
  payment_method: string;
  transaction_date: string;
  amount: string;
  currency: string;
  payer_name: string;
  payer_phone: string;
  description: string;
  match_status: "unmatched" | "suggested" | "matched" | "rejected" | "ignored";
  created_at: string;
  matches: ReconciliationMatchDTO[];
}

export interface ReconciliationBatchDTO {
  id: string;
  batch_number: string;
  source_type: "mpesa_statement" | "bank_statement" | "card_settlement" | "manual_import";
  account_identifier: string;
  period_start: string | null;
  period_end: string | null;
  status: "open" | "in_review" | "completed" | "archived";
  total_records: number;
  matched_records: number;
  unmatched_records: number;
  created_at: string;
  completed_at: string | null;
  records: ReconciliationRecordDTO[];
}

export interface NotificationTemplateDTO {
  id: string;
  code: string;
  channel: "email" | "sms";
  name: string;
  subject_template: string;
  body_template: string;
  active: boolean;
  created_at: string;
}

export interface EmailLogDTO {
  id: string;
  client_id: string | null;
  recipient: string;
  subject: string;
  message_type: string;
  provider: string;
  status: "queued" | "sent" | "delivered" | "failed" | "bounced";
  attempt_count: number;
  sent_at: string | null;
  delivered_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface SmsLogDTO {
  id: string;
  client_id: string | null;
  recipient: string;
  message_type: string;
  provider: string;
  status: "queued" | "sent" | "delivered" | "failed" | "bounced";
  attempt_count: number;
  created_at: string;
}

export interface ClientLedgerSummaryDTO {
  total_invoiced: string;
  total_allocated_to_invoices: string;
  outstanding_invoice_balance: string;
  total_confirmed_payments: string;
  total_refunds: string;
  net_collections: string;
  unallocated_client_credit: string;
  total_receipted: string;
}

export interface DashboardSummaryDTO {
  currency: string;
  company_name: string;
  counts: {
    active_clients: number;
    total_quotations: number;
    total_invoices: number;
    overdue_invoices: number;
    confirmed_payments: number;
    finalized_receipts: number;
  };
  financials: {
    invoiced_value: string | null;
    outstanding_receivables: string | null;
    gross_payments_received: string | null;
    total_refunds: string | null;
    net_collections: string | null;
    total_receipted_amount: string | null;
    daily_revenue: string | null;
    weekly_revenue: string | null;
    monthly_revenue: string | null;
  };
  payment_method_breakdown: {
    payment_method: string;
    payment_count: number;
    net_amount: string;
  }[];
}
