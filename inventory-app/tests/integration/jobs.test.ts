import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[jobs] skipped: missing ${missing.join(', ')}`);

run('Phase 3B jobs', () => {
  let t: TestTenants;
  let customerId: string;
  let vehicleId: string;
  let productId: string;
  const createdCustomers: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: [
        'customers.manage_vehicles', 'jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete',
        'pos.use', 'inventory.stock_in', 'inventory.stock_out', 'inventory.view',
      ],
    });
    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: { customer_type: 'individual', display_name: 'Phase 3B Job Customer', mobile: '0400000001', street_address: '1 Test Street', suburb: 'Lonsdale', state: 'SA', postcode: '5160' },
    });
    expect(customer.error).toBeNull();
    customerId = customer.data.customer_id;
    createdCustomers.push(customerId);
    const vehicle = await t.lon.rpc('add_customer_vehicle', {
      p_customer_id: customerId,
      p_vehicle: { vehicle_type: 'truck', registration: 'JOB 001' },
    });
    expect(vehicle.error).toBeNull();
    vehicleId = vehicle.data.vehicle_id;
    const product = await t.admin.rpc('create_product', {
      p_name: 'Phase 3B Job Tyre', p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 220, p_tyre_condition: 'new', p_tyre_brand: 'Job Brand',
      p_tyre_size: '315/80R22.5',
    });
    expect(product.error).toBeNull();
    productId = product.data;
    const stocked = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
      p_quantity_delta: 2, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100,
    });
    expect(stocked.error).toBeNull();
  });

  afterAll(async () => {
    if (!t) return;
    await t.service.from('jobs').delete().in('customer_id', createdCustomers);
    await t.service.from('customers').delete().in('id', createdCustomers);
    await t.service.from('products').delete().eq('id', productId);
    await t.cleanup();
  });

  function lines(quantity: number) {
    return [
      { line_type: 'product', product_id: productId, description: 'Historical tyre', quantity },
      { line_type: 'labour', description: 'Fit and balance', quantity: 1, unit_price_incl_gst: 55 },
    ];
  }

  it('creates a direct job with customer and vehicle linkage', async () => {
    const response = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId,
      p_job: { customer_reference: 'JOB-PO-1', customer_notes: 'Call when ready' },
      p_lines: lines(1),
    });
    expect(response.error).toBeNull();
    expect(response.data.job_number).toMatch(/^LON-JOB-\d{6}$/);
    expect(response.data.status).toBe('new');
    const detail = await t.lon.rpc('job_detail', { p_job_id: response.data.job_id });
    expect(detail.error).toBeNull();
    expect(detail.data.customer_id).toBe(customerId);
    expect(detail.data.vehicle_id ?? detail.data.customer_vehicle_id).toBe(vehicleId);
    expect(detail.data.lines).toHaveLength(2);
  });

  it('completes through the ledger exactly once and is idempotent on retry', async () => {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId,
      p_job: {}, p_lines: lines(1),
    });
    expect(created.error).toBeNull();
    const before = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.lonLocationId).single();
    expect(before.error).toBeNull();
    expect(before.data).not.toBeNull();
    const requestId = randomUUID();
    const completed = await t.lon.rpc('complete_job', { p_job_id: created.data.job_id, p_expected_version: 1, p_request_id: requestId });
    expect(completed.error).toBeNull();
    expect(completed.data.status).toBe('completed');
    const after = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.lonLocationId).single();
    expect(after.error).toBeNull();
    expect(after.data).not.toBeNull();
    expect(after.data!.on_hand).toBe(before.data!.on_hand - 1);
    const retry = await t.lon.rpc('complete_job', { p_job_id: created.data.job_id, p_expected_version: 2, p_request_id: requestId });
    expect(retry.error).toBeNull();
    const final = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.lonLocationId).single();
    expect(final.error).toBeNull();
    expect(final.data).not.toBeNull();
    expect(final.data!.on_hand).toBe(after.data!.on_hand);
    const movements = await t.service.from('inventory_movements').select('id').eq('source_type', 'job').eq('source_id', created.data.job_id);
    expect(movements.data).toHaveLength(1);
  });

  it('rejects job creation when available stock is insufficient', async () => {
    const created = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId,
      p_job: {}, p_lines: lines(2),
    });
    expect(created.error?.message).toBe('INSUFFICIENT_STOCK');
  });
});
