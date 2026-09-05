/** Shared Phase 4A finance domain types. Money crosses API boundaries as decimal strings. */

export type PaymentTerms = 'due_on_receipt' | '7_days' | '14_days' | '30_days';

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';

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
