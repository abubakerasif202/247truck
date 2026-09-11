import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { cleanupFinanceSettings, fullPayment, issuedInvoice, seedFinanceSettings, sql } from './support/review-fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[review-cancel-idempotency] skipped: missing ${missing.join(', ')}`);

const PERMS = ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue', 'invoices.cancel', 'payments.view', 'payments.record', 'payments.reverse', 'refunds.create'];

run('Review remediation: cancel_invoice idempotency fingerprint excludes generated data', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS });
    seedFinanceSettings(t);
  }, 60_000);

  afterAll(async () => {
    if (!t) return;
    cleanupFinanceSettings();
    await t.cleanup();
  });

  it('draft cancellation: identical retry replays, one version bump; changed reason is IDEMPOTENCY_KEY_REUSED', async () => {
    const made = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Draft to cancel', quantity: '1', unit_price_incl_gst: '40.00' }] },
    });
    expect(made.error, JSON.stringify(made.error)).toBeNull();
    const invoiceId = made.data.invoice_id as string;

    const r1 = randomUUID();
    const first = await t.lon.rpc('cancel_invoice', { p_request_id: r1, p_invoice_id: invoiceId, p_expected_version: 1, p_reason: 'Customer changed mind' });
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    expect(first.data).toMatchObject({ invoice_id: invoiceId, status: 'cancelled', version: 2 });

    const replay = await t.lon.rpc('cancel_invoice', { p_request_id: r1, p_invoice_id: invoiceId, p_expected_version: 1, p_reason: 'Customer changed mind' });
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(first.data);
    expect(sql(`select version from public.invoices where id='${invoiceId}'`)).toBe('2');

    const mismatch = await t.lon.rpc('cancel_invoice', { p_request_id: r1, p_invoice_id: invoiceId, p_expected_version: 1, p_reason: 'A different reason' });
    expect(mismatch.error?.message).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('issued unpaid cancellation: full-sale credit with no refund; identical retry does not duplicate the credit note; changed version is IDEMPOTENCY_KEY_REUSED', async () => {
    const invoice = await issuedInvoice(t, '120.00');
    const r2 = randomUUID();
    const first = await t.lon.rpc('cancel_invoice', { p_request_id: r2, p_invoice_id: invoice.id, p_expected_version: invoice.version, p_reason: 'Never delivered' });
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    expect(first.data).toMatchObject({ status: 'cancelled', balance: 0, refund_due: 0 });
    expect(sql(`select count(*) from public.credit_notes where invoice_id='${invoice.id}'`)).toBe('1');
    expect(sql(`select count(*) from public.refunds where invoice_id='${invoice.id}'`)).toBe('0');

    const replay = await t.lon.rpc('cancel_invoice', { p_request_id: r2, p_invoice_id: invoice.id, p_expected_version: invoice.version, p_reason: 'Never delivered' });
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(first.data);
    expect(sql(`select count(*) from public.credit_notes where invoice_id='${invoice.id}'`)).toBe('1');

    const mismatch = await t.lon.rpc('cancel_invoice', { p_request_id: r2, p_invoice_id: invoice.id, p_expected_version: 999, p_reason: 'Never delivered' });
    expect(mismatch.error?.message).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('pending-refund cancellation: identical retries never duplicate refunds; generated audit event is written exactly once', async () => {
    const invoice = await issuedInvoice(t, '150.00');
    const paid = await fullPayment(t, invoice.id, invoice.version, '150.00');

    const r3 = randomUUID();
    const first = await t.lon.rpc('cancel_invoice', { p_request_id: r3, p_invoice_id: invoice.id, p_expected_version: paid.version, p_reason: 'Full refund owed' });
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    expect(first.data).toMatchObject({ status: 'issued', cancellation_pending: true, refund_due: 150, balance: 0 });
    expect(sql(`select count(*) from public.refunds where invoice_id='${invoice.id}'`)).toBe('1');

    const replay = await t.lon.rpc('cancel_invoice', { p_request_id: r3, p_invoice_id: invoice.id, p_expected_version: paid.version, p_reason: 'Full refund owed' });
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(first.data);
    expect(sql(`select count(*) from public.refunds where invoice_id='${invoice.id}'`)).toBe('1');
    expect(sql(`select count(*) from public.audit_events where event_type='INVOICE_CANCELLATION_GENERATED' and entity_id='${invoice.id}' and details->>'request_id'='${r3}'`)).toBe('1');

    const history = await t.lon.rpc('invoice_credit_refund_history', { p_invoice_id: invoice.id });
    expect(history.error).toBeNull();
    const refund = history.data.refunds[0];
    const confirmed = await t.lon.rpc('confirm_manual_refund', {
      p_request_id: randomUUID(), p_refund_id: refund.id, p_expected_version: refund.version,
      p_evidence: { payout_method: 'cash', payout_reference: 'cash-refund-review-1', evidence: 'Cash returned at counter' },
    });
    expect(confirmed.error, JSON.stringify(confirmed.error)).toBeNull();

    const r4 = randomUUID();
    const final = await t.lon.rpc('cancel_invoice', { p_request_id: r4, p_invoice_id: invoice.id, p_expected_version: confirmed.data.version, p_reason: 'Full refund owed' });
    expect(final.error, JSON.stringify(final.error)).toBeNull();
    expect(final.data).toMatchObject({ status: 'cancelled', balance: 0, refund_due: 0, actual_net_cash: 0 });

    const finalReplay = await t.lon.rpc('cancel_invoice', { p_request_id: r4, p_invoice_id: invoice.id, p_expected_version: confirmed.data.version, p_reason: 'Full refund owed' });
    expect(finalReplay.error).toBeNull();
    expect(finalReplay.data).toEqual(final.data);

    // Only one INVOICE_CANCELLATION_GENERATED audit event exists for the whole
    // flow (written once during the original R3 call, not again on any replay).
    expect(sql(`select count(*) from public.audit_events where event_type='INVOICE_CANCELLATION_GENERATED' and entity_id='${invoice.id}'`)).toBe('1');
  });
});
