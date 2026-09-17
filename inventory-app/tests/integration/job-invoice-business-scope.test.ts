import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

// A stock-consuming, business-affecting transaction: public.complete_job_and_create_invoice_with_brand
// completes a job (consuming inventory), creates an invoice, and assigns a
// business/brand identity in one call. The selected business must itself
// be authorized against the physical location via
// organization_location_assignments - a location permission alone
// (jobs.complete/inventory.stock_out/location access) must never implicitly
// authorize an arbitrary business identity. Both public.complete_job_and_create_invoice
// (unbranded) and its _with_brand sibling now resolve business identity via
// the same strict private.transaction_brand_guard used by the POS entry
// points (finalise_pos_sale/finalise_pos_sale_with_brand) - no
// location-code fallback remains reachable from either. The general,
// invoice-only private.invoice_brand_guard (used by manual invoice
// creation and create_invoice_from_job_with_brand, neither of which
// consumes stock) is untouched and keeps its legacy LON default.

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[job-invoice-business-scope] skipped: missing ${missing.join(', ')}`);

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

const PERMS = ['jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'invoices.view', 'invoices.create', 'invoices.issue', 'inventory.view', 'inventory.stock_in', 'inventory.stock_out'];

run('complete_job_and_create_invoice(_with_brand) business scope', () => {
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
    // LON is deliberately left with zero assignments throughout this suite.
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

  function zeroSideEffectAsserts(productId: string, locationId: string, jobId: string, before: number) {
    expect(onHand(productId, locationId)).toBe(before);
    expect(sql(`select status from public.jobs where id='${jobId}'`)).toBe('new');
    expect(Number(sql(`select count(*) from public.inventory_movements where source_type='job' and source_id='${jobId}'`))).toBe(0);
    expect(Number(sql(`select count(*) from public.invoices where job_id='${jobId}'`))).toBe(0);
    expect(Number(sql(`select count(*) from public.payments p join public.invoices i on i.id=p.invoice_id where i.job_id='${jobId}'`))).toBe(0);
  }

  it('1: REG + 247 succeeds, correctly branded, correct stock deduction', async () => {
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

  it('2: REG + awt succeeds against the same shared REG inventory pool', async () => {
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
    // 13: one shared physical balance row, decremented by both brands cumulatively.
    const balanceRows = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.regLocationId);
    expect(balanceRows.data).toHaveLength(1);
    expect(balanceRows.data![0]!.on_hand).toBe(2);
  });

  it('3: REG + arbitrary/unauthorized brand is denied, zero stock change, job stays uncompleted', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const { jobId, version } = await createJob(t.reg, t.regLocationId, productId, 2);
    const result = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: 'xyz',
    });
    expect(result.error?.message).toContain('ACCESS_DENIED');
    zeroSideEffectAsserts(productId, t.regLocationId, jobId, 5);
  });

  it('4: REG with no brand supplied cannot silently choose a business', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const { jobId, version } = await createJob(t.reg, t.regLocationId, productId, 2);
    const result = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: null,
    });
    expect(result.error?.message).toContain('BUSINESS_SELECTION_REQUIRED');
    zeroSideEffectAsserts(productId, t.regLocationId, jobId, 5);
    // The unbranded entry point has the exact same exposure: no p_brand
    // parameter exists on it at all, so it can only ever auto-derive at an
    // unambiguous single-organization location - REG (2 orgs) always fails.
    const unbranded = await t.reg.rpc('complete_job_and_create_invoice', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version,
    });
    expect(unbranded.error?.message).toContain('BUSINESS_SELECTION_REQUIRED');
    zeroSideEffectAsserts(productId, t.regLocationId, jobId, 5);
  });

  it('5: LON + 247 (zero org assignments) is denied BUSINESS_NOT_CONFIGURED', async () => {
    const productId = await productWithStock(t.lon, t.lonLocationId, 5);
    const { jobId, version } = await createJob(t.lon, t.lonLocationId, productId, 2);
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: '247',
    });
    expect(result.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
    zeroSideEffectAsserts(productId, t.lonLocationId, jobId, 5);
    const assignments = await t.service.from('organization_location_assignments').select('organization_id').eq('location_id', t.lonLocationId).eq('active', true);
    expect(assignments.data).toHaveLength(0);
  });

  it('6: LON + awt (the former legacy default) is now ALSO denied BUSINESS_NOT_CONFIGURED - the exact gap this hardening closes', async () => {
    const productId = await productWithStock(t.lon, t.lonLocationId, 5);
    const { jobId, version } = await createJob(t.lon, t.lonLocationId, productId, 2);
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: 'awt',
    });
    expect(result.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
    zeroSideEffectAsserts(productId, t.lonLocationId, jobId, 5);
    const assignments = await t.service.from('organization_location_assignments').select('organization_id').eq('location_id', t.lonLocationId).eq('active', true);
    expect(assignments.data).toHaveLength(0);
    // The unbranded sibling has the identical exposure and is denied the
    // same way - no location-code fallback remains reachable from either
    // stock-consuming entry point.
    const unbranded = await t.lon.rpc('complete_job_and_create_invoice', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version,
    });
    expect(unbranded.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
    zeroSideEffectAsserts(productId, t.lonLocationId, jobId, 5);
  });

  it('7: LON with no brand supplied is also denied BUSINESS_NOT_CONFIGURED', async () => {
    const productId = await productWithStock(t.lon, t.lonLocationId, 5);
    const { jobId, version } = await createJob(t.lon, t.lonLocationId, productId, 2);
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: version, p_brand: null,
    });
    expect(result.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
    zeroSideEffectAsserts(productId, t.lonLocationId, jobId, 5);
  });

  it('8: an actor unauthorized at REG is denied even naming a legitimate REG-authorized 247 brand - denial is location scope, not the brand guard', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const jobAtReg = await createJob(t.reg, t.regLocationId, productId, 1);
    // t.lon's manager is only authorized at LON.
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobAtReg.jobId, p_expected_version: jobAtReg.version, p_brand: '247',
    });
    expect(result.error?.message).toContain('ACCESS_DENIED');
    zeroSideEffectAsserts(productId, t.regLocationId, jobAtReg.jobId, 5);
    // Discriminator: '247' IS authorized at REG (proven by test 1). If this
    // denial came from transaction_brand_guard rejecting the brand itself,
    // the SAME job+brand called by a REG-authorized actor would also fail.
    // It does not - stock/location authorization (private.finance_guard,
    // scoped by app_user_location_id) is the check that fired here,
    // independently of the (already-passing) business guard.
    const authorized = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobAtReg.jobId, p_expected_version: jobAtReg.version, p_brand: '247',
    });
    expect(authorized.error, JSON.stringify(authorized.error)).toBeNull();
  });

  it('9: an actor unauthorized at REG is denied even naming a legitimate REG-authorized awt brand - denial is location scope, not the brand guard', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const jobAtReg = await createJob(t.reg, t.regLocationId, productId, 1);
    const result = await t.lon.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobAtReg.jobId, p_expected_version: jobAtReg.version, p_brand: 'awt',
    });
    expect(result.error?.message).toContain('ACCESS_DENIED');
    zeroSideEffectAsserts(productId, t.regLocationId, jobAtReg.jobId, 5);
    const authorized = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: jobAtReg.jobId, p_expected_version: jobAtReg.version, p_brand: 'awt',
    });
    expect(authorized.error, JSON.stringify(authorized.error)).toBeNull();
  });

  it('10: business authorization occurs before the finance idempotency write - a rejected brand never durably locks the request_id, so a corrected retry with the same request_id succeeds', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const { jobId, version } = await createJob(t.reg, t.regLocationId, productId, 1);
    const requestId = randomUUID();
    const rejected = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: requestId, p_job_id: jobId, p_expected_version: version, p_brand: 'xyz',
    });
    expect(rejected.error?.message).toContain('ACCESS_DENIED');
    zeroSideEffectAsserts(productId, t.regLocationId, jobId, 5);
    const retried = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: requestId, p_job_id: jobId, p_expected_version: version, p_brand: '247',
    });
    expect(retried.error, JSON.stringify(retried.error)).toBeNull();
    expect(retried.data.brand).toBe('247');
  });

  it('11: complete_job_and_create_invoice and its _with_brand sibling no longer delegate, but remain safe under the same request_id via the finance_action_requests primary key', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 5);
    const { jobId, version } = await createJob(t.reg, t.regLocationId, productId, 1);
    const requestId = randomUUID();
    const [unbranded, branded] = await Promise.allSettled([
      t.reg.rpc('complete_job_and_create_invoice', { p_request_id: requestId, p_job_id: jobId, p_expected_version: version }),
      t.reg.rpc('complete_job_and_create_invoice_with_brand', { p_request_id: requestId, p_job_id: jobId, p_expected_version: version, p_brand: '247' }),
    ]);
    const results = [unbranded, branded].map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason }));
    const ok = results.filter((r) => !r.error);
    // Exactly one entry point may durably complete this job: the shared
    // request_id primary key on finance_action_requests prevents both
    // differently-named actions from separately consuming stock for the
    // same request, even though neither function delegates to the other.
    expect(ok).toHaveLength(1);
    expect(Number(sql(`select count(*) from public.inventory_movements where source_type='job' and source_id='${jobId}'`))).toBe(1);
    expect(Number(sql(`select count(*) from public.invoices where job_id='${jobId}'`))).toBe(1);
  });

  it('14/15: invoice brand is correct for both 247TRUCK and AWT sales of the same catalogue product', async () => {
    const productId = await productWithStock(t.reg, t.regLocationId, 6);
    const truckJob = await createJob(t.reg, t.regLocationId, productId, 1);
    const truckResult = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: truckJob.jobId, p_expected_version: truckJob.version, p_brand: '247',
    });
    expect(truckResult.error).toBeNull();
    expect(sql(`select brand from public.invoices where id='${truckResult.data.invoice_id}'`)).toBe('247');
    const awtJob = await createJob(t.reg, t.regLocationId, productId, 1);
    const awtResult = await t.reg.rpc('complete_job_and_create_invoice_with_brand', {
      p_request_id: randomUUID(), p_job_id: awtJob.jobId, p_expected_version: awtJob.version, p_brand: 'awt',
    });
    expect(awtResult.error).toBeNull();
    expect(sql(`select brand from public.invoices where id='${awtResult.data.invoice_id}'`)).toBe('awt');
  });
});
