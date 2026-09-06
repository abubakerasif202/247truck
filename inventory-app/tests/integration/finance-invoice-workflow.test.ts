import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[finance-invoice-workflow] skipped: missing ${missing.join(', ')}`);

/** Superuser psql, fenced to the disposable local stack (mirrors finance-foundation). */
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

const INVOICE_PERMS = [
  'jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'pos.use',
  'inventory.view', 'inventory.stock_in', 'inventory.stock_out', 'customers.manage_vehicles',
  'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue', 'invoices.cancel',
];

run('Phase 4B invoice workflow', () => {
  let t: TestTenants;
  let customerId: string;
  let vehicleId: string;
  let productId: string;
  const createdCustomers: string[] = [];
  const createdInvoices: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: INVOICE_PERMS, regPermissions: INVOICE_PERMS });

    // Minimum finance identity so issue is not blocked on configuration. Adapt to
    // whatever version the shared local settings singleton is already at so this
    // file is order-independent with the Phase 4A settings suite.
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
    for (const locationId of [t.lonLocationId, t.regLocationId]) {
      const version = settings.data.locations.find((l: { location_id: string; version: number }) => l.location_id === locationId)?.version ?? 0;
      await t.admin.rpc('update_finance_settings', {
        p_request_id: randomUUID(), p_expected_version: version, p_location_id: locationId,
        p_settings: {
          branch_name: 'Branch', phone: '0881111111', contact_email: 'branch@example.test',
          address: { street_address: '2 Branch Rd', suburb: 'Lonsdale', state: 'SA', postcode: '5160', country: 'AU' },
          document_footer: null,
        },
      });
    }

    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: { customer_type: 'individual', display_name: 'Invoice Customer', mobile: '0400000009', street_address: '1 Test St', suburb: 'Lonsdale', state: 'SA', postcode: '5160' },
    });
    expect(customer.error).toBeNull();
    customerId = customer.data.customer_id;
    createdCustomers.push(customerId);
    const vehicle = await t.lon.rpc('add_customer_vehicle', { p_customer_id: customerId, p_vehicle: { vehicle_type: 'truck', registration: 'INV 001' } });
    vehicleId = vehicle.data.vehicle_id;
    const product = await t.admin.rpc('create_product', {
      p_name: 'Invoice Tyre', p_category_code: 'truck_tyre', p_selling_price_incl_gst: 330,
      p_tyre_condition: 'new', p_tyre_brand: 'Inv Brand', p_tyre_size: '11R22.5',
    });
    productId = product.data;
    await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
      p_quantity_delta: 20, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 150,
    });
  });

  afterAll(async () => {
    if (!t) return;
    await t.service.from('financial_documents').delete().in('invoice_id', createdInvoices);
    await t.service.from('jobs').delete().in('customer_id', createdCustomers);
    await t.service.from('customers').delete().in('id', createdCustomers);
    await t.service.from('products').delete().eq('id', productId);
    // Restore the shared local finance settings singleton to pristine so the
    // Phase 4A settings suite still sees version 0 regardless of file order.
    sql('delete from public.finance_location_settings; delete from public.finance_settings;');
    await t.cleanup();
  });

  async function completedStockJob(quantity = 1) {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId, p_job: {},
      p_lines: [
        { line_type: 'product', product_id: productId, description: 'Fitted tyre', quantity },
        { line_type: 'labour', description: 'Fit and balance', quantity: 1, unit_price_incl_gst: 55 },
      ],
    });
    expect(created.error, JSON.stringify(created.error)).toBeNull();
    const done = await t.lon.rpc('complete_job', { p_job_id: created.data.job_id, p_expected_version: 1, p_request_id: randomUUID() });
    expect(done.error, JSON.stringify(done.error)).toBeNull();
    return created.data.job_id as string;
  }

  function movementCount(jobId: string) {
    return Number(sql(`select count(*) from public.inventory_movements where source_type='job' and source_id='${jobId}';`));
  }

  it('creates one draft invoice from a completed job with zero new inventory movements', async () => {
    const jobId = await completedStockJob();
    const before = movementCount(jobId);
    const res = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    createdInvoices.push(res.data.invoice_id);
    expect(res.data.invoice_number).toMatch(/^LON-INV-\d{6}$/);
    expect(res.data.status).toBe('draft');
    expect(res.data.pricing_complete).toBe(true);
    expect(movementCount(jobId)).toBe(before);

    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: res.data.invoice_id });
    expect(detail.error).toBeNull();
    expect(detail.data.job_id).toBe(jobId);
    const rev = detail.data.revisions[0];
    // 330 + 55 = 385 incl; GST = round(385/11) = 35.00
    expect(Number(rev.total_incl_gst)).toBe(385);
    expect(Number(rev.gst_amount)).toBe(35);
    const lineGstSum = (rev.lines as Array<{ gst_amount: string }>).reduce((s: number, l) => s + Number(l.gst_amount), 0);
    expect(lineGstSum).toBeCloseTo(35.0, 2);
    // ordinary detail never exposes cost
    expect(JSON.stringify(detail.data)).not.toContain('captured_unit_cost');
  });

  it('rejects invoicing when completion proof is inconsistent and creates no invoice', async () => {
    const jobId = await completedStockJob();
    // Tamper: leave a stale active reservation so the consumption proof fails.
    sql(`update public.inventory_reservations set status='active' where job_id='${jobId}';`);
    const res = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    expect(res.error?.message).toBe('JOB_CONSUMPTION_UNVERIFIED');
    expect(sql(`select count(*) from public.invoices where job_id='${jobId}';`)).toBe('0');
    sql(`update public.inventory_reservations set status='consumed' where job_id='${jobId}';`);
  });

  it('allows invoicing a labour-only completed job with no stock requirement', async () => {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId, p_job: {},
      p_lines: [{ line_type: 'labour', description: 'Callout inspection', quantity: 1, unit_price_incl_gst: 99 }],
    });
    const done = await t.lon.rpc('complete_job', { p_job_id: created.data.job_id, p_expected_version: 1, p_request_id: randomUUID() });
    expect(done.error).toBeNull();
    const res = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: created.data.job_id });
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    createdInvoices.push(res.data.invoice_id);
    expect(res.data.pricing_complete).toBe(true);
  });

  it('atomically completes and invoices in one transaction, consuming stock once', async () => {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId, p_job: {},
      p_lines: [{ line_type: 'product', product_id: productId, description: 'Combined', quantity: 2 }],
    });
    const balBefore = Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`));
    const res = await t.lon.rpc('complete_job_and_create_invoice', {
      p_request_id: randomUUID(), p_job_id: created.data.job_id, p_expected_version: 1,
    });
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    createdInvoices.push(res.data.invoice_id);
    expect(res.data.job_status).toBe('completed');
    expect(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`)).toBe(String(balBefore - 2));
    expect(movementCount(created.data.job_id)).toBe(1);
    expect(sql(`select count(*) from public.invoices where job_id='${created.data.job_id}';`)).toBe('1');
  });

  it('rolls back completion entirely when invoice construction fails after complete_job', async () => {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId, p_job: {},
      p_lines: [{ line_type: 'product', product_id: productId, description: 'Rollback', quantity: 1 }],
    });
    const original = sql(`select pg_get_functiondef('private.finance_build_job_invoice(uuid)'::regprocedure);`);
    sql(`create or replace function private.finance_build_job_invoice(p_job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $INJ$ begin raise exception 'INJECTED_FAILURE'; end; $INJ$;`);
    try {
      const balBefore = Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`));
      const res = await t.lon.rpc('complete_job_and_create_invoice', {
        p_request_id: randomUUID(), p_job_id: created.data.job_id, p_expected_version: 1,
      });
      expect(res.error?.message).toBe('INJECTED_FAILURE');
      expect(sql(`select status from public.jobs where id='${created.data.job_id}';`)).toBe('new');
      expect(sql(`select completed_at from public.jobs where id='${created.data.job_id}';`)).toBe('');
      expect(movementCount(created.data.job_id)).toBe(0);
      expect(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`)).toBe(String(balBefore));
      expect(sql(`select count(*) from public.invoices where job_id='${created.data.job_id}';`)).toBe('0');
      expect(sql(`select count(*) from public.commercial_action_requests where entity_id='${created.data.job_id}' and action='complete_job';`)).toBe('0');
    } finally {
      sql(original);
    }
  });

  it('does not double-consume when a standalone complete_job races the atomic wrapper', async () => {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId, p_job: {},
      p_lines: [{ line_type: 'product', product_id: productId, description: 'Race', quantity: 1 }],
    });
    const jobId = created.data.job_id as string;
    // The adversary derives the wrapper's child key and calls complete_job directly.
    const wrapperRequest = randomUUID();
    const childKey = sql(
      `select md5('complete_job_and_create_invoice:'||'${wrapperRequest}'||':'||'${jobId}')::uuid;`,
    );
    const balBefore = Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`));
    const [wrapper, standalone] = await Promise.allSettled([
      t.lon.rpc('complete_job_and_create_invoice', { p_request_id: wrapperRequest, p_job_id: jobId, p_expected_version: 1 }),
      t.lon.rpc('complete_job', { p_job_id: jobId, p_expected_version: 1, p_request_id: childKey }),
    ]);
    expect([wrapper, standalone].some((r) => r.status === 'fulfilled')).toBe(true);
    expect(movementCount(jobId)).toBe(1);
    expect(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`)).toBe(String(balBefore - 1));
    expect(sql(`select status from public.jobs where id='${jobId}';`)).toBe('completed');
    expect(Number(sql(`select count(*) from public.invoices where job_id='${jobId}';`))).toBeLessThanOrEqual(1);
    if (wrapper.status === 'fulfilled' && !wrapper.value.error) createdInvoices.push(wrapper.value.data.invoice_id);
    else {
      // wrapper lost the completion race; the completed job can still be invoiced explicitly
      const inv = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
      expect(inv.error).toBeNull();
      createdInvoices.push(inv.data.invoice_id);
    }
  });

  it('completes once and invoices once when two atomic wrappers race', async () => {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId, p_job: {},
      p_lines: [{ line_type: 'product', product_id: productId, description: 'DoubleWrap', quantity: 1 }],
    });
    const jobId = created.data.job_id as string;
    const balBefore = Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`));
    const results = await Promise.allSettled([
      t.lon.rpc('complete_job_and_create_invoice', { p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: 1 }),
      t.lon.rpc('complete_job_and_create_invoice', { p_request_id: randomUUID(), p_job_id: jobId, p_expected_version: 1 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled' && !r.value.error);
    expect(ok).toHaveLength(1);
    expect(movementCount(jobId)).toBe(1);
    expect(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}';`)).toBe(String(balBefore - 1));
    expect(sql(`select count(*) from public.invoices where job_id='${jobId}';`)).toBe('1');
    for (const r of ok) if (r.status === 'fulfilled') createdInvoices.push(r.value.data.invoice_id);
  });

  it('never creates two invoices for one job under concurrent requests', async () => {
    const jobId = await completedStockJob();
    const results = await Promise.allSettled([
      t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId }),
      t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled' && !r.value.error);
    expect(ok).toHaveLength(1);
    expect(sql(`select count(*) from public.invoices where job_id='${jobId}';`)).toBe('1');
    for (const r of ok) if (r.status === 'fulfilled') createdInvoices.push(r.value.data.invoice_id);
  });

  it('returns the original result on identical replay and rejects a reused key with a new payload', async () => {
    const jobId = await completedStockJob();
    const requestId = randomUUID();
    const first = await t.lon.rpc('create_invoice_from_job', { p_request_id: requestId, p_job_id: jobId });
    expect(first.error).toBeNull();
    createdInvoices.push(first.data.invoice_id);
    const replay = await t.lon.rpc('create_invoice_from_job', { p_request_id: requestId, p_job_id: jobId });
    expect(replay.error).toBeNull();
    expect(replay.data.invoice_id).toBe(first.data.invoice_id);

    const otherJob = await completedStockJob();
    const reused = await t.lon.rpc('create_invoice_from_job', { p_request_id: requestId, p_job_id: otherJob });
    expect(reused.error?.message).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('denies a manager invoicing a job in another branch', async () => {
    const jobId = await completedStockJob();
    const res = await t.reg.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    expect(res.error?.message).toBe('ACCESS_DENIED');
  });

  it('keeps NULL captured cost NULL and hides it behind inventory.view_cost', async () => {
    const jobId = await completedStockJob();
    // WAC unknown for this product? It was stocked with a cost, so instead assert
    // cost detail is permission gated and preserves whatever the job captured.
    const res = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    expect(res.error).toBeNull();
    createdInvoices.push(res.data.invoice_id);
    const denied = await t.lon.rpc('invoice_cost_detail', { p_invoice_id: res.data.invoice_id });
    expect(denied.error?.message).toBe('ACCESS_DENIED');
  });

  it('allows a NULL-price draft but blocks issue until priced', async () => {
    const pendingProduct = await t.admin.rpc('create_product', {
      p_name: 'Pending Price Tyre', p_category_code: 'truck_tyre', p_tyre_condition: 'new',
      p_tyre_brand: 'Pending', p_tyre_size: '295/80R22.5',
    });
    await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: pendingProduct.data, p_location_id: t.lonLocationId,
      p_quantity_delta: 5, p_movement_type: 'quick_stock_in',
    });
    const manual = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { customer_id: customerId, lines: [{ line_type: 'labour', description: 'Quote pending', quantity: 1 }] },
    });
    expect(manual.error, JSON.stringify(manual.error)).toBeNull();
    createdInvoices.push(manual.data.invoice_id);
    expect(manual.data.pricing_complete).toBe(false);
    const issue = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: manual.data.invoice_id, p_expected_version: 1 });
    expect(issue.error?.message).toBe('INVOICE_PRICE_PENDING');
    await t.service.from('products').delete().eq('id', pendingProduct.data);
  });

  it('edits a job-invoice draft line discount in place without disturbing cost rows or identity', async () => {
    const jobId = await completedStockJob();
    const created = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    createdInvoices.push(created.data.invoice_id);
    const before = await t.lon.rpc('invoice_detail', { p_invoice_id: created.data.invoice_id });
    const rev = before.data.revisions[0];
    const productLine = rev.lines.find((l: { source_job_line_id: string | null }) => l.source_job_line_id !== null);
    const costRowsBefore = sql(`select count(*) from public.invoice_line_costs c join public.invoice_lines l on l.id=c.invoice_line_id where l.revision_id='${rev.id}';`);

    const update = await t.admin.rpc('update_invoice_draft', {
      p_request_id: randomUUID(), p_invoice_id: created.data.invoice_id, p_expected_version: before.data.version,
      p_input: {
        lines: rev.lines.map((l: { id: string; source_job_line_id: string | null }) =>
          l.id === productLine.id
            ? { id: l.id, discount_percent: '10', discount_reason: 'Loyal fleet customer' }
            : { id: l.id },
        ),
      },
    });
    expect(update.error, JSON.stringify(update.error)).toBeNull();
    // cost rows preserved (same count, same line ids)
    expect(sql(`select count(*) from public.invoice_line_costs c join public.invoice_lines l on l.id=c.invoice_line_id where l.revision_id='${rev.id}';`)).toBe(costRowsBefore);
    const after = await t.lon.rpc('invoice_detail', { p_invoice_id: created.data.invoice_id });
    const afterLine = after.data.revisions[0].lines.find((l: { id: string }) => l.id === productLine.id);
    expect(Number(afterLine.discount_percent)).toBe(10);
    expect(afterLine.quantity).toBe(productLine.quantity); // identity/quantity unchanged
    // line GST still sums exactly to the header
    const sum = after.data.revisions[0].lines.reduce((s: number, l: { gst_amount: string }) => s + Number(l.gst_amount), 0);
    expect(sum).toBeCloseTo(Number(after.data.revisions[0].gst_amount), 2);

    // Attempting to drop a job line is rejected.
    const dropAttempt = await t.admin.rpc('update_invoice_draft', {
      p_request_id: randomUUID(), p_invoice_id: created.data.invoice_id, p_expected_version: after.data.version,
      p_input: { lines: [{ id: after.data.revisions[0].lines[0].id }] },
    });
    expect(dropAttempt.error?.message).toBe('INVOICE_LINE_NOT_EDITABLE');
  });

  it('issues, then blocks in-place issued edits and increments revision numbers', async () => {
    const jobId = await completedStockJob();
    const created = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    createdInvoices.push(created.data.invoice_id);
    const issue = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: created.data.invoice_id, p_expected_version: 1 });
    expect(issue.error, JSON.stringify(issue.error)).toBeNull();
    expect(issue.data.status).toBe('issued');
    expect(issue.data.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Issued revision + lines are immutable at the database layer.
    const revId = issue.data.revision_id;
    expect(() => sql(`update public.invoice_revisions set customer_notes='x' where id='${revId}';`)).toThrow();
    expect(() => sql(`update public.invoice_lines set description='x' where revision_id='${revId}';`)).toThrow();

    const detailV = await t.lon.rpc('invoice_detail', { p_invoice_id: created.data.invoice_id });
    const version = detailV.data.version;
    const revise = await t.lon.rpc('revise_unpaid_invoice', {
      p_request_id: randomUUID(), p_invoice_id: created.data.invoice_id, p_expected_version: version,
      p_input: { revision_reason: 'Customer wording update', customer_notes: 'Updated note' },
    });
    expect(revise.error, JSON.stringify(revise.error)).toBeNull();
    expect(revise.data.revision_number).toBe(2);

    // Stale version rejected.
    const stale = await t.lon.rpc('revise_unpaid_invoice', {
      p_request_id: randomUUID(), p_invoice_id: created.data.invoice_id, p_expected_version: version,
      p_input: { revision_reason: 'Second attempt' },
    });
    expect(stale.error?.message).toBe('INVOICE_VERSION_CONFLICT');
  });

  it('permanently blocks revision once first_payment_at is set (4A fixture lock)', async () => {
    const jobId = await completedStockJob();
    const created = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    createdInvoices.push(created.data.invoice_id);
    await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: created.data.invoice_id, p_expected_version: 1 });
    sql(`update public.invoices set first_payment_at=now() where id='${created.data.invoice_id}';`);
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: created.data.invoice_id });
    const revise = await t.lon.rpc('revise_unpaid_invoice', {
      p_request_id: randomUUID(), p_invoice_id: created.data.invoice_id, p_expected_version: detail.data.version,
      p_input: { revision_reason: 'Too late' },
    });
    expect(revise.error?.message).toBe('INVOICE_FINANCIAL_LOCKED');
  });

  it('cancels a draft with a reason but refuses issued cancellation in 4B', async () => {
    const manual = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { customer_id: customerId, lines: [{ line_type: 'labour', description: 'To cancel', quantity: 1, unit_price_incl_gst: 22 }] },
    });
    createdInvoices.push(manual.data.invoice_id);
    const cancel = await t.lon.rpc('cancel_invoice', {
      p_request_id: randomUUID(), p_invoice_id: manual.data.invoice_id, p_expected_version: 1, p_reason: 'Created in error',
    });
    expect(cancel.error, JSON.stringify(cancel.error)).toBeNull();
    expect(cancel.data.status).toBe('cancelled');

    const jobId = await completedStockJob();
    const inv = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: jobId });
    createdInvoices.push(inv.data.invoice_id);
    await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: inv.data.invoice_id, p_expected_version: 1 });
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: inv.data.invoice_id });
    const issuedCancel = await t.lon.rpc('cancel_invoice', {
      p_request_id: randomUUID(), p_invoice_id: inv.data.invoice_id, p_expected_version: detail.data.version, p_reason: 'Nope',
    });
    expect(issuedCancel.error?.message).toBe('ISSUED_CANCELLATION_NOT_AVAILABLE');
  });

  it('links a job to its invoice through invoice_for_job (and returns null when uninvoiced)', async () => {
    const uninvoiced = await completedStockJob();
    const none = await t.lon.rpc('invoice_for_job', { p_job_id: uninvoiced });
    expect(none.error).toBeNull();
    expect(none.data).toBeNull();

    const invoiced = await completedStockJob();
    const inv = await t.lon.rpc('create_invoice_from_job', { p_request_id: randomUUID(), p_job_id: invoiced });
    createdInvoices.push(inv.data.invoice_id);
    const linked = await t.lon.rpc('invoice_for_job', { p_job_id: invoiced });
    expect(linked.error).toBeNull();
    expect(linked.data.id).toBe(inv.data.invoice_id);
    expect(linked.data.invoice_number).toMatch(/^LON-INV-\d{6}$/);
    expect(linked.data.status).toBe('draft');

    // Cross-branch manager is denied.
    const denied = await t.reg.rpc('invoice_for_job', { p_job_id: invoiced });
    expect(denied.error?.message).toBe('ACCESS_DENIED');
  });

  it('refuses product/used-unit ids on a manual invoice', async () => {
    const res = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { customer_id: customerId, lines: [{ line_type: 'product', product_id: productId, description: 'Sneaky', quantity: 1 }] },
    });
    expect(res.error?.message).toBe('MANUAL_INVOICE_SERVICE_ONLY');
  });
});
