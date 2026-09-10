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
  tyre?: InvoiceTyreDetails | null;
};

export type InvoiceDocumentData = {
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
  business: InvoiceParty & {
    business_name?: string | null;
    shared_email?: string | null;
    logo_asset_path?: string | null;
    bank_instructions?: Record<string, unknown> | null;
    invoice_footer?: string | null;
  };
  branch: InvoiceParty & { branch_name?: string | null; contact_email?: string | null; document_footer?: string | null };
  customer: InvoiceParty;
  billingContact: InvoiceParty | null;
  vehicle: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  lines: InvoiceDocumentLine[];
  subtotal: string | null;
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
      unitPrice: text(line.unit_price_ex_gst ?? (line.unit_price_incl_gst == null ? null : (Number(line.unit_price_incl_gst) / (line.gst_treatment === 'gst_free' ? 1 : 1.1)).toFixed(2))),
      discountPercent: String(line.discount_percent ?? '0'),
      discountAmount: text(line.discount_amount),
      gstAmount: text(line.gst_amount),
      amount: text(line.subtotal_ex_gst ?? line.total_ex_gst ?? line.total_incl_gst),
      tyre: tyre == null ? null : record(tyre) as InvoiceTyreDetails,
    };
  });

  return {
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
    customerNotes: text(selected.customer_notes),
    business: party(selected.business_snapshot),
    branch: party(selected.branch_snapshot),
    customer: party(selected.customer_snapshot),
    billingContact: selected.billing_contact_snapshot == null ? null : record(selected.billing_contact_snapshot),
    vehicle,
    job: selected.job_details == null ? (detail.job == null ? null : record(detail.job)) : { ...record(detail.job), ...record(selected.job_details) },
    lines,
    subtotal: text(selected.subtotal_ex_gst),
    gst: text(selected.gst_amount),
    total: text(selected.total_incl_gst),
    amountPaid: String(financials.effective_paid ?? '0'),
    balanceDue: text(financials.balance ?? selected.total_incl_gst),
  };
}
