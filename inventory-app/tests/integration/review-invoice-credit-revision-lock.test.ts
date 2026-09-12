import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { cleanupFinanceSettings, issuedInvoice, seedFinanceSettings, sql } from './support/review-fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[review-invoice-credit-revision-lock] skipped: missing ${missing.join(', ')}`);

const PERMISSIONS = [
  'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue', 'invoices.cancel',
  'payments.view', 'payments.record', 'payments.reverse', 'refunds.create', 'receivables.view',
];

async function currentLine(t: TestTenants, invoiceId: string): Promise<{ id: string; total: string }> {
  const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: invoiceId });
  expect(detail.error, JSON.stringify(detail.error)).toBeNull();
  const revision = detail.data.revisions.find((row: Record<string, unknown>) => row.id === detail.data.current_revision_id)
    ?? detail.data.revisions.at(-1);
  return { id: String(revision.lines[0].id), total: String(revision.lines[0].total_incl_gst) };
}

async function credit(t: TestTenants, invoiceId: string, version: number, lineId: string, amount: string) {
  return t.lon.rpc('create_invoice_credit_refund', {
    p_request_id: randomUUID(), p_invoice_id: invoiceId, p_expected_version: version,
    p_input: {
      reason: 'Price allowance', credit_lines: [{ invoice_line_id: lineId, amount }],
      authorised_refund_amount: '0', payments: [],
    },
  });
}

function revise(t: TestTenants, invoiceId: string, version: number, reason = 'Requested correction') {
  return t.lon.rpc('revise_unpaid_invoice', {
    p_request_id: randomUUID(), p_invoice_id: invoiceId, p_expected_version: version,
    p_input: { revision_reason: reason, lines: [] },
  });
}

