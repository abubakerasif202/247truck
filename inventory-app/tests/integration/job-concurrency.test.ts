import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
const missing = missingEnv(); const run = missing.length === 0 ? describe : describe.skip; if (missing.length) console.warn(`[job-concurrency] skipped: missing ${missing.join(', ')}`);
run('Phase 3B reservation concurrency', () => {
  let t: TestTenants; let customerId: string; let productId: string; const jobs: string[] = [];
  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: ['jobs.view', 'jobs.create', 'inventory.stock_in'] });
    const customer = await t.admin.rpc('create_customer', { p_request_id: randomUUID(), p_customer: { customer_type: 'business', display_name: 'Concurrency Fleet', company_name: 'Concurrency Fleet', abn: '51824753556', mobile: '0400000003', street_address: '3 Test Street', suburb: 'Lonsdale', state: 'SA', postcode: '5160' } });
    expect(customer.error).toBeNull(); customerId = customer.data.customer_id;
    const product = await t.admin.rpc('create_product', { p_name: 'Concurrency Tyre', p_category_code: 'truck_tyre', p_selling_price_incl_gst: 100, p_tyre_condition: 'new', p_tyre_brand: 'Concurrent', p_tyre_size: '11R22.5' });
    expect(product.error).toBeNull(); productId = product.data;
    const stocked = await t.admin.rpc('post_inventory_movement', { p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId, p_quantity_delta: 1, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 40 }); expect(stocked.error).toBeNull();
  });
  afterAll(async () => { if (!t) return; await t.service.from('jobs').delete().in('id', jobs); await t.service.from('customers').delete().eq('id', customerId); await t.service.from('products').delete().eq('id', productId); await t.cleanup(); });
  it('allows only one of two concurrent final-unit reservations', async () => {
    const request = () => t.lon.rpc('create_job', { p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customerId, p_customer_vehicle_id: null, p_job: {}, p_lines: [{ line_type: 'product', product_id: productId, description: 'Concurrent tyre', quantity: 1 }] });
    const results = await Promise.all([request(), request()]); const successful = results.filter(result => !result.error); const failed = results.filter(result => result.error?.message === 'INSUFFICIENT_STOCK');
    expect(successful).toHaveLength(1); expect(failed).toHaveLength(1); jobs.push(successful[0].data.job_id);
    const balance = await t.service.from('inventory_balances').select('on_hand,reserved').eq('product_id', productId).eq('location_id', t.lonLocationId).single(); expect(balance.error).toBeNull(); expect(balance.data).toEqual({ on_hand: 1, reserved: 1 });
  });
});
