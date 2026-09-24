export type QuoteDocumentParty = {
  display_name?: string | null;
  company_name?: string | null;
  legal_name?: string | null;
  label?: string | null;
  email?: string | null;
  phone?: string | null;
  abn?: string | null;
  street_address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
};

export type QuoteDocumentLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string | null;
  amount: string | null;
  torqueNm: string | null;
  pricingTier: 'retail' | 'wholesale';
  tyre?: { brand?: string | null; model?: string | null; size?: string | null } | null;
};

export type QuoteDocumentData = {
  quoteId: string;
  quoteNumber: string;
  status: string;
  quoteDate: string | null;
  expiryDate: string | null;
  customerReference: string | null;
  customerNotes: string | null;
  extraDescription: string | null;
  locationName: string | null;
  business: QuoteDocumentParty & { business_name?: string | null; shared_email?: string | null; logo_asset_path?: string | null; invoice_footer?: string | null };
  branch: QuoteDocumentParty & { branch_name?: string | null; contact_email?: string | null; document_footer?: string | null };
  customer: QuoteDocumentParty;
  lines: QuoteDocumentLine[];
  subtotal: string | null;
  gst: string | null;
  total: string | null;
};

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string | null => value == null ? null : String(value);
const content = (value: unknown): string | null => { const result = text(value); return result?.trim() ? result : null; };
const torque = (value: unknown): string | null => { const result = content(value); return result && Number.isFinite(Number(result)) && Number(result) > 0 ? result : null; };

export function quoteDocumentFromDetail(detail: RecordValue): QuoteDocumentData {
  const contact = record(detail.contact_snapshot);
  const customerSnapshot = record(detail.customer_snapshot);
  const customer = Object.keys(contact).length ? { ...customerSnapshot, display_name: contact.name ?? customerSnapshot.display_name, email: contact.email, phone: contact.phone } : customerSnapshot;
  return {
    quoteId: String(detail.id),
    quoteNumber: String(detail.quote_number),
    status: String(detail.status ?? 'draft'),
    quoteDate: text(detail.created_at),
    expiryDate: text(detail.expiry_date),
    customerReference: text(detail.customer_reference),
    customerNotes: content(detail.customer_notes),
    extraDescription: content(detail.extra_description),
    locationName: text(detail.location_name ?? record(detail.branch_snapshot).branch_name),
    business: record(detail.business_snapshot) as QuoteDocumentData['business'],
    branch: record(detail.branch_snapshot) as QuoteDocumentData['branch'],
    customer: customer as QuoteDocumentParty,
    lines: (Array.isArray(detail.lines) ? detail.lines : []).map((raw, index) => {
      const line = record(raw);
      const product = record(line.product_snapshot);
      return {
        id: String(line.id ?? index),
        description: String(line.description ?? ''),
        quantity: String(line.quantity ?? '0'),
        unitPrice: text(line.unit_price_incl_gst),
        amount: text(line.line_total_incl_gst),
        torqueNm: torque(line.torque_nm),
        pricingTier: line.pricing_tier === 'wholesale' ? 'wholesale' : 'retail',
        tyre: Object.keys(product).length ? { brand: text(product.brand_name ?? product.brand), model: text(product.pattern_name ?? product.model), size: text(product.size_name ?? product.size) } : null,
      };
    }),
    subtotal: text(detail.subtotal_ex_gst),
    gst: text(detail.gst_amount),
    total: text(detail.total_incl_gst),
  };
}