run('Review remediation: issued credits permanently lock invoice revisions', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMISSIONS });
    seedFinanceSettings(t);
  }, 60_000);

  afterAll(async () => {
    if (!t) return;
    cleanupFinanceSettings();
    await t.cleanup();
  });

  it('rejects revision after a credit without changing revisions, lines, documents, requests, or audit history', async () => {
    const invoice = await issuedInvoice(t, '100.00');
    const line = await currentLine(t, invoice.id);
    const credited = await credit(t, invoice.id, invoice.version, line.id, '80.00');
    expect(credited.error, JSON.stringify(credited.error)).toBeNull();
    const before = sql(`select concat_ws(',',
      (select count(*) from public.invoice_revisions where invoice_id='${invoice.id}'),
      (select count(*) from public.invoice_lines where invoice_id='${invoice.id}'),
      (select count(*) from public.financial_documents where invoice_id='${invoice.id}'),
      (select count(*) from public.finance_action_requests where entity_id='${invoice.id}'),
      (select count(*) from public.audit_events where entity_id='${invoice.id}'))`);

    const rejected = await revise(t, invoice.id, Number(credited.data.version));
    expect(rejected.error?.message).toBe('INVOICE_CREDIT_LOCKED');
    expect(sql(`select concat_ws(',',
      (select count(*) from public.invoice_revisions where invoice_id='${invoice.id}'),
      (select count(*) from public.invoice_lines where invoice_id='${invoice.id}'),
      (select count(*) from public.financial_documents where invoice_id='${invoice.id}'),
      (select count(*) from public.finance_action_requests where entity_id='${invoice.id}'),
      (select count(*) from public.audit_events where entity_id='${invoice.id}'))`)).toBe(before);

    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: invoice.id });
    const receivables = await t.lon.rpc('receivables_summary', { p_location_id: t.lonLocationId, p_as_of: new Date().toISOString().slice(0, 10) });
    expect(detail.error, JSON.stringify(detail.error)).toBeNull();
    expect(receivables.error, JSON.stringify(receivables.error)).toBeNull();
    expect(Number(detail.data.financials.balance)).toBe(20);
  });

  it('keeps an uncredited unpaid invoice revisable and keeps the first-payment lock unchanged', async () => {
    const uncredited = await issuedInvoice(t, '50.00');
    const revised = await revise(t, uncredited.id, uncredited.version);
    expect(revised.error, JSON.stringify(revised.error)).toBeNull();
    expect(revised.data.revision_number).toBe(2);

    const paidInvoice = await issuedInvoice(t, '60.00');
    const paid = await t.lon.rpc('record_invoice_payment', {
      p_request_id: randomUUID(), p_invoice_id: paidInvoice.id, p_expected_version: paidInvoice.version,
      p_tenders: [{ method: 'cash', amount: '10.00' }],
    });
    expect(paid.error, JSON.stringify(paid.error)).toBeNull();
    const locked = await revise(t, paidInvoice.id, Number(paid.data.version));
    expect(locked.error?.message).toBe('INVOICE_FINANCIAL_LOCKED');

    const reversed = await t.lon.rpc('reverse_manual_payment', {
      p_request_id: randomUUID(), p_invoice_id: paidInvoice.id,
      p_payment_id: paid.data.payment_ids[0], p_expected_version: Number(paid.data.version),
      p_reason: 'Payment entered against wrong invoice',
    });
    expect(reversed.error, JSON.stringify(reversed.error)).toBeNull();
    const permanentlyLocked = await revise(t, paidInvoice.id, Number(reversed.data.version), 'After payment reversal');
    expect(permanentlyLocked.error?.message).toBe('INVOICE_FINANCIAL_LOCKED');
  });

  it('enforces the credit lock in direct revision and current-pointer database guards', async () => {
    const invoice = await issuedInvoice(t, '90.00');
    const firstRevisionId = sql(`select current_revision_id from public.invoices where id='${invoice.id}'`);
    const revised = await revise(t, invoice.id, invoice.version, 'Create revision history');
    expect(revised.error, JSON.stringify(revised.error)).toBeNull();
    const line = await currentLine(t, invoice.id);
    const credited = await credit(t, invoice.id, Number(revised.data.version), line.id, '10.00');
    expect(credited.error, JSON.stringify(credited.error)).toBeNull();

    expect(() => sql(`insert into public.invoice_revisions(invoice_id,revision_number,created_by)
      values('${invoice.id}',99,'${t.lonUser.id}')`)).toThrow(/INVOICE_CREDIT_LOCKED/);
    expect(() => sql(`update public.invoices set current_revision_id='${firstRevisionId}' where id='${invoice.id}'`))
      .toThrow(/INVOICE_CREDIT_LOCKED/);
    expect(sql(`select current_revision_id from public.invoices where id='${invoice.id}'`)).toBe(String(revised.data.revision_id));
  });

  it('serializes concurrent credit and revision so the resulting invoice is financially consistent', async () => {
    const invoice = await issuedInvoice(t, '100.00');
    const line = await currentLine(t, invoice.id);
    const [creditResult, revisionResult] = await Promise.all([
      credit(t, invoice.id, invoice.version, line.id, '80.00'),
      revise(t, invoice.id, invoice.version, 'Concurrent correction'),
    ]);
    expect([creditResult, revisionResult].filter((result) => !result.error)).toHaveLength(1);
    expect([creditResult, revisionResult].filter((result) => result.error)).toHaveLength(1);

    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: invoice.id });
    expect(detail.error, JSON.stringify(detail.error)).toBeNull();
    const total = Number(detail.data.revisions.find((row: Record<string, unknown>) => row.id === detail.data.current_revision_id)?.total_incl_gst);
    const credits = Number(detail.data.financials.credits);
    expect(credits).toBeLessThanOrEqual(total);
    expect(Number(detail.data.financials.balance)).toBeGreaterThanOrEqual(0);
  });

  it('blocks the legacy void shortcut after a credit but preserves cancel_invoice for the remaining value', async () => {
    const invoice = await issuedInvoice(t, '100.00');
    const line = await currentLine(t, invoice.id);
    const credited = await credit(t, invoice.id, invoice.version, line.id, '20.00');
    expect(credited.error, JSON.stringify(credited.error)).toBeNull();

    const voided = await t.lon.rpc('void_issued_invoice', {
      p_request_id: randomUUID(), p_invoice_id: invoice.id,
      p_expected_version: Number(credited.data.version), p_reason: 'Wrong shortcut',
    });
    expect(voided.error?.message).toBe('INVOICE_CREDIT_LOCKED');

    const cancelled = await t.lon.rpc('cancel_invoice', {
      p_request_id: randomUUID(), p_invoice_id: invoice.id,
      p_expected_version: Number(credited.data.version), p_reason: 'Customer cancellation',
    });
    expect(cancelled.error, JSON.stringify(cancelled.error)).toBeNull();
    expect(cancelled.data).toMatchObject({ status: 'cancelled', balance: 0, refund_due: 0 });
    expect(sql(`select sum(total_incl_gst) from public.credit_notes where invoice_id='${invoice.id}' and status='issued'`)).toBe('100.00');
  });
});
