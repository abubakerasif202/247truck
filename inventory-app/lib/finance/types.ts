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

export type FinanceAddress = {
  street_address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
};

export type FinanceBankInstructions = {
  bank_name: string | null;
  account_name: string | null;
  bsb: string | null;
  account_number: string | null;
  payment_reference: string | null;
  instructions: string | null;
};

export type GlobalFinanceSettings = {
  version: number;
  business_name: string | null;
  abn: string | null;
  address: FinanceAddress | null;
  phone: string | null;
  shared_email: string | null;
  logo_asset_path: string | null;
  logo_sha256: string | null;
  bank_instructions: FinanceBankInstructions | null;
  invoice_footer: string | null;
  /** Phase 4A: always false; not activatable through Phase 4A UI/RPC. */
  stripe_enabled: boolean;
  email_automation_enabled: boolean;
  reminders_enabled: boolean;
};

export type BranchFinanceSettings = {
  location_id: string;
  code: string;
  name: string;
  version: number;
  branch_name: string | null;
  address: FinanceAddress | null;
  phone: string | null;
  contact_email: string | null;
  document_footer: string | null;
};

export type FinanceSettingsDetail = {
  global: GlobalFinanceSettings;
  locations: BranchFinanceSettings[];
};
