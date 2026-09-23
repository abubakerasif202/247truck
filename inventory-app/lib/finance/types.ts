/** Shared Phase 4A finance domain types. Money crosses API boundaries as decimal strings. */

export type PaymentTerms = 'due_on_receipt' | '7_days' | '14_days' | '30_days';

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';

export type PaymentMethod = 'cash' | 'eftpos' | 'bank_transfer';
export type PaymentRow = {
  id: string; method: PaymentMethod; amount: string; reference: string | null; notes: string | null;
  received_at: string; recorded_at: string; recorded_by: string | null; reversed: boolean;
  reversal: { id: string; reason: string; reversed_at: string; reversed_by: string | null } | null;
};
export type InvoiceFinancials = {
  total: string; credits: string; gross_paid: string; reversed: string; effective_paid: string;
  applied_to_sale: string; actual_net_cash: string; balance: string; refund_due: string;
  payment_state: 'unpaid' | 'partial' | 'paid'; due_date: string | null; is_overdue: boolean;
  aging_bucket: 'current' | '1_7' | '8_14' | '15_29' | '30_plus';
};

/** Safe result shape returned by every Phase 4B invoice server action. */
export type InvoiceResult = {
  invoice_id: string;
  version?: number;
  status?: string;
  revision_id?: string;
  revision_number?: number;
  invoice_number?: string;
  pricing_complete?: boolean;
  issue_date?: string;
  due_date?: string;
  job_id?: string;
  job_version?: number;
  job_status?: string;
};
