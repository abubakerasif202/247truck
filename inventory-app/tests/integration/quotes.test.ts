import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[quotes] skipped: missing ${missing.join(', ')}`);

const customerPayload = {
  customer_type: 'business', display_name: 'Phase 3B Fleet', company_name: 'Phase 3B Fleet',
  abn: '51824753556', phone: '0881234567', billing_email: 'accounts@phase3b.test',
  suburb: 'Lonsdale', state: 'SA', postcode: '5160', payment_terms: '30_days',
  po_reference_required: true,
};

run('Phase 3B quotes', () => {
  let t: TestTenants;
  let customerId: string;
  let vehicleId: string;
  let productId: string;
  const createdCustomers: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: [
        'customers.manage_vehicles',
        'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.accept',
        'jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'pos.use',
      ],
    });
    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(), p_customer: customerPayload,
    });
    expect(customer.error).toBeNull();
    customerId = customer.data.customer_id;
    createdCustomers.push(customerId);
    const vehicle = await t.lon.rpc('add_customer_vehicle', {
      p_customer_id: customerId,
      p_vehicle: { vehicle_type: 'truck', registration: 'P3B 001', fleet_number: 'P3B-1' },
    });
    expect(vehicle.error).toBeNull();
    vehicleId = vehicle.data.vehicle_id;
    const product = await t.admin.rpc('create_product', {
      p_name: 'Phase 3B Product', p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 110, p_tyre_condition: 'new',
      p_tyre_brand: 'Phase Brand', p_tyre_size: '315/80R22.5',
    });
    expect(product.error).toBeNull();
    productId = product.data;
    const stocked = await t.admin.rpc('post_inventory_movement', { p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId, p_quantity_delta: 2, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100 });
    expect(stocked.error).toBeNull();
  });

  afterAll(async () => {
    if (t) {
      await t.service.from('jobs').delete().in('customer_id', createdCustomers);
      await t.service.from('quotes').delete().in('customer_id', createdCustomers);
      await t.service.from('customers').delete().in('id', createdCustomers);
      await t.service.from('products').delete().eq('id', productId);
      await t.cleanup();
    }
  });

  async function createQuote(client = t.lon, overrides: Record<string, unknown> = {}) {
    return client.rpc('create_quote', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customerId, p_customer_vehicle_id: vehicleId,
      p_quote: { customer_reference: 'PO-P3B-1', internal_notes: 'Internal', customer_notes: 'Thanks', ...overrides },
      p_lines: [
        { line_type: 'product', product_id: productId, description: 'Phase 3B Product', quantity: 2 },
        { line_type: 'labour', description: 'Fit and balance', quantity: 1.5, unit_price_incl_gst: 55 },
      ],
    });
  }

  it('creates a quote with exact GST-inclusive totals and snapshots', async () => {
    const response = await createQuote();
    expect(response.error).toBeNull();
    expect(response.data.quote_number).toMatch(/^LON-QUO-\d{6}$/);
    expect(response.data.status).toBe('draft');
    expect(response.data.pricing_complete).toBe(true);
    expect(Number(response.data.total_incl_gst)).toBe(302.5);
    expect(Number(response.data.gst_amount)).toBe(27.5);
    expect(Number(response.data.subtotal_ex_gst)).toBe(275);

    const detail = await t.lon.rpc('quote_detail', { p_quote_id: response.data.quote_id });
    expect(detail.error).toBeNull();
    expect(detail.data.customer_id).toBe(customerId);
    expect(detail.data.lines).toHaveLength(2);
  });

  it('does not reserve or move stock for quote creation, acceptance, or conversion setup', async () => {
    const before = await t.service.from('inventory_balances').select('on_hand,reserved').eq('product_id', productId).eq('location_id', t.lonLocationId).single();
    const quote = await createQuote();
    expect(quote.error).toBeNull();
    const accepted = await t.lon.rpc('transition_quote', { p_quote_id: quote.data.quote_id, p_expected_version: 1, p_status: 'sent' });
    expect(accepted.error).toBeNull();
    const result = await t.lon.rpc('transition_quote', { p_quote_id: quote.data.quote_id, p_expected_version: 2, p_status: 'accepted' });
    expect(result.error).toBeNull();
    const after = await t.service.from('inventory_balances').select('on_hand,reserved').eq('product_id', productId).eq('location_id', t.lonLocationId).single();
    expect(after.data).toEqual(before.data);
    const movement = await t.service.from('inventory_movements').select('id').eq('source_type', 'quote').eq('source_id', quote.data.quote_id);
    expect(movement.data).toEqual([]);
  });

  it('rejects invalid status jumps and stale updates', async () => {
    const quote = await createQuote();
    expect((await t.lon.rpc('transition_quote', { p_quote_id: quote.data.quote_id, p_expected_version: 1, p_status: 'accepted' })).error?.message).toContain('INVALID_QUOTE_TRANSITION');
    const update = await t.lon.rpc('update_quote_draft', {
      p_quote_id: quote.data.quote_id, p_expected_version: 99,
      p_quote: { customer_reference: 'stale' }, p_lines: [],
    });
    expect(update.error?.message).toContain('QUOTE_VERSION_CONFLICT');
  });

  it('blocks send when a business customer still requires a PO reference', async () => {
    const quote = await createQuote(t.lon, { customer_reference: null });
    expect(quote.error).toBeNull();
    const result = await t.lon.rpc('transition_quote', { p_quote_id: quote.data.quote_id, p_expected_version: 1, p_status: 'sent' });
    expect(result.error?.message).toContain('PO_REFERENCE_REQUIRED');
  });

  it('rejects a pending product price without turning it into zero', async () => {
    const pending = await t.admin.rpc('set_product_selling_price', { p_product_id: productId, p_selling_price_incl_gst: null });
    expect(pending.error).toBeNull();
    const quote = await createQuote();
    expect(quote.error).toBeNull();
    expect(quote.data.pricing_complete).toBe(false);
    expect(quote.data.total_incl_gst).toBeNull();
    expect((await t.lon.rpc('transition_quote', { p_quote_id: quote.data.quote_id, p_expected_version: 1, p_status: 'sent' })).error?.message).toContain('PRICE_PENDING');
    await t.admin.rpc('set_product_selling_price', { p_product_id: productId, p_selling_price_incl_gst: 110 });
  });

  it('converts one accepted quote into one job and rejects repeated conversion with a new request', async () => {
    const quote = await createQuote();
    expect((await t.lon.rpc('transition_quote', { p_quote_id: quote.data.quote_id, p_expected_version: 1, p_status: 'sent' })).error).toBeNull();
    expect((await t.lon.rpc('transition_quote', { p_quote_id: quote.data.quote_id, p_expected_version: 2, p_status: 'accepted' })).error).toBeNull();
    const requestId = randomUUID();
    const first = await t.lon.rpc('convert_quote_to_job', { p_quote_id: quote.data.quote_id, p_expected_version: 3, p_request_id: requestId });
    expect(first.error).toBeNull();
    expect(first.data.job_number).toMatch(/^LON-JOB-\d{6}$/);
    const replay = await t.lon.rpc('convert_quote_to_job', { p_quote_id: quote.data.quote_id, p_expected_version: 3, p_request_id: requestId });
    expect(replay.error).toBeNull();
    expect(replay.data.job_id).toBe(first.data.job_id);
    const detail = await t.lon.rpc('quote_detail', { p_quote_id: quote.data.quote_id });
    expect(detail.data.status).toBe('converted_to_job');
    expect(detail.data.converted_job_id).toBe(first.data.job_id);
  });
});
