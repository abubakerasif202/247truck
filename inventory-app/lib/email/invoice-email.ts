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

export type InvoiceEmailOutcome =
  | { outcome: 'accepted'; providerMessageId: string }
  | { outcome: 'failed'; error: string }
  | { outcome: 'uncertain'; error: string }
  | { outcome: 'disabled'; error: string }
  | { outcome: 'not_configured'; error: string };

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

/**
 * Resend error names that indicate the request itself was rejected (bad
 * recipient, bad key reuse, bad credentials, etc). Retrying with the same
 * input will not help; the caller must fix something first.
 */
const FAILED_ERROR_NAMES = new Set([
  'validation_error',
  'missing_required_field',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
  'not_found',
  'restricted_api_key',
  'invalid_access',
  'invalid_parameter',
  'invalid_region',
  'invalid_attachment',
  'invalid_from_address',
  'invalid_to_address',
  'missing_api_key',
]);

function classifyProviderError(name: string | undefined): 'failed' | 'uncertain' {
  // 'concurrent_idempotent_requests' (another attempt with this key is in flight)
  // is deliberately NOT in the failed set: the other attempt may be accepted.
  if (name && FAILED_ERROR_NAMES.has(name)) return 'failed';
  // Unknown or explicitly uncertain names default to 'uncertain' so a retry
  // reuses the idempotency key rather than risking a silent drop.
  return 'uncertain';
}

/**
 * Sends the invoice email and classifies the outcome. Never persists
 * anything — persistence (the send-request state machine and the immutable
 * delivery log) is owned by the caller via the finance RPCs.
 */
export async function sendInvoiceEmail(input: {
  invoice: InvoiceDocumentData;
  recipient: string;
  pdf: Buffer;
  idempotencyKey: string;
}): Promise<InvoiceEmailOutcome> {
  if (input.invoice.status !== 'issued') return { outcome: 'failed', error: 'Only issued invoices can be emailed.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient)) return { outcome: 'failed', error: 'A valid recipient email is required.' };
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.INVOICE_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL)?.trim();
  const enabled = process.env.INVOICE_EMAIL_DELIVERY_ENABLED === 'true' && process.env.NODE_ENV !== 'test';
  if (!enabled) return { outcome: 'disabled', error: 'Invoice email delivery is disabled.' };
  if (!apiKey || !from) return { outcome: 'not_configured', error: 'Invoice email delivery is not configured.' };

  const payload = buildInvoiceEmailPayload({ ...input, from });
  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: payload.from, to: payload.to, replyTo: payload.replyTo, subject: payload.subject,
      html: payload.html, attachments: payload.attachments,
    }, { idempotencyKey: payload.idempotencyKey });
    if (error) {
      const classification = classifyProviderError(error.name);
      console.error('[email] provider returned an error', { name: error.name });
      return classification === 'failed'
        ? { outcome: 'failed', error: 'The email provider rejected this send.' }
        : { outcome: 'uncertain', error: 'The provider did not confirm this send.' };
    }
    if (!data?.id) {
      console.error('[email] provider returned no message id', { name: undefined });
      return { outcome: 'uncertain', error: 'The provider did not confirm this send.' };
    }
    return { outcome: 'accepted', providerMessageId: data.id };
  } catch (thrown) {
    // Network/timeout errors: the request may or may not have reached the
    // provider, so the outcome is genuinely unknown. Never leak the raw error.
    console.error('[email] provider call threw', { name: thrown instanceof Error ? thrown.name : 'unknown' });
    return { outcome: 'uncertain', error: 'The provider did not confirm this send.' };
  }
}
