import 'server-only';

import { Resend } from 'resend';

import type { InvoiceDocumentData } from '@/lib/documents/invoice-types';

export type InvoiceEmailPayload = {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachments: { filename: string; content: Buffer }[];
  idempotencyKey: string;
};

export type InvoiceDeliveryRecord = {
  invoiceId: string;
  revisionId: string;
  revisionNumber: number;
  recipient: string;
  sender: string;
  providerMessageId: string;
  idempotencyKey: string;
};

/** Persistence is owned by the finance delivery transaction/migration. */
export interface InvoiceDeliveryRecorder {
  accepted(record: InvoiceDeliveryRecord): Promise<void>;
  failed(input: Omit<InvoiceDeliveryRecord, 'providerMessageId'> & { error: string }): Promise<void>;
  disabled(input: Omit<InvoiceDeliveryRecord, 'providerMessageId'> & { error: string }): Promise<void>;
}

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const money = (value: string | null) => value == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value));

export function buildInvoiceEmailPayload(input: {
  invoice: InvoiceDocumentData;
  recipient: string;
  pdf: Buffer;
  from: string;
  idempotencyKey: string;
}): InvoiceEmailPayload {
  const { invoice } = input;
  const business = invoice.business.business_name ?? invoice.business.display_name ?? '24/7 Truck Tyre Services';
  const customer = invoice.customer.display_name ?? invoice.customer.company_name ?? invoice.customer.label ?? 'Customer';
  const safeBusiness = escapeHtml(business);
  return {
    from: input.from,
    to: [input.recipient],
    replyTo: invoice.business.shared_email ?? invoice.branch.contact_email ?? undefined,
    subject: `${business} tax invoice ${invoice.invoiceNumber}`,
    idempotencyKey: input.idempotencyKey,
    attachments: [{ filename: `tax-invoice-${invoice.invoiceNumber.replace(/[^a-z0-9_-]/gi, '-')}.pdf`, content: input.pdf }],
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#20242a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-collapse:collapse"><tr><td style="border-top:5px solid #c91f2c;padding:32px"><h1 style="margin:0 0 20px;font-size:24px">Tax invoice ${escapeHtml(invoice.invoiceNumber)}</h1><p>Hi ${escapeHtml(customer)},</p><p>Please find your tax invoice from ${safeBusiness} attached.</p><table role="presentation" width="100%" style="margin:24px 0;background:#f7f7f8;border-collapse:collapse"><tr><td style="padding:16px">Total</td><td align="right" style="padding:16px;font-weight:bold">${money(invoice.total)}</td></tr><tr><td style="padding:0 16px 16px">Balance due</td><td align="right" style="padding:0 16px 16px;color:#c91f2c;font-weight:bold">${money(invoice.balanceDue)}</td></tr></table><p>The attached PDF contains the itemised invoice and payment instructions.</p><p style="margin-top:28px">Regards,<br><strong>${safeBusiness}</strong></p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendInvoiceEmail(input: {
  invoice: InvoiceDocumentData;
  recipient: string;
  pdf: Buffer;
  idempotencyKey: string;
  recorder?: InvoiceDeliveryRecorder;
}): Promise<{ ok: true; providerMessageId: string } | { ok: false; error: string; disabled?: boolean }> {
  if (input.invoice.status !== 'issued') return { ok: false, error: 'Only issued invoices can be emailed.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient)) return { ok: false, error: 'A valid recipient email is required.' };
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.INVOICE_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL)?.trim();
  const enabled = process.env.INVOICE_EMAIL_DELIVERY_ENABLED === 'true' && process.env.NODE_ENV !== 'test';
  const baseRecord = { invoiceId: input.invoice.invoiceId, revisionId: input.invoice.revisionId, revisionNumber: input.invoice.revisionNumber, recipient: input.recipient, sender: from ?? '', idempotencyKey: input.idempotencyKey };
  if (!enabled) {
    try { await input.recorder?.disabled({ ...baseRecord, error: 'Invoice email delivery is disabled.' }); }
    catch { return { ok: false, disabled: true, error: 'Invoice email delivery is disabled. Delivery history could not be saved.' }; }
    return { ok: false, disabled: true, error: 'Invoice email delivery is disabled.' };
  }
  if (!apiKey || !from) return { ok: false, error: 'Invoice email delivery is not configured.' };

  const payload = buildInvoiceEmailPayload({ ...input, from });
  const resend = new Resend(apiKey);
  const acceptedRecord = { ...baseRecord, sender: from };
  let providerMessageId: string;
  try {
    const { data, error } = await resend.emails.send({
      from: payload.from, to: payload.to, replyTo: payload.replyTo, subject: payload.subject,
      html: payload.html, attachments: payload.attachments,
    }, { idempotencyKey: payload.idempotencyKey });
    if (error || !data?.id) throw new Error(error?.message ?? 'Provider did not return a message ID.');
    providerMessageId = data.id;
  } catch {
    const message = 'Invoice email could not be confirmed by the provider. Check provider delivery history before resending.';
    try { await input.recorder?.failed({ ...acceptedRecord, error: message }); }
    catch { return { ok: false, error: `${message} Delivery history could not be saved.` }; }
    return { ok: false, error: message };
  }
  try { await input.recorder?.accepted({ ...acceptedRecord, providerMessageId }); }
  catch { return { ok: false, error: 'The provider accepted the invoice email, but delivery history could not be saved. Do not resend; ask an administrator to reconcile the delivery.' }; }
  return { ok: true, providerMessageId };
}
