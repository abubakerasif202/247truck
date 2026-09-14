import 'server-only';
import { createHash } from 'node:crypto';
import { invoiceEmailSender, sendPdfEmail, storePdfEmailPayload, type PdfEmailPayload, type StoredPdfEmailPayload, type InvoiceEmailOutcome } from './invoice-email';
import type { QuoteDocumentData } from '@/lib/documents/quote-types';

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
const money = (value: string | null) => value == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value));

export function buildQuoteEmailPayload(input: { quote: QuoteDocumentData; recipient: string; pdf: Buffer; from: string; idempotencyKey: string }): PdfEmailPayload {
  const business = input.quote.business.business_name ?? input.quote.business.display_name ?? '24/7 Truck Tyre Services';
  const customer = input.quote.customer.display_name ?? input.quote.customer.company_name ?? 'Customer';
  return { from: input.from, to: [input.recipient], replyTo: input.quote.business.shared_email ?? input.quote.branch.contact_email ?? undefined, subject: `Quote ${input.quote.quoteNumber} — ${business}`, idempotencyKey: input.idempotencyKey, attachments: [{ filename: `quote-${input.quote.quoteNumber.replace(/[^a-z0-9_-]/gi, '-')}.pdf`, content: input.pdf }], html: `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#20242a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-collapse:collapse"><tr><td style="border-top:5px solid #c91f2c;padding:32px"><h1 style="margin:0 0 20px;font-size:24px">Quote ${escapeHtml(input.quote.quoteNumber)}</h1><p>Hi ${escapeHtml(customer)},</p><p>Please find your quote from ${escapeHtml(business)} attached.</p><table role="presentation" width="100%" style="margin:24px 0;background:#f7f7f8;border-collapse:collapse"><tr><td style="padding:16px">Total incl GST</td><td align="right" style="padding:16px;font-weight:bold">${money(input.quote.total)}</td></tr></table><p>The attached PDF contains the quoted items and agreed prices.</p><p style="margin-top:28px">Regards,<br><strong>${escapeHtml(business)}</strong></p></td></tr></table></td></tr></table></body></html>` };
}

export function quoteEmailPayloadSha256(input: Parameters<typeof buildQuoteEmailPayload>[0]): string {
  const payload = buildQuoteEmailPayload(input); const hash = createHash('sha256');
  hash.update(payload.from); hash.update('\0'); hash.update(payload.to.join('\0')); hash.update('\0'); hash.update(payload.replyTo ?? ''); hash.update('\0'); hash.update(payload.subject); hash.update('\0'); hash.update(payload.html);
  for (const attachment of payload.attachments) { hash.update('\0'); hash.update(attachment.filename); hash.update('\0'); hash.update(attachment.content); }
  return hash.digest('hex');
}

export function storeQuoteEmailPayload(payload: PdfEmailPayload): StoredPdfEmailPayload { return storePdfEmailPayload(payload); }

export async function sendQuoteEmail(input: { recipient: string; idempotencyKey: string; preparedPayload: StoredPdfEmailPayload }): Promise<InvoiceEmailOutcome> {
  return sendPdfEmail({ recipient: input.recipient, idempotencyKey: input.idempotencyKey, preparedPayload: input.preparedPayload, enabled: process.env.INVOICE_EMAIL_DELIVERY_ENABLED === 'true' && process.env.NODE_ENV !== 'test', apiKey: process.env.RESEND_API_KEY?.trim(), from: invoiceEmailSender() });
}
