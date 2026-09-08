import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[finance-payments] skipped: missing ${missing.join(', ')}`);

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') {
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  }
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: query, encoding: 'utf8' },
  ).trim();
}

const INVOICE_PERMS = ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue'];
const PAYMENT_PERMS = [...INVOICE_PERMS, 'payments.view', 'payments.record', 'payments.reverse', 'receivables.view'];

run('Phase 4C manual payments and receivables', () => {
  let t: TestTenants;
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PAYMENT_PERMS, regPermissions: PAYMENT_PERMS });
    sql(`
      insert into public.finance_settings(singleton,business_name,abn,address,phone,shared_email,version,updated_by)
      values(true,'24/7 Truck Tyre Services','12345678901','{"street_address":"1 Test Rd","suburb":"Adelaide","state":"SA","postcode":"5000"}','0880000000','accounts@example.test',1,'${t.adminUser.id}')
      on conflict(singleton) do update set business_name=excluded.business_name,abn=excluded.abn,address=excluded.address,phone=excluded.phone,shared_email=excluded.shared_email;
      insert into public.finance_location_settings(location_id,branch_name,address,phone,contact_email,version,updated_by)
      values('${t.lonLocationId}','Lonsdale','{"street_address":"2 Test Rd","suburb":"Lonsdale","state":"SA","postcode":"5160"}','0881111111','lon@example.test',1,'${t.adminUser.id}'),
            ('${t.regLocationId}','Regency Park','{"street_address":"3 Test Rd","suburb":"Regency Park","state":"SA","postcode":"5010"}','0882222222','reg@example.test',1,'${t.adminUser.id}')
      on conflict(location_id) do update set branch_name=excluded.branch_name,address=excluded.address,phone=excluded.phone,contact_email=excluded.contact_email;
    `);
  });

  afterAll(async () => {
    if (!t) return;
    sql('delete from public.finance_location_settings; delete from public.finance_settings;');
    await t.cleanup();
  });

  async function issuedInvoice(amount = '110.00') {
    const made = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Workshop service', quantity: '1', unit_price_incl_gst: amount }] },
    });
    expect(made.error, JSON.stringify(made.error)).toBeNull();
    invoiceIds.push(made.data.invoice_id);
    const issued = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: made.data.invoice_id, p_expected_version: 1 });
    expect(issued.error, JSON.stringify(issued.error)).toBeNull();
    return { id: made.data.invoice_id as string, version: issued.data.version as number };
  }

  it('records ordered split tenders atomically, once, with one invoice version increment and zero inventory delta', async () => {
    const invoice = await issuedInvoice();
    const before = sql('select count(*) from public.inventory_movements');
    const request = randomUUID();
    const args = { p_request_id: request, p_invoice_id: invoice.id, p_expected_version: invoice.version,
      p_tenders: [{ method: 'cash', amount: '40.00', notes: 'front desk' }, { method: 'eftpos', amount: '70.00', reference: 'terminal-123' }] };
    const first = await t.lon.rpc('record_invoice_payment', args);
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    expect(first.data).toMatchObject({ invoice_id: invoice.id, version: invoice.version + 1, payment_state: 'paid', balance: 0 });
    expect(first.data.payment_ids).toHaveLength(2);
    const replay = await t.lon.rpc('record_invoice_payment', args);
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(first.data);
    expect(sql(`select count(*) from public.payments where invoice_id='${invoice.id}'`)).toBe('2');
    expect(sql(`select first_payment_at is not null from public.invoices where id='${invoice.id}'`)).toBe('t');
    expect(sql('select count(*) from public.inventory_movements')).toBe(before);
  });

  it.each([
    [[{ method: 'cash', amount: '0' }], 'INVALID_PAYMENT_AMOUNT'],
    [[{ method: 'cash', amount: '-1' }], 'INVALID_PAYMENT_AMOUNT'],
    [[{ method: 'cash', amount: '1.001' }], 'INVALID_PAYMENT_AMOUNT'],
    [[{ method: 'stripe', amount: '1.00' }], 'INVALID_PAYMENT_METHOD'],
    [[], 'PAYMENT_TENDERS_REQUIRED'],
  ])('rejects invalid tender input atomically: %s', async (tenders, error) => {
    const invoice = await issuedInvoice();
    const res = await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: invoice.version, p_tenders: tenders });
    expect(res.error?.message).toBe(error);
    expect(sql(`select count(*) from public.payments where invoice_id='${invoice.id}'`)).toBe('0');
  });

  it('serializes competing payments so the invoice cannot be overpaid', async () => {
    const invoice = await issuedInvoice('100.00');
    const make = () => t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: invoice.version, p_tenders: [{ method: 'cash', amount: '60.00' }] });
    const results = await Promise.all([make(), make()]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error)).toHaveLength(1);
    expect(sql(`select coalesce(sum(amount),0) from public.payments where invoice_id='${invoice.id}'`)).toBe('60.00');
  });

  it('fully reverses manual payment once, replays safely, and permanently preserves the revision lock', async () => {
    const invoice = await issuedInvoice();
    const paid = await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: invoice.version, p_tenders: [{ method: 'bank_transfer', amount: '110.00', reference: 'deposit-shared' }] });
    const request = randomUUID();
    const args = { p_request_id: request, p_invoice_id: invoice.id, p_payment_id: paid.data.payment_ids[0], p_expected_version: paid.data.version, p_reason: 'Entered against wrong invoice' };
    const reversed = await t.lon.rpc('reverse_manual_payment', args);
    expect(reversed.error, JSON.stringify(reversed.error)).toBeNull();
    expect(reversed.data).toMatchObject({ balance: 110, payment_state: 'unpaid', version: paid.data.version + 1 });
    expect((await t.lon.rpc('reverse_manual_payment', args)).data).toEqual(reversed.data);
    const again = await t.lon.rpc('reverse_manual_payment', { ...args, p_request_id: randomUUID(), p_expected_version: reversed.data.version });
    expect(again.error?.message).toBe('PAYMENT_ALREADY_REVERSED');
    const revise = await t.lon.rpc('revise_unpaid_invoice', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: reversed.data.version, p_input: { revision_reason: 'Should stay locked' } });
    expect(revise.error?.message).toBe('INVOICE_FINANCIAL_LOCKED');
  });

  it('keeps repeated manual bank references as warning-only', async () => {
    const a = await issuedInvoice(); const b = await issuedInvoice();
    const one = await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: a.id, p_expected_version: a.version, p_tenders: [{ method: 'bank_transfer', amount: '10.00', reference: 'same-deposit' }] });
    const two = await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: b.id, p_expected_version: b.version, p_tenders: [{ method: 'bank_transfer', amount: '10.00', reference: 'same-deposit' }] });
    expect(one.error).toBeNull(); expect(two.error).toBeNull();
    expect(two.data.warnings).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_PAYMENT_REFERENCE' }));
  });

  it('enforces branch, mutation permission and payment-history isolation', async () => {
    const invoice = await issuedInvoice();
    const cross = await t.reg.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: invoice.version, p_tenders: [{ method: 'cash', amount: '1.00' }] });
    expect(cross.error?.message).toBe('ACCESS_DENIED');
    const viewOnly = await createTestTenants({ lonPermissions: INVOICE_PERMS });
    try {
      const denied = await viewOnly.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: invoice.version, p_tenders: [{ method: 'cash', amount: '1.00' }] });
      expect(denied.error?.message).toBe('ACCESS_DENIED');
      const detail = await viewOnly.lon.rpc('invoice_detail', { p_invoice_id: invoice.id });
      expect(detail.error).toBeNull();
      expect(detail.data.payments).toEqual([]);
      expect(detail.data.documents).toEqual([]);
      const ar = await viewOnly.lon.rpc('receivables_summary', { p_location_id: t.lonLocationId });
      expect(ar.error?.message).toBe('ACCESS_DENIED');
    } finally { await viewOnly.cleanup(); }
  });

  it('returns derived invoice and bounded receivable projections without cost data', async () => {
    const invoice = await issuedInvoice();
    await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoice.id, p_expected_version: invoice.version, p_tenders: [{ method: 'cash', amount: '25.00' }] });
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: invoice.id });
    expect(detail.error).toBeNull();
    expect(detail.data.financials).toMatchObject({ total: 110, gross_paid: 25, reversed: 0, effective_paid: 25, balance: 85, payment_state: 'partial' });
    expect(JSON.stringify(detail.data)).not.toContain('captured_unit_cost');
    const summary = await t.lon.rpc('receivables_summary', { p_location_id: t.lonLocationId, p_as_of: null });
    expect(summary.error).toBeNull();
    expect(Number(summary.data.balance)).toBeGreaterThanOrEqual(85);
    const rows = await t.lon.rpc('customer_receivables', { p_location_id: t.lonLocationId, p_customer_id: null, p_state: 'partial', p_search: null, p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 50 });
    expect(rows.error).toBeNull();
    expect(rows.data.some((row: { invoice_id: string }) => row.invoice_id === invoice.id)).toBe(true);
    const badLimit = await t.lon.rpc('customer_receivables', { p_location_id: null, p_customer_id: null, p_state: null, p_search: null, p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 101 });
    expect(badLimit.error?.message).toBe('INVALID_LIMIT');
  });
});
