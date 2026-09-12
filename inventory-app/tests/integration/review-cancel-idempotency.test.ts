import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import {
  cleanupFinanceSettings,
  extractPlpgsqlFunction,
  fullPayment,
  issuedInvoice,
  seedFinanceSettings,
  sql,
} from './support/review-fixtures';

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

  it('partially-paid cancellation replays one logical credit/refund outcome under concurrent identical requests', async () => {
    const invoice = await issuedInvoice(t, '150.00');
    const paid = await fullPayment(t, invoice.id, invoice.version, '60.00');
    const requestId = randomUUID();
    const cancel = () => t.lon.rpc('cancel_invoice', {
      p_request_id: requestId, p_invoice_id: invoice.id,
      p_expected_version: paid.version, p_reason: 'Partial payment cancellation',
    });
    const [first, second] = await Promise.all([cancel(), cancel()]);
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    expect(second.error, JSON.stringify(second.error)).toBeNull();
    expect(second.data).toEqual(first.data);
    expect(first.data).toMatchObject({ status: 'issued', cancellation_pending: true, balance: 0, refund_due: 60 });
    expect(sql(`select count(*) from public.credit_notes where invoice_id='${invoice.id}'`)).toBe('1');
    expect(sql(`select count(*) from public.refunds where invoice_id='${invoice.id}'`)).toBe('1');
    expect(sql(`select count(*) from public.finance_action_requests where request_id='${requestId}'`)).toBe('1');
  });

  it('rejects reuse of a cancellation key for a different invoice', async () => {
    const firstInvoice = await issuedInvoice(t, '25.00');
    const secondInvoice = await issuedInvoice(t, '30.00');
    const requestId = randomUUID();
    const first = await t.lon.rpc('cancel_invoice', {
      p_request_id: requestId, p_invoice_id: firstInvoice.id,
      p_expected_version: firstInvoice.version, p_reason: 'Duplicate order',
    });
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    const mismatch = await t.lon.rpc('cancel_invoice', {
      p_request_id: requestId, p_invoice_id: secondInvoice.id,
      p_expected_version: secondInvoice.version, p_reason: 'Duplicate order',
    });
    expect(mismatch.error?.message).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

const OLD_CANCEL_INVOICE_SQL = extractPlpgsqlFunction(
  'supabase/migrations/20260911100000_phase_4d_credit_notes_refunds.sql',
  'create or replace function public.cancel_invoice(',
);
const NEW_CANCEL_INVOICE_SQL = extractPlpgsqlFunction(
  'supabase/migrations/20260912130000_invoice_credit_revision_lock.sql',
  'create or replace function public.cancel_invoice(',
);

function countsSnapshot(invoiceId: string): { credits: string; refunds: string; requests: string } {
  return {
    credits: sql(`select count(*) from public.credit_notes where invoice_id='${invoiceId}'`),
    refunds: sql(`select count(*) from public.refunds where invoice_id='${invoiceId}'`),
    requests: sql(`select count(*) from public.finance_action_requests where entity_id='${invoiceId}'`),
  };
}

run('Review remediation: legacy cancel_invoice fingerprint compatibility', () => {
  let t: TestTenants;
  let paidInvoiceId: string;
  let paidInvoiceVersionAtCancel: number;
  let unpaidInvoiceId: string;
  let unpaidInvoiceVersionAtCancel: number;
  let draftInvoiceId: string;
  const R_legacy1 = randomUUID();
  const R_legacy2 = randomUUID();
  const R_legacy3 = randomUUID();
  let legacyResult1: Record<string, unknown>;
  let legacyResult2: Record<string, unknown>;
  let legacyResult3: Record<string, unknown>;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS, regPermissions: PERMS });
    seedFinanceSettings(t);

    // Install the OLD cancel_invoice (fingerprint includes generated data).
    sql(OLD_CANCEL_INVOICE_SQL);
    try {
      // (a) issued + fully paid invoice, cancel -> pending refund (legacy hash).
      const invoice1 = await issuedInvoice(t, '150.00');
      const paid1 = await fullPayment(t, invoice1.id, invoice1.version, '150.00');
      paidInvoiceId = invoice1.id;
      paidInvoiceVersionAtCancel = paid1.version;
      const r1 = await t.lon.rpc('cancel_invoice', {
        p_request_id: R_legacy1, p_invoice_id: invoice1.id, p_expected_version: paid1.version, p_reason: 'Legacy full refund',
      });
      expect(r1.error, JSON.stringify(r1.error)).toBeNull();
      expect(r1.data).toMatchObject({ status: 'issued', cancellation_pending: true });
      legacyResult1 = r1.data;

      // (b) issued, unpaid invoice, cancel -> cancelled immediately.
      const invoice2 = await issuedInvoice(t, '70.00');
      unpaidInvoiceId = invoice2.id;
      unpaidInvoiceVersionAtCancel = invoice2.version;
      const r2 = await t.lon.rpc('cancel_invoice', {
        p_request_id: R_legacy2, p_invoice_id: invoice2.id, p_expected_version: invoice2.version, p_reason: 'Legacy unpaid cancel',
      });
      expect(r2.error, JSON.stringify(r2.error)).toBeNull();
      expect(r2.data).toMatchObject({ status: 'cancelled' });
      legacyResult2 = r2.data;

      // (c) draft invoice, cancel -> cancelled (no financial data at all).
      const draftMade = await t.lon.rpc('create_manual_invoice', {
        p_request_id: randomUUID(), p_location_id: t.lonLocationId,
        p_input: { payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Legacy draft', quantity: '1', unit_price_incl_gst: '30.00' }] },
      });
      expect(draftMade.error, JSON.stringify(draftMade.error)).toBeNull();
      draftInvoiceId = draftMade.data.invoice_id as string;
      const r3 = await t.lon.rpc('cancel_invoice', {
        p_request_id: R_legacy3, p_invoice_id: draftInvoiceId, p_expected_version: 1, p_reason: 'Legacy draft cancel',
      });
      expect(r3.error, JSON.stringify(r3.error)).toBeNull();
      expect(r3.data).toMatchObject({ status: 'cancelled' });
      legacyResult3 = r3.data;
    } finally {
      // Always restore the NEW cancel_invoice, even if seeding above failed.
      sql(NEW_CANCEL_INVOICE_SQL);
    }
  }, 60_000);

  afterAll(async () => {
    if (!t) return;
    // Belt and braces: the NEW function must be installed regardless of what
    // happened inside individual tests below (none of them reinstall OLD).
    sql(NEW_CANCEL_INVOICE_SQL);
    cleanupFinanceSettings();
    await t.cleanup();
  });

  it('identical retries of R_legacy1/2/3 replay the original legacy results with no new rows', async () => {
    const before1 = countsSnapshot(paidInvoiceId);
    const before2 = countsSnapshot(unpaidInvoiceId);

    const replay1 = await t.lon.rpc('cancel_invoice', {
      p_request_id: R_legacy1, p_invoice_id: paidInvoiceId, p_expected_version: paidInvoiceVersionAtCancel, p_reason: 'Legacy full refund',
    });
    expect(replay1.error, JSON.stringify(replay1.error)).toBeNull();
    expect(replay1.data).toEqual(legacyResult1);

    const replay2 = await t.lon.rpc('cancel_invoice', {
      p_request_id: R_legacy2, p_invoice_id: unpaidInvoiceId, p_expected_version: unpaidInvoiceVersionAtCancel, p_reason: 'Legacy unpaid cancel',
    });
    expect(replay2.error, JSON.stringify(replay2.error)).toBeNull();
    expect(replay2.data).toEqual(legacyResult2);

    const replay3 = await t.lon.rpc('cancel_invoice', {
      p_request_id: R_legacy3, p_invoice_id: draftInvoiceId, p_expected_version: 1, p_reason: 'Legacy draft cancel',
    });
    expect(replay3.error, JSON.stringify(replay3.error)).toBeNull();
    expect(replay3.data).toEqual(legacyResult3);

    expect(countsSnapshot(paidInvoiceId)).toEqual(before1);
    expect(countsSnapshot(unpaidInvoiceId)).toEqual(before2);
  });

  it('R_legacy1 with a different reason is IDEMPOTENCY_KEY_REUSED; a different actor never replays', async () => {
    const differentReason = await t.lon.rpc('cancel_invoice', {
      p_request_id: R_legacy1, p_invoice_id: paidInvoiceId, p_expected_version: paidInvoiceVersionAtCancel, p_reason: 'A completely different reason',
    });
    expect(differentReason.error?.message).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(differentReason.error?.code).toBe('23505');

    const differentActor = await t.reg.rpc('cancel_invoice', {
      p_request_id: R_legacy1, p_invoice_id: paidInvoiceId, p_expected_version: paidInvoiceVersionAtCancel, p_reason: 'Legacy full refund',
    });
    expect(['ACCESS_DENIED', 'IDEMPOTENCY_KEY_REUSED']).toContain(differentActor.error?.message);
    expect(differentActor.data).toBeNull();
  });

  it('finance_request_outcome(R_legacy1): found for LON and admin, ACCESS_DENIED for REG, not-found for an unknown id', async () => {
    const asLon = await t.lon.rpc('finance_request_outcome', { p_request_id: R_legacy1 });
    expect(asLon.error, JSON.stringify(asLon.error)).toBeNull();
    expect(asLon.data).toMatchObject({ found: true, action: 'cancel_invoice', invoice_status: 'issued' });
    expect((asLon.data.result as Record<string, unknown>).cancellation_pending).toBe(true);

    const asReg = await t.reg.rpc('finance_request_outcome', { p_request_id: R_legacy1 });
    expect(asReg.error?.message).toBe('ACCESS_DENIED');

    const asAdmin = await t.admin.rpc('finance_request_outcome', { p_request_id: R_legacy1 });
    expect(asAdmin.error, JSON.stringify(asAdmin.error)).toBeNull();
    expect(asAdmin.data).toMatchObject({ found: true });

    const unknown = await t.lon.rpc('finance_request_outcome', { p_request_id: randomUUID() });
    expect(unknown.error).toBeNull();
    expect(unknown.data).toEqual({ found: false });
  });

  it('completing the pending refund then cancelling with a new request leaves R_legacy1 replaying its original (immutable) pending result', async () => {
    const history = await t.lon.rpc('invoice_credit_refund_history', { p_invoice_id: paidInvoiceId });
    expect(history.error, JSON.stringify(history.error)).toBeNull();
    const refund = (history.data.refunds as { id: string; version: number; status: string }[])[0];
    expect(refund.status).toBe('pending');

    const confirmed = await t.lon.rpc('confirm_manual_refund', {
      p_request_id: randomUUID(), p_refund_id: refund.id, p_expected_version: refund.version,
      p_evidence: { payout_method: 'cash', payout_reference: 'cash-refund-legacy-1', evidence: 'Cash returned at counter' },
    });
    expect(confirmed.error, JSON.stringify(confirmed.error)).toBeNull();

    const finalRequest = randomUUID();
    const final = await t.lon.rpc('cancel_invoice', {
      p_request_id: finalRequest, p_invoice_id: paidInvoiceId, p_expected_version: confirmed.data.version, p_reason: 'Legacy full refund',
    });
    expect(final.error, JSON.stringify(final.error)).toBeNull();
    expect(final.data).toMatchObject({ status: 'cancelled' });

    // R_legacy1 still replays the ORIGINAL pending result, not the new
    // (now-cancelled) invoice state: cancellation history is immutable.
    const stillLegacy = await t.lon.rpc('cancel_invoice', {
      p_request_id: R_legacy1, p_invoice_id: paidInvoiceId, p_expected_version: paidInvoiceVersionAtCancel, p_reason: 'Legacy full refund',
    });
    expect(stillLegacy.error, JSON.stringify(stillLegacy.error)).toBeNull();
    expect(stillLegacy.data).toEqual(legacyResult1);
    expect((stillLegacy.data as Record<string, unknown>).cancellation_pending).toBe(true);
  });
});
