import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[jobs-pos] skipped: missing ${missing.join(', ')}`);

run('Phase 3B job reservations', () => {
  let t: TestTenants; let customerId: string; let vehicleId: string; let productId: string; let usedProductId: string; let usedUnitId: string; let usedUnitId2: string;
  const jobs: string[] = []; const customers: string[] = [];
  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: ['customers.manage_vehicles', 'jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'pos.use', 'inventory.stock_in', 'inventory.stock_out', 'inventory.view'] });
    const customer = await t.admin.rpc('create_customer', { p_request_id: randomUUID(), p_customer: { customer_type: 'business', display_name: 'Reservation Fleet', company_name: 'Reservation Fleet', abn: '51824753556', mobile: '0400000002', street_address: '2 Test Street', suburb: 'Lonsdale', state: 'SA', postcode: '5160' } });
    expect(customer.error).toBeNull(); customerId = customer.data.customer_id; customers.push(customerId);
    const vehicle = await t.lon.rpc('add_customer_vehicle', { p_customer_id: customerId, p_vehicle: { vehicle_type: 'truck', registration: 'RES 001' } });
    expect(vehicle.error).toBeNull(); vehicleId = vehicle.data.vehicle_id;
    const product = await t.admin.rpc('create_product', { p_name: 'Reservation Tyre', p_category_code: 'truck_tyre', p_selling_price_incl_gst: 220, p_tyre_condition: 'new', p_tyre_brand: 'Reserve Brand', p_tyre_size: '315/80R22.5' });
    expect(product.error).toBeNull(); productId = product.data;
    const stocked = await t.admin.rpc('post_inventory_movement', { p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId, p_quantity_delta: 2, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100 });
    expect(stocked.error).toBeNull();
    const usedProduct = await t.admin.rpc('create_product', { p_name: 'Reservation Used Casing', p_category_code: 'truck_tyre', p_selling_price_incl_gst: 260, p_tyre_condition: 'used', p_tyre_brand: 'Reserve Used Brand', p_tyre_size: '11R22.5' });
    expect(usedProduct.error).toBeNull(); usedProductId = usedProduct.data;
    const usedUnit = await t.admin.rpc('create_used_tyre_unit_with_stock', { p_request_id: randomUUID(), p_product_id: usedProductId, p_location_id: t.lonLocationId, p_tread_depth_mm: 9, p_condition: 'good', p_cost_basis: 80, p_selling_price_override: null, p_notes: null });
    expect(usedUnit.error).toBeNull(); usedUnitId = (Array.isArray(usedUnit.data) ? usedUnit.data[0] : usedUnit.data).unit_id;
    const usedUnit2 = await t.admin.rpc('create_used_tyre_unit_with_stock', { p_request_id: randomUUID(), p_product_id: usedProductId, p_location_id: t.lonLocationId, p_tread_depth_mm: 8.5, p_condition: 'fair', p_cost_basis: 70, p_selling_price_override: null, p_notes: null });
    expect(usedUnit2.error).toBeNull(); usedUnitId2 = (Array.isArray(usedUnit2.data) ? usedUnit2.data[0] : usedUnit2.data).unit_id;
  });
  afterAll(async () => { if (!t) return; await t.service.from('jobs').delete().in('id', jobs); await t.service.from('customers').delete().in('id', customers); await t.service.from('products').delete().in('id', [productId, usedProductId]); await t.cleanup(); });
  afterEach(async () => { for (const jobId of jobs.splice(0)) { const detail = await t.lon.rpc('job_detail', { p_job_id: jobId }); if (!detail.error && detail.data.status !== 'cancelled' && detail.data.status !== 'completed') await t.lon.rpc('cancel_job', { p_job_id: jobId, p_expected_version: detail.data.version }); } });
  const create = (quantity = 1, customer: string | null = customerId, vehicle: string | null = vehicleId, includeProduct = true) => t.lon.rpc('create_job', { p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customer, p_customer_vehicle_id: vehicle, p_job: { source_type: customer ? 'direct' : 'pos', walk_in_label: customer ? null : 'Walk-in counter' }, p_lines: [...(includeProduct ? [{ line_type: 'product', product_id: productId, description: 'Reserved tyre', quantity }] : []), { line_type: 'labour', description: 'Fit', quantity: 1, unit_price_incl_gst: 55 }] });
  it('reserves active product lines without changing on-hand', async () => { const before = await t.service.from('inventory_balances').select('on_hand,reserved').eq('product_id', productId).eq('location_id', t.lonLocationId).single(); const created = await create(); expect(created.error).toBeNull(); jobs.push(created.data.job_id); const after = await t.service.from('inventory_balances').select('on_hand,reserved').eq('product_id', productId).eq('location_id', t.lonLocationId).single(); expect(after.data).toEqual({ on_hand: before.data!.on_hand, reserved: before.data!.reserved + 1 }); });
  it('adjusts and releases reservations atomically on job edits and cancellation', async () => { const created = await create(); expect(created.error).toBeNull(); jobs.push(created.data.job_id); const updated = await t.lon.rpc('update_job', { p_job_id: created.data.job_id, p_expected_version: 1, p_job: {}, p_lines: [{ line_type: 'product', product_id: productId, description: 'Two reserved tyres', quantity: 2 }, { line_type: 'labour', description: 'Fit', quantity: 1, unit_price_incl_gst: 55 }] }); expect(updated.error).toBeNull(); const cancelled = await t.lon.rpc('cancel_job', { p_job_id: created.data.job_id, p_expected_version: 2 }); expect(cancelled.error).toBeNull(); const balance = await t.service.from('inventory_balances').select('reserved').eq('product_id', productId).eq('location_id', t.lonLocationId).single(); expect(balance.data!.reserved).toBe(0); });
  it('supports a nullable customer for a POS-origin walk-in job', async () => { const created = await create(1, null, null, false); expect(created.error).toBeNull(); jobs.push(created.data.job_id); const detail = await t.lon.rpc('job_detail', { p_job_id: created.data.job_id }); expect(detail.error).toBeNull(); expect(detail.data.customer_id).toBeNull(); expect(detail.data.source_type).toBe('pos'); });
  it('rejects a second job reservation when available stock is exhausted', async () => { const first = await create(1); expect(first.error).toBeNull(); jobs.push(first.data.job_id); const second = await create(2); expect(second.error?.message).toBe('INSUFFICIENT_STOCK'); });
  it('reserves the exact used tyre unit and releases it on cancellation without a movement', async () => {
    const before = await t.service.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('used_tyre_unit_id', usedUnitId);
    const created = await t.lon.rpc('create_job', { p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customerId, p_customer_vehicle_id: null, p_job: {}, p_lines: [{ line_type: 'product', product_id: usedProductId, used_tyre_unit_id: usedUnitId, description: 'Exact used casing', quantity: 1 }] });
    expect(created.error).toBeNull(); jobs.push(created.data.job_id);
    const unitReserved = await t.service.from('used_tyre_units').select('status').eq('id', usedUnitId).single();
    expect(unitReserved.data?.status).toBe('reserved');
    const reservation = await t.service.from('inventory_reservations').select('job_id,job_line_id,product_id,used_tyre_unit_id,location_id,quantity,status').eq('job_id', created.data.job_id).single();
    expect(reservation.data).toMatchObject({ job_id: created.data.job_id, product_id: usedProductId, used_tyre_unit_id: usedUnitId, location_id: t.lonLocationId, quantity: 1, status: 'active' });
    const cancelled = await t.lon.rpc('cancel_job', { p_job_id: created.data.job_id, p_expected_version: 1 });
    expect(cancelled.error).toBeNull();
    const unitAvailable = await t.service.from('used_tyre_units').select('status').eq('id', usedUnitId).single();
    expect(unitAvailable.data?.status).toBe('available');
    const released = await t.service.from('inventory_reservations').select('status').eq('job_id', created.data.job_id).single();
    expect(released.data?.status).toBe('released');
    const after = await t.service.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('used_tyre_unit_id', usedUnitId);
    expect(after.count).toBe(before.count);
  });
  it('consumes the reserved unit exactly once and preserves its authoritative cost basis', async () => {
    const created = await t.lon.rpc('create_job', { p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customerId, p_customer_vehicle_id: null, p_job: {}, p_lines: [{ line_type: 'product', product_id: usedProductId, used_tyre_unit_id: usedUnitId, description: 'Sell exact casing', quantity: 1 }] });
    expect(created.error).toBeNull(); jobs.push(created.data.job_id);
    const requestId = randomUUID();
    const completed = await t.lon.rpc('complete_job', { p_job_id: created.data.job_id, p_expected_version: 1, p_request_id: requestId });
    expect(completed.error).toBeNull();
    const retry = await t.lon.rpc('complete_job', { p_job_id: created.data.job_id, p_expected_version: 1, p_request_id: requestId });
    expect(retry.error).toBeNull(); expect(retry.data).toEqual(completed.data);
    const unit = await t.service.from('used_tyre_units').select('status,cost_basis').eq('id', usedUnitId).single();
    expect(unit.data).toEqual({ status: 'sold', cost_basis: 80 });
    const reservation = await t.service.from('inventory_reservations').select('status').eq('job_id', created.data.job_id).single();
    expect(reservation.data?.status).toBe('consumed');
    const movements = await t.service.from('inventory_movements').select('id,movement_type,used_tyre_unit_id,quantity_delta').eq('used_tyre_unit_id', usedUnitId);
    expect(movements.data?.filter(row => row.movement_type === 'used_unit_out')).toHaveLength(1);
  });
  it('rejects a second active reservation for the same individual unit', async () => {
    const first = await t.lon.rpc('create_job', { p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customerId, p_customer_vehicle_id: null, p_job: {}, p_lines: [{ line_type: 'product', product_id: usedProductId, used_tyre_unit_id: usedUnitId2, description: 'First claim', quantity: 1 }] });
    expect(first.error).toBeNull(); jobs.push(first.data.job_id);
    const second = await t.lon.rpc('create_job', { p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customerId, p_customer_vehicle_id: null, p_job: {}, p_lines: [{ line_type: 'product', product_id: usedProductId, used_tyre_unit_id: usedUnitId2, description: 'Second claim', quantity: 1 }] });
    expect(second.error?.message).toBe('USED_TYRE_NOT_AVAILABLE');
  });
});
