export const INVOICE_BRANDS = ['247', 'awt'] as const;
export type InvoiceBrand = (typeof INVOICE_BRANDS)[number];

export const INVOICE_BRAND_LABELS: Record<InvoiceBrand, string> = {
  '247': '24/7 Truck Tyre Services',
  awt: 'AWT Tyres',
};

export type InvoiceBrandPreview = {
  brand: InvoiceBrand;
  business_name: string;
  abn: string | null;
  address: Record<string, unknown> | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_asset_path: string | null;
  primary_colour: string | null;
  accent_colour: string | null;
  bank_instructions: Record<string, unknown> | null;
  invoice_footer: string | null;
  email_sender_name?: string | null;
  reply_to_address?: string | null;
  version?: number;
};

export type InvoiceBrandOptions = {
  // Null when the location has more than one actively authorized business
  // and none can be preselected unambiguously - the caller must require an
  // explicit choice rather than falling back to a guessed brand.
  default_brand: InvoiceBrand | null;
  can_override: boolean;
  brands: InvoiceBrandPreview[];
};

export function defaultInvoiceBrandForLocation(code: string | null | undefined): InvoiceBrand {
  return code === 'LON' ? 'awt' : '247';
}

export function isInvoiceBrand(value: unknown): value is InvoiceBrand {
  return value === '247' || value === 'awt';
}
