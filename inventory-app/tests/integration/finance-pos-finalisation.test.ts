import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[finance-pos-finalisation] skipped: missing ${missing.join(', ')}`);

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

const PERMS = ['jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'pos.use', 'inventory.view', 'inventory.stock_in', 'inventory.stock_out', 'invoices.view', 'invoices.create', 'invoices.issue', 'payments.view', 'payments.record'];

run('Phase 4C atomic POS finalisation', () => {
  let t: TestTenants; let productId: string; let businessId: string;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS, regPermissions: PERMS });
    const settings = await t.admin.rpc('finance_settings_detail');
    await t.admin.rpc('update_finance_settings', { p_request_id: randomUUID(), p_expected_version: settings.data.global.version, p_location_id: null, p_settings: { business_name: '24/7 Truck Tyre Services', abn: '12345678901', phone: '0880000000', shared_email: 'accounts@example.test', address: { street_address: '1 Head Office Rd', suburb: 'Adelaide', state: 'SA', postcode: '5000', country: 'AU' }, bank_instructions: null, logo_asset_path: null, logo_sha256: null, invoice_footer: 'Thank you' } });
    const version = settings.data.locations.find((l: { location_id: string; version: number }) => l.location_id === t.lonLocationId)?.version ?? 0;
    await t.admin.rpc('update_finance_settings', { p_request_id: randomUUID(), p_expected_version: version, p_location_id: t.lonLocationId, p_settings: { branch_name: 'Lonsdale', phone: '0881111111', contact_email: 'branch@example.test', address: { street_address: '2 Branch Rd', suburb: 'Lonsdale', state: 'SA', postcode: '5160', country: 'AU' }, document_footer: null } });
    const customer = await t.admin.rpc('create_customer', { p_request_id: randomUUID(), p_customer: { customer_type: 'business', display_name: 'POS Fleet', company_name: 'POS Fleet', abn: '51824753556', mobile: '0400000099', payment_terms: '14_days', street_address: '4 Fleet St', suburb: 'Lonsdale', state: 'SA', postcode: '5160' } });
    expect(customer.error).toBeNull(); businessId = customer.data.customer_id;
    const product = await t.admin.rpc('create_product', { p_name: `POS Atomic ${randomUUID()}`, p_category_code: 'truck_tyre', p_selling_price_incl_gst: 220, p_tyre_condition: 'new', p_tyre_brand: 'POS', p_tyre_size: '11R22.5' });
    expect(product.error).toBeNull(); productId = product.data;
    const stock = await t.admin.rpc('post_inventory_movement', { p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId, p_quantity_delta: 8, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100 });
    expect(stock.error).toBeNull();
  });

  afterAll(async () => {
    if (!t) return;
    sql('delete from public.finance_location_settings; delete from public.finance_settings;');
    await t.cleanup();
  });

  const args = (requestId: string, extra: Record<string, unknown> = {}) => ({ p_request_id: requestId, p_location_id: t.lonLocationId, p_customer_id: null, p_customer_vehicle_id: null, p_job_id: null, p_expected_job_version: null, p_job: { source_type: 'pos', walk_in_label: 'Counter customer' }, p_lines: [{ line_type: 'product', product_id: productId, description: 'POS tyre', quantity: 1 }], p_tenders: [{ method: 'cash', amount: '220.00', reference: null, notes: null }], ...extra });

  it('is absent on the exact Phase 4B baseline', async () => {
    const res = await t.lon.rpc('finalise_pos_sale', args(randomUUID()));
    expect(res.error, 'Phase 4C migration must provide finalise_pos_sale').toBeNull();
  });

  it('creates, completes, invoices, issues and settles once under exact replay', async () => {
    const requestId = randomUUID(); const before = Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}'`));
    const first = await t.lon.rpc('finalise_pos_sale', args(requestId));
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    const replay = await t.lon.rpc('finalise_pos_sale', args(requestId));
    expect(replay.error).toBeNull(); expect(replay.data).toEqual(first.data);
    expect(Number(sql(`select count(*) from public.inventory_movements where source_type='job' and source_id='${first.data.job_id}'`))).toBe(1);
    expect(Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}'`))).toBe(before - 1);
    expect(Number(sql(`select count(*) from public.payments where invoice_id='${first.data.invoice_id}'`))).toBe(1);
    expect(sql(`select status||':'||version from public.jobs where id='${first.data.job_id}'`)).toBe('completed:2');
    expect(sql(`select status from public.invoices where id='${first.data.invoice_id}'`)).toBe('issued');
  });

  it('updates an existing draft POS and supports a business account balance', async () => {
    const created = await t.lon.rpc('create_job', { p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: businessId, p_customer_vehicle_id: null, p_job: { source_type: 'pos' }, p_lines: [{ line_type: 'labour', description: 'Initial', quantity: 1, unit_price_incl_gst: 10 }] });
    expect(created.error).toBeNull();
    const res = await t.lon.rpc('finalise_pos_sale', args(randomUUID(), { p_customer_id: businessId, p_job_id: created.data.job_id, p_expected_job_version: 1, p_job: { source_type: 'pos' }, p_lines: [{ line_type: 'labour', description: 'Account service', quantity: 1, unit_price_incl_gst: 88 }], p_tenders: [] }));
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    expect(res.data.total_incl_gst).toBe(88);
    expect(res.data.payment.balance).toBe(88);
    expect(sql(`select payment_terms from public.invoice_revisions where invoice_id='${res.data.invoice_id}'`)).toBe('14_days');
    expect(Number(sql(`select count(*) from public.payments where invoice_id='${res.data.invoice_id}'`))).toBe(0);
  });

  it('allows a zero-total walk-in with no tender and rolls back a downstream tender failure', async () => {
    const zero = await t.lon.rpc('finalise_pos_sale', args(randomUUID(), { p_lines: [{ line_type: 'labour', description: 'Courtesy check', quantity: 1, unit_price_incl_gst: 0 }], p_tenders: [] }));
    expect(zero.error, JSON.stringify(zero.error)).toBeNull(); expect(zero.data.total_incl_gst).toBe(0);
    const beforeJobs = Number(sql("select count(*) from public.jobs where source_type='pos'"));
    const beforeMoves = Number(sql('select count(*) from public.inventory_movements'));
    const failed = await t.lon.rpc('finalise_pos_sale', args(randomUUID(), { p_tenders: [{ method: 'cash', amount: '219.00' }] }));
    expect(failed.error?.message).toMatch(/FULL_SETTLEMENT|TENDER|balance/i);
    expect(Number(sql("select count(*) from public.jobs where source_type='pos'"))).toBe(beforeJobs);
    expect(Number(sql('select count(*) from public.inventory_movements'))).toBe(beforeMoves);
  });
});
