import { afterEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

import { invoice10602Fixture } from '@/lib/documents/invoice-fixture-10602';
import { buildInvoiceEmailPayload, sendInvoiceEmail } from '@/lib/email/invoice-email';

describe('invoice email', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    delete process.env.INVOICE_EMAIL_DELIVERY_ENABLED;
    delete process.env.RESEND_API_KEY;
    delete process.env.INVOICE_FROM_EMAIL;
  });

  it('reports acceptance with the provider message id', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'mock-only');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    send.mockResolvedValue({ data: { id: 'provider-id' }, error: null });
    const result = await sendInvoiceEmail({ invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'mock-send' });
    expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'provider-id' });
  });

  it('classifies a thrown provider error as uncertain without leaking provider text', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'mock-only');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    send.mockRejectedValue(new Error('sensitive provider diagnostic'));
    const result = await sendInvoiceEmail({ invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'mock-failure' });
    expect(result.outcome).toBe('uncertain');
    expect(JSON.stringify(result)).not.toContain('sensitive provider diagnostic');
  });

  it('classifies a 5xx-style provider error as uncertain', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'mock-only');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    send.mockResolvedValue({ data: null, error: { name: 'internal_server_error', message: 'sensitive provider diagnostic' } });
    const result = await sendInvoiceEmail({ invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'mock-5xx' });
    expect(result.outcome).toBe('uncertain');
    expect(JSON.stringify(result)).not.toContain('sensitive provider diagnostic');
  });

  it('classifies a validation-style provider error as failed', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'mock-only');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'sensitive provider diagnostic' } });
    const result = await sendInvoiceEmail({ invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'mock-validation' });
    expect(result.outcome).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('sensitive provider diagnostic');
  });

  it('builds a professional payload with an attached immutable invoice revision', () => {
    const payload = buildInvoiceEmailPayload({
      invoice: invoice10602Fixture,
      recipient: 'accounts@example.test',
      from: '24/7 Truck Tyre Services <invoices@example.test>',
      pdf: Buffer.from('%PDF-test'),
      idempotencyKey: 'invoice/fixture-10602/fixture-10602-r1/send-1',
    });
    expect(payload.to).toEqual(['accounts@example.test']);
    expect(payload.subject).toContain('10602');
    expect(payload.html).toContain('$3,476.00');
    expect(payload.attachments[0]).toMatchObject({ filename: 'tax-invoice-10602.pdf' });
    expect(payload.idempotencyKey).toContain(invoice10602Fixture.revisionId);
  });

  it('never calls Resend in tests or while delivery is disabled', async () => {
    process.env.INVOICE_EMAIL_DELIVERY_ENABLED = 'true';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.INVOICE_FROM_EMAIL = 'invoices@example.test';
    const result = await sendInvoiceEmail({
      invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'test-key',
    });
    expect(result).toEqual({ outcome: 'disabled', error: 'Invoice email delivery is disabled.' });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports not_configured when the API key or sender is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    const result = await sendInvoiceEmail({
      invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'test-key',
    });
    expect(result.outcome).toBe('not_configured');
    expect(send).not.toHaveBeenCalled();
  });

  it('escapes customer and business names in HTML', () => {
    const payload = buildInvoiceEmailPayload({ invoice: { ...invoice10602Fixture, customer: { display_name: '<script>alert(1)</script>' } }, recipient: 'a@example.test', from: 'a@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'safe' });
    expect(payload.html).not.toContain('<script>alert(1)</script>');
    expect(payload.html).toContain('&lt;script&gt;');
  });
});
