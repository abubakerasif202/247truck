import { afterEach, describe, expect, it } from 'vitest';

import { invoice10602Fixture } from '@/lib/documents/invoice-fixture-10602';
import { buildInvoiceEmailPayload, sendInvoiceEmail } from '@/lib/email/invoice-email';

describe('invoice email', () => {
  afterEach(() => {
    delete process.env.INVOICE_EMAIL_DELIVERY_ENABLED;
    delete process.env.RESEND_API_KEY;
    delete process.env.INVOICE_FROM_EMAIL;
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
