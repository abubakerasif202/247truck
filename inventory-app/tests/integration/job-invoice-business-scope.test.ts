import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

// Focused review: does public.complete_job_and_create_invoice_with_brand -
// which completes a job (consuming inventory) AND assigns an invoice brand
// in one call - let a legacy invoice-brand fallback act as authorization to
// consume stock on behalf of a business at a location with zero organization
// assignments? Traced and proven here, not assumed: job completion
// (public.complete_job) is authorized purely by
// private.sales_permission('jobs.complete') + private.sales_location_allowed
// (location-scoped, permission-scoped - no organization concept at all,
// predates the whole organization feature). Brand resolution
// (private.invoice_brand_guard) runs BEFORE complete_job in this wrapper and
// can only ever narrow what happens next (reject before job completion) -
// it never grants or is a precondition organizations gate; a caller who is
// authorized to complete a job at a location was already authorized to
// consume that location's stock via a mechanism wholly independent of brand
// or organization.

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[job-invoice-business-scope] skipped: missing ${missing.join(', ')}`);

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

const PERMS = ['jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'invoices.view', 'invoices.create', 'invoices.issue', 'inventory.view', 'inventory.stock_in', 'inventory.stock_out'];

run('complete_job_and_create_invoice_with_brand business scope', () => {
  let t: TestTenants;
  let truckOrganizationId: string;
  let awtOrganizationId: string;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS, regPermissions: PERMS });

    const { data: organizations, error } = await t.service
      .from('organizations').select('id, code').in('code', ['AWT', '247TRUCK']);
    if (error || !organizations || organizations.length !== 2) throw error ?? new Error('organizations missing');
    truckOrganizationId = organizations.find((o) => o.code === '247TRUCK')!.id;
    awtOrganizationId = organizations.find((o) => o.code === 'AWT')!.id;

    // REG is the shared location: both businesses actively authorized.
    // LON is deliberately left with zero assignments.
    const truckAssignment = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: truckOrganizationId, p_location_id: t.regLocationId, p_active: true,
    });
    if (truckAssignment.error) throw truckAssignment.error;
    const awtAssignment = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: awtOrganizationId, p_location_id: t.regLocationId, p_active: true,
    });
    if (awtAssignment.error) throw awtAssignment.error;

    const settings = await t.admin.rpc('finance_settings_detail');
    await t.admin.rpc('update_finance_settings', {
      p_request_id: randomUUID(), p_expected_version: settings.data.global.version, p_location_id: null,
      p_settings: {
        business_name: '24/7 Truck Tyre Services', abn: '12345678901', phone: '0880000000',
        shared_email: 'accounts@example.test',
        address: { street_address: '1 Head Office Rd', suburb: 'Adelaide', state: 'SA', postcode: '5000', country: 'AU' },
        bank_instructions: null, logo_asset_path: null, logo_sha256: null, invoice_footer: 'Thank you',
      },
    });
    const awtBrandOptions = await t.admin.rpc('invoice_brand_options', { p_location_id: t.regLocationId });
    const awtVersion = (awtBrandOptions.data?.brands ?? []).find((b: { brand: string; version: number }) => b.brand === 'awt')?.version ?? 1;
    await t.admin.rpc('update_invoice_brand_settings', {
      p_brand: 'awt', p_expected_version: awtVersion,
      p_settings: {
        business_name: 'Adelaide Wholesale Tyres', abn: '98765432109', phone: '0882222222',
        email: 'accounts@awt.example.test', address: { street_address: '6 Birralee Rd', suburb: 'Regency Park', state: 'SA', postcode: '5010', country: 'AU' },
        website: null, logo_asset_path: null, logo_sha256: null, primary_colour: '#1f4b7a', accent_colour: '#173653',
        bank_instructions: null, invoice_footer: 'Thank you', email_sender_name: 'AWT Tyres', reply_to_address: 'accounts@awt.example.test',
      },
    });
    const regVersion = settings.data.locations.find((l: { location_id: string; version: number }) => l.location_id === t.regLocationId)?.version ?? 0;
    await t.admin.rpc('update_finance_settings', {
      p_request_id: randomUUID(), p_expected_version: regVersion, p_location_id: t.regLocationId,
      p_settings: { branch_name: 'Regency Park', phone: '0881111111', contact_email: 'branch@example.test', address: { street_address: '6 Birralee Rd', suburb: 'Regency Park', state: 'SA', postcode: '5010', country: 'AU' }, document_footer: null },
    });
    const lonVersion = settings.data.locations.find((l: { location_id: string; version: number }) => l.location_id === t.lonLocationId)?.version ?? 0;
    await t.admin.rpc('update_finance_settings', {
      p_request_id: randomUUID(), p_expected_version: lonVersion, p_location_id: t.lonLocationId,
      p_settings: { branch_name: 'Lonsdale', phone: '0881111112', contact_email: 'lon-branch@example.test', address: { street_address: '2 Branch Rd', suburb: 'Lonsdale', state: 'SA', postcode: '5160', country: 'AU' }, document_footer: null },
    });

    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: {
        customer_type: 'business', display_name: `Job invoice scope ${randomUUID()}`, company_name: 'Job Invoice Scope',
        abn: '51824753556', mobile: '0400000042', payment_terms: '14_days',
        street_address: '5 Test Street', suburb: 'Lonsdale', state: 'SA', postcode: '5160',
      },
    });
    if (customer.error) throw customer.error;
    customerId = customer.data.customer_id;
  });

  afterAll(async () => {
    if (!t) return;
    sql('delete from public.finance_location_settings; delete from public.finance_settings;');
    sql(`update public.invoice_brand_settings set business_name='AWT Tyres', abn=null, address=null, phone=null,
      email=null, website=null, logo_asset_path=null, logo_sha256=null, primary_colour='#1f4b7a',
      accent_colour='#173653', bank_instructions=null, invoice_footer=null, email_sender_name='AWT Tyres',
      reply_to_address=null, updated_by=null, version=1 where brand='awt';`);
    await t.cleanup();
  });

  async function productWithStock(client: typeof t.reg, locationId: string, quantity: number) {
    const product = await t.admin.rpc('create_product', {
      p_name: `Job invoice scope ${randomUUID()}`, p_category_code: 'truck_tyre', p_selling_price_incl_gst: 220,
      p_tyre_condition: 'new', p_tyre_brand: 'JIB', p_tyre_size: '11R22.5',
    });
    if (product.error) throw product.error;
    const stock = await client.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: product.data, p_location_id: locationId,
      p_quantity_delta: quantity, p_movement_type: 'quick_stock_in', p_reason: null,
      p_inbound_unit_cost: 50, p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null,
    });
    if (stock.error) throw stock.error;
    return String(product.data);
  }

  async function createJob(client: typeof t.reg, locationId: string, productId: string, quantity: number) {
    const job = await client.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: locationId,
      p_customer_id: customerId, p_customer_vehicle_id: null,
      p_job: { source_type: 'direct' },
      p_lines: [{ line_type: 'product', product_id: productId, description: 'Job invoice scope line', quantity }],
    });
    if (job.error) throw job.error;
    return { jobId: job.data.job_id as string, version: job.data.version as number };
  }

  function onHand(productId: string, locationId: string) {
    return Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${locationId}'`));
  }

  it('A: REG + 247 succeeds, correctly branded, correct stock deduction', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const { jobId, version } = await createJob(t.reg, t.regLocationId, productId, 2);
    const result = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: '247',
    });
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    expect(result.data.brand).toBe('247');
    expect(sql(`select brand from public.invoices where id='${result.data.invoice_id}'`)).toBe('247');
    expect(onHand(productId, t.regLocationId)).toBe(3);
  });

  it('B: REG + awt succeeds against the same shared REG inventory pool', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const truckJob = await createJob(t.reg, t.regLocationId, productId, 2);
    const truckResult = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: truckJob.jobId, p_expected_version: truckJob.version, p_brand: '247',
    });
    expect(truckResult.error).toBeNull();
    const awtJob = await createJob(t.reg, t.regLocationId, productId, 1);
    const awtResult = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: awtJob.jobId, p_expected_version: awtJob.version, p_brand: 'awt',
    });
    expect(awtResult.error, JSON.stringify(awtResult.error)).toBeNull();
    expect(awtResult.data.brand).toBe('awt');
    expect(sql(`select brand from public.invoices where id='${awtResult.data.invoice_id}'`)).toBe('awt');
    // One shared physical balance row, decremented by both jobs cumulatively.
    const balanceRows = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.regLocationId);
    expect(balanceRows.data).toHaveLength(1);
    expect(balanceRows.data![0]!.on_hand).toBe(2);
  });

  it('C: REG + arbitrary/unauthorized brand is denied, zero stock change, job stays uncompleted', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const { jobId, version } = await createJob(t.reg, t.regLocationId, productId, 2);
    const result = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: 'xyz',
    });
    // REG has organizations assigned, so an unrecognised brand fails the
    // "is this brand among REG's authorized organizations" check first
    // (ACCESS_DENIED), the same error shape private.pos_brand_guard uses
    // for the identical case.
    expect(result.error?.message).toContain('ACCESS_DENIED');
    expect(onHand(productId, t.regLocationId)).toBe(5);
    expect(sql(`select status from public.jobs where id='${jobId}'`)).not.toBe('completed');
    expect(Number(sql(`select count(*) from public.invoices where job_id='${jobId}'`))).toBe(0);
  });

  it('D: LON + 247 (zero org assignments, non-admin actor) does not gain authorization from the legacy fallback', async () => {
    const productId = await productWithStock(t.lon, t.lonLocationId, 5);
    const { jobId, version } = await createJob(t.lon, t.lonLocationId, productId, 2);
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: '247',
    });
    expect(result.error?.message).toContain('ACCESS_DENIED');
    expect(onHand(productId, t.lonLocationId)).toBe(5);
    expect(sql(`select status from public.jobs where id='${jobId}'`)).not.toBe('completed');
    expect(Number(sql(`select count(*) from public.invoices where job_id='${jobId}'`))).toBe(0);
    const assignments = await t.service.from('organization_location_assignments').select('organization_id').eq('location_id', t.lonLocationId);
    expect(assignments.data).toHaveLength(0);
  });

  it('E: LON + awt (LON\'s own pre-existing legacy default, unrelated to any organization) succeeds via location+permission authorization only', async () => {
    const productId = await productWithStock(t.lon, t.lonLocationId, 5);
    const { jobId, version } = await createJob(t.lon, t.lonLocationId, productId, 2);
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: 'awt',
    });
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    expect(result.data.brand).toBe('awt');
    expect(onHand(productId, t.lonLocationId)).toBe(3);
    // LON still has zero organization assignments: this success came from
    // jobs.complete + location authorization, never from an organization
    // grant that does not exist.
    const assignments = await t.service.from('organization_location_assignments').select('organization_id').eq('location_id', t.lonLocationId);
    expect(assignments.data).toHaveLength(0);
  });

  it('F: an actor unauthorized at REG is denied even naming a legitimate REG-authorized brand', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    // t.lon's manager is only authorized at LON.
    const jobAtReg = await t.reg.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.regLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: null,
      p_job: { source_type: 'direct' },
      p_lines: [{ line_type: 'product', product_id: productId, description: 'F line', quantity: 1 }],
    });
    expect(jobAtReg.error).toBeNull();
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobAtReg.data.job_id, p_expected_version: jobAtReg.data.version, p_brand: '247',
    });
    expect(result.error?.message).toContain('ACCESS_DENIED');
    expect(onHand(productId, t.regLocationId)).toBe(5);
  });
});
