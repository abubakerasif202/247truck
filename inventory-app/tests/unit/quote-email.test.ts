import { afterEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

import { buildQuoteEmailPayload, quoteEmailPayloadSha256, sendQuoteEmail, storeQuoteEmailPayload } from '@/lib/email/quote-email';
import type { QuoteDocumentData } from '@/lib/documents/quote-types';

const quote: QuoteDocumentData = { quoteId: 'q', quoteNumber: 'REG-QUO-000001', status: 'draft', quoteDate: '2026-09-14', expiryDate: null, customerReference: null, customerNotes: null, locationName: 'Regency Park', business: { business_name: '24/7 Truck Tyre Services' }, branch: { branch_name: 'Regency Park' }, customer: { display_name: 'Alex' }, lines: [{ id: 'l', description: 'Tyre', quantity: '1', unitPrice: '230.00', amount: '230.00', pricingTier: 'retail' }], subtotal: '209.09', gst: '20.91', total: '230.00' };

describe('quote email delivery', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it('requires a valid walk-in email and never creates a customer', async () => {
    const payload = buildQuoteEmailPayload({ quote, recipient: 'walkin@example.test', pdf: Buffer.from('pdf'), from: 'quotes@example.test', idempotencyKey: 'pending-durable-key' });
    expect(payload.to).toEqual(['walkin@example.test']);
    expect(payload.attachments[0].filename).toBe('quote-REG-QUO-000001.pdf');
    expect(payload.subject).toContain('REG-QUO-000001');
    expect(payload.html).not.toContain('wholesale');
    const invalid = await sendQuoteEmail({ recipient: 'not-an-email', idempotencyKey: 'key', preparedPayload: storeQuoteEmailPayload(payload) });
    expect(invalid.outcome).toBe('failed');
  });
  it('fingerprints the agreed PDF payload and does not send in tests', async () => {
    const input = { quote, recipient: 'a@example.test', pdf: Buffer.from('pdf'), from: 'quotes@example.test', idempotencyKey: 'pending-durable-key' };
    expect(quoteEmailPayloadSha256(input)).toMatch(/^[0-9a-f]{64}$/);
    process.env.INVOICE_EMAIL_DELIVERY_ENABLED = 'true'; process.env.RESEND_API_KEY = 'test-only';
    const result = await sendQuoteEmail({ recipient: input.recipient, idempotencyKey: input.idempotencyKey, preparedPayload: storeQuoteEmailPayload(buildQuoteEmailPayload(input)) });
    expect(result.outcome).toBe('disabled');
    expect(send).not.toHaveBeenCalled();
  });
  it('records provider acceptance through the shared Resend transport contract', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true'); vi.stubEnv('RESEND_API_KEY', 'mock-only'); vi.stubEnv('INVOICE_FROM_EMAIL', 'quotes@example.test'); send.mockResolvedValue({ data: { id: 'quote-provider-id' }, error: null });
    const input = { quote, recipient: 'a@example.test', pdf: Buffer.from('pdf'), from: 'quotes@example.test', idempotencyKey: 'key' };
    const result = await sendQuoteEmail({ recipient: input.recipient, idempotencyKey: input.idempotencyKey, preparedPayload: storeQuoteEmailPayload(buildQuoteEmailPayload(input)) });
    expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'quote-provider-id' });
  });
  it('does not mark provider failures as accepted', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true'); vi.stubEnv('RESEND_API_KEY', 'mock-only'); vi.stubEnv('INVOICE_FROM_EMAIL', 'quotes@example.test'); send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'private' } });
    const input = { quote, recipient: 'a@example.test', pdf: Buffer.from('pdf'), from: 'quotes@example.test', idempotencyKey: 'key' };
    const result = await sendQuoteEmail({ recipient: input.recipient, idempotencyKey: input.idempotencyKey, preparedPayload: storeQuoteEmailPayload(buildQuoteEmailPayload(input)) });
    expect(result.outcome).toBe('failed');
  });
});
