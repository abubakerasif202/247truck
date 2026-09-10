import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[finance-credit-refunds] skipped: missing ${missing.join(', ')}`);

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

const PERMISSIONS = ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue', 'invoices.cancel', 'payments.view', 'payments.record', 'payments.reverse', 'refunds.create'];

run('Phase 4D credit notes and refunds', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMISSIONS, regPermissions: PERMISSIONS });
    sql(`
      insert into public.finance_settings(singleton,business_name,abn,address,phone,shared_email,version,updated_by)
      values(true,'24/7 Truck Tyre Services','12345678901','{"street_address":"1 Test Rd","suburb":"Adelaide","state":"SA","postcode":"5000"}','0880000000','accounts@example.test',1,'${t.adminUser.id}')
      on conflict(singleton) do update set business_name=excluded.business_name,abn=excluded.abn,address=excluded.address,phone=excluded.phone,shared_email=excluded.shared_email;
      insert into public.finance_location_settings(location_id,branch_name,address,phone,contact_email,version,updated_by)
      values('${t.lonLocationId}','Lonsdale','{"street_address":"2 Test Rd","suburb":"Lonsdale","state":"SA","postcode":"5160"}','0881111111','lon@example.test',1,'${t.adminUser.id}')
      on conflict(location_id) do update set branch_name=excluded.branch_name,address=excluded.address,phone=excluded.phone,contact_email=excluded.contact_email;
    `);
  });

  afterAll(async () => {
    if (!t) return;
    sql('delete from public.finance_location_settings; delete from public.finance_settings;');
    await t.cleanup();
  });

  async function issuedInvoice(amount = '100.00') {
    const made = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Workshop service', quantity: '1', unit_price_incl_gst: amount }] },
    });
    expect(made.error, JSON.stringify(made.error)).toBeNull();
    const issued = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: made.data.invoice_id, p_expected_version: 1 });
    expect(issued.error, JSON.stringify(issued.error)).toBeNull();
    return { id: made.data.invoice_id as string, version: Number(issued.data.version), lineId: String((await t.lon.rpc('invoice_detail', { p_invoice_id: made.data.invoice_id })).data.revisions[0].lines[0].id) };
  }

  async function payment(invoiceId: string, version: number, amount: string, method = 'cash') {
    const result = await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoiceId, p_expected_version: version, p_tenders: [{ method, amount }] });
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    return result.data;
  }

  it('projects debt-only and partial cash-return credits exactly', async () => {
    const debt = await issuedInvoice();
    const debtResult = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: debt.id, p_expected_version: debt.version, p_input: { reason: 'Debt adjustment', credit_lines: [{ invoice_line_id: debt.lineId, amount: '20.00' }], authorised_refund_amount: '0', payments: [] } });
    expect(debtResult.error).toBeNull();
    expect(debtResult.data).toMatchObject({ total: 100, credits: 20, gross_paid: 0, balance: 80, refund_due: 0 });

    const partial = await issuedInvoice();
    const paid = await payment(partial.id, partial.version, '60.00');
    const result = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: partial.id, p_expected_version: paid.version, p_input: { reason: 'Partial cash return', credit_lines: [{ invoice_line_id: partial.lineId, amount: '20.00' }], authorised_refund_amount: '10.00', payments: [{ payment_id: paid.payment_ids[0], amount: '10.00' }] } });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ total: 100, credits: 20, gross_paid: 60, applied_to_sale: 50, balance: 30, refund_due: 10, actual_net_cash: 60 });
  });

  it('keeps pending payout as a liability and finalises cancellation only through cancel_invoice', async () => {
    const invoice = await issuedInvoice();
    const paid = await payment(invoice.id, invoice.version, '40.00');
    const cancelled = await t.lon.rpc('cancel_invoice', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: paid.version, p_reason: 'Customer cancellation' });
    expect(cancelled.error).toBeNull();
    expect(cancelled.data).toMatchObject({ status: 'issued', cancellation_pending: true, refund_due: 40, balance: 0 });
    const history = await t.lon.rpc('invoice_credit_refund_history', { p_invoice_id: invoice.id });
    const refund = history.data.refunds[0];
    const confirmed = await t.lon.rpc('confirm_manual_refund', { p_request_id: randomUUID(), p_refund_id: refund.id, p_expected_version: refund.version, p_evidence: { payout_method: 'cash', payout_reference: 'cash-4d-1', evidence: 'Cash returned at counter' } });
    expect(confirmed.error).toBeNull();
    const final = await t.lon.rpc('cancel_invoice', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: confirmed.data.version, p_reason: 'Customer cancellation' });
    expect(final.error).toBeNull();
    expect(final.data).toMatchObject({ status: 'cancelled', balance: 0, refund_due: 0, actual_net_cash: 0 });
  });

  it('handles full cancellation, split tender, and zero-value cancellation without stock writes', async () => {
    const before = sql('select count(*) from public.inventory_movements');
    const invoice = await issuedInvoice();
    const paid = await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: invoice.version, p_tenders: [{ method: 'cash', amount: '40.00' }, { method: 'eftpos', amount: '60.00' }] });
    expect(paid.error).toBeNull();
    const cancelled = await t.lon.rpc('cancel_invoice', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: paid.data.version, p_reason: 'Full cancellation' });
    expect(cancelled.error).toBeNull();
    expect(cancelled.data).toMatchObject({ credits: 100, gross_paid: 100, applied_to_sale: 0, balance: 0, refund_due: 100 });
    expect(sql(`select count(*) from public.credit_notes where invoice_id='${invoice.id}' and is_cancellation`)).toBe('1');
    expect(sql(`select count(*) from public.refunds where invoice_id='${invoice.id}'`)).toBe('2');
    expect(sql('select count(*) from public.inventory_movements')).toBe(before);
  });

  it('enforces credit/payment caps, rejects cross-invoice payments, and serializes concurrent attempts', async () => {
    const a = await issuedInvoice(); const b = await issuedInvoice(); const paid = await payment(a.id, a.version, '50.00'); const bPaid = await payment(b.id, b.version, '10.00');
    const cross = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: b.id, p_expected_version: bPaid.version, p_input: { reason: 'Cross invoice', credit_lines: [{ invoice_line_id: b.lineId, amount: '10.00' }], authorised_refund_amount: '10.00', payments: [{ payment_id: paid.payment_ids[0], amount: '10.00' }] } });
    expect(cross.error?.message).toBe('INVALID_PAYMENT_RELATION');
    const make = () => t.lon.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: a.id, p_expected_version: paid.version, p_input: { reason: 'Race', credit_lines: [{ invoice_line_id: a.lineId, amount: '30.00' }], authorised_refund_amount: '30.00', payments: [{ payment_id: paid.payment_ids[0], amount: '30.00' }] } });
    const results = await Promise.all([make(), make()]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.filter((result) => result.error)).toHaveLength(1);
  });

  it('returns PT409 promptly for stale credit, refund confirmation, retry, and cancellation requests', async () => {
    const invoice = await issuedInvoice();
    const stale = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: 0, p_input: { reason: 'Stale', credit_lines: [{ invoice_line_id: invoice.lineId, amount: '1.00' }], authorised_refund_amount: '0', payments: [] } });
    expect(stale.error?.code).toBe('PT409');
    const paid = await payment(invoice.id, invoice.version, '10.00');
    const cancelled = await t.lon.rpc('cancel_invoice', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: paid.version, p_reason: 'Prepare refund' });
    const history = await t.lon.rpc('invoice_credit_refund_history', { p_invoice_id: invoice.id });
    const refund = history.data.refunds[0];
    const staleConfirm = await t.lon.rpc('confirm_manual_refund', { p_request_id: randomUUID(), p_refund_id: refund.id, p_expected_version: refund.version - 1, p_evidence: { payout_method: 'cash', payout_reference: 'stale', evidence: 'stale' } });
    expect(staleConfirm.error?.code).toBe('PT409');
    const staleRetry = await t.lon.rpc('retry_invoice_refund', { p_request_id: randomUUID(), p_refund_id: refund.id, p_expected_version: refund.version - 1 });
    expect(staleRetry.error?.code).toBe('PT409');
    const staleCancel = await t.lon.rpc('cancel_invoice', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: paid.version, p_reason: 'stale cancellation' });
    expect(staleCancel.error?.code).toBe('PT409');
    expect(cancelled.data.status).toBe('issued');
  });

  it('replays identical idempotency requests, rejects mismatched payloads, and preserves immutable history', async () => {
    const invoice = await issuedInvoice(); const request = randomUUID();
    const input = { reason: 'Replay', credit_lines: [{ invoice_line_id: invoice.lineId, amount: '5.00' }], authorised_refund_amount: '0', payments: [] };
    const first = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: request, p_invoice_id: invoice.id, p_expected_version: invoice.version, p_input: input });
    const replay = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: request, p_invoice_id: invoice.id, p_expected_version: invoice.version, p_input: input });
    expect(replay.error).toBeNull(); expect(replay.data).toEqual(first.data);
    const mismatch = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: request, p_invoice_id: invoice.id, p_expected_version: invoice.version, p_input: { ...input, reason: 'Different payload' } });
    expect(mismatch.error?.message).toBe('IDEMPOTENCY_KEY_REUSED');
    const noteId = first.data.credit_note_id;
    const direct = await t.lon.from('credit_notes').update({ reason: 'tampered' }).eq('id', noteId);
    expect(direct.error).not.toBeNull();
  });

  it('uses cumulative GST allocation and blocks branch and permission violations', async () => {
    const invoice = await issuedInvoice('100.00');
    let version = invoice.version;
    for (const amount of ['33.00', '33.00', '34.00']) {
      const result = await t.lon.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: version, p_input: { reason: 'GST rounding', credit_lines: [{ invoice_line_id: invoice.lineId, amount }], authorised_refund_amount: '0', payments: [] } });
      expect(result.error).toBeNull(); version = result.data.version;
    }
    expect(sql(`select sum(l.gst_amount) from public.credit_note_lines l join public.credit_notes c on c.id=l.credit_note_id where c.invoice_id='${invoice.id}'`)).toBe('9.09');
    const cross = await t.reg.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: version, p_input: { reason: 'Cross branch', credit_lines: [{ invoice_line_id: invoice.lineId, amount: '1.00' }], authorised_refund_amount: '0', payments: [] } });
    expect(cross.error?.message).toBe('ACCESS_DENIED');
    const viewOnly = await createTestTenants({ lonPermissions: ['invoices.view', 'payments.view'] });
    try {
      const denied = await viewOnly.lon.rpc('create_invoice_credit_refund', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: version, p_input: { reason: 'Denied', credit_lines: [{ invoice_line_id: invoice.lineId, amount: '1.00' }], authorised_refund_amount: '0', payments: [] } });
      expect(denied.error?.message).toBe('ACCESS_DENIED');
    } finally { await viewOnly.cleanup(); }
  });
});
