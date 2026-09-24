export type InvoiceAddress = {
  street_address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
};

export type InvoiceParty = InvoiceAddress & {
  display_name?: string | null;
  legal_name?: string | null;
  company_name?: string | null;
  label?: string | null;
  abn?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type InvoiceTyreDetails = {
  brand?: string | null;
  model?: string | null;
  size?: string | null;
  position?: string | null;
  serial_dot?: string | null;
  quantity_fitted?: string | number | null;
};

export type InvoiceDocumentLine = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string | null;
  discountPercent: string;
  discountAmount: string | null;
  gstAmount: string | null;
  amount: string | null;
  total: string | null;
  torqueNm: string | null;
  tyre?: InvoiceTyreDetails | null;
};

export type InvoiceDocumentData = {
  brand?: '247' | 'awt' | null;
  invoiceId: string;
  revisionId: string;
  invoiceNumber: string;
  revisionNumber: number;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  customerReference: string | null;
  customerNotes: string | null;
  extraDescription: string | null;
  business: InvoiceParty & {
    business_name?: string | null;
    shared_email?: string | null;
    logo_asset_path?: string | null;
    bank_instructions?: Record<string, unknown> | null;
    invoice_footer?: string | null;
    brand?: '247' | 'awt' | null;
    website?: string | null;
    primary_colour?: string | null;
    accent_colour?: string | null;
    email_sender_name?: string | null;
    reply_to_address?: string | null;
  };
  branch: InvoiceParty & { branch_name?: string | null; contact_email?: string | null; document_footer?: string | null };
  customer: InvoiceParty;
  billingContact: InvoiceParty | null;
  vehicle: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  lines: InvoiceDocumentLine[];
  subtotal: string | null;
  discount: string | null;
  gst: string | null;
  total: string | null;
  amountPaid: string;
  balanceDue: string | null;
};

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
const text = (value: unknown): string | null => value == null ? null : String(value);
const party = (value: unknown) => { const snapshot = record(value); return { ...snapshot, ...record(snapshot.address) }; };
const content = (value: unknown): string | null => { const result = text(value); return result?.trim() ? result : null; };
const torque = (value: unknown): string | null => { const result = content(value); return result && Number.isFinite(Number(result)) && Number(result) > 0 ? result : null; };

function storedDiscountTotal(lines: InvoiceDocumentLine[]): string | null {
  const values = lines.map((line) => line.discountAmount).filter((value): value is string => value !== null);
  if (!values.length) return null;
  const cents = values.reduce((sum, value) => {
    const match = value.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return sum;
    const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
    return sum + (match[1] ? -amount : amount);
  }, 0n);
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function invoiceDocumentFromDetail(detail: UnknownRecord, requestedRevisionId?: string): InvoiceDocumentData {
  const revisions = Array.isArray(detail.revisions) ? detail.revisions.map(record) : [];
  const selected = revisions.find((revision) => String(revision.id) === requestedRevisionId)
    ?? revisions.find((revision) => revision.id === detail.current_revision_id)
    ?? revisions.at(-1);
  if (!selected) throw new Error('Invoice has no revision to render.');

  const financials = record(detail.financials);
  const vehicle = selected.vehicle_snapshot == null ? null : record(selected.vehicle_snapshot);
  const lines = (Array.isArray(selected.lines) ? selected.lines : []).map((raw, index) => {
    const line = record(raw);
    const tyre = line.tyre_details ?? line.tyre ?? line.product_snapshot;
    return {
      id: String(line.id ?? index),
      description: String(line.description ?? ''),
      quantity: String(line.quantity ?? '0'),
      unitPrice: text(line.unit_price_ex_gst ?? line.unit_price_incl_gst),
      discountPercent: String(line.discount_percent ?? '0'),
      discountAmount: text(line.discount_amount),
      gstAmount: text(line.gst_amount),
      amount: text(line.subtotal_ex_gst ?? line.total_ex_gst ?? line.total_incl_gst),
      total: text(line.total_incl_gst),
      torqueNm: torque(line.torque_nm),
      tyre: tyre == null ? null : record(tyre) as InvoiceTyreDetails,
    };
  });

  return {
    brand: (record(selected.business_snapshot).brand ?? detail.brand ?? null) as InvoiceDocumentData['brand'],
    invoiceId: String(detail.id),
    revisionId: String(selected.id),
    invoiceNumber: String(detail.invoice_number),
    revisionNumber: Number(selected.revision_number ?? 1),
    status: String(detail.status ?? selected.lifecycle ?? 'draft'),
    issueDate: text(selected.issue_date),
    dueDate: text(selected.due_date),
    paymentTerms: text(selected.payment_terms),
    paymentMethod: text(selected.payment_method),
    customerReference: text(selected.customer_reference),
    customerNotes: content(selected.customer_notes),
    extraDescription: content(selected.extra_description),
    business: party(selected.business_snapshot),
    branch: party(selected.branch_snapshot),
    customer: party(selected.customer_snapshot),
    billingContact: selected.billing_contact_snapshot == null ? null : record(selected.billing_contact_snapshot),
    vehicle,
    job: selected.job_details == null ? (detail.job == null ? null : record(detail.job)) : { ...record(detail.job), ...record(selected.job_details) },
    lines,
    subtotal: text(selected.subtotal_ex_gst),
    discount: text(selected.discount_amount ?? selected.discount_total) ?? storedDiscountTotal(lines),
    gst: text(selected.gst_amount),
    total: text(selected.total_incl_gst),
    amountPaid: String(financials.effective_paid ?? '0'),
    balanceDue: text(financials.balance ?? selected.total_incl_gst),
  };
}
