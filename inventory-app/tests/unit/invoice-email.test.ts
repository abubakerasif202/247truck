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

  it('reports provider acceptance with failed audit persistence without recording a false failure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'mock-only');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    send.mockResolvedValue({ data: { id: 'provider-id' }, error: null });
    const recorder = { accepted: vi.fn().mockRejectedValue(new Error('audit unavailable')), failed: vi.fn(), disabled: vi.fn() };
    const result = await sendInvoiceEmail({ invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'mock-send', recorder });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('provider accepted') });
    expect(result).toMatchObject({ error: expect.stringContaining('Do not resend') });
    expect(recorder.failed).not.toHaveBeenCalled();
  });

  it('does not expose provider error text or report a failed audit as success', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('INVOICE_EMAIL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('RESEND_API_KEY', 'mock-only');
    vi.stubEnv('INVOICE_FROM_EMAIL', 'invoices@example.test');
    send.mockRejectedValue(new Error('sensitive provider diagnostic'));
    const recorder = { accepted: vi.fn(), failed: vi.fn().mockRejectedValue(new Error('audit unavailable')), disabled: vi.fn() };
    const result = await sendInvoiceEmail({ invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'mock-failure', recorder });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Delivery history could not be saved') });
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
    await expect(sendInvoiceEmail({
      invoice: invoice10602Fixture, recipient: 'accounts@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'test-key',
    })).resolves.toEqual({ ok: false, disabled: true, error: 'Invoice email delivery is disabled.' });
  });

  it('escapes customer and business names in HTML', () => {
    const payload = buildInvoiceEmailPayload({ invoice: { ...invoice10602Fixture, customer: { display_name: '<script>alert(1)</script>' } }, recipient: 'a@example.test', from: 'a@example.test', pdf: Buffer.from('pdf'), idempotencyKey: 'safe' });
    expect(payload.html).not.toContain('<script>alert(1)</script>');
    expect(payload.html).toContain('&lt;script&gt;');
  });
});
