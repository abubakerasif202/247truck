import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const suite = missing.length === 0 ? describe : describe.skip;

function payloadHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

suite('generic sales and webhook ledger', () => {
  let t: TestTenants;
  let awtOrganizationId: string;
  let truckOrganizationId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.stock_in', 'pos.use', 'jobs.create', 'jobs.edit'],
      regPermissions: ['inventory.stock_in', 'pos.use'],
    });
    const { data: organizations, error } = await t.service
      .from('organizations')
      .select('id, code')
      .in('code', ['AWT', '247TRUCK']);
    if (error || !organizations || organizations.length !== 2) throw error ?? new Error('organizations missing');
    awtOrganizationId = organizations.find((o) => o.code === 'AWT')!.id;
    truckOrganizationId = organizations.find((o) => o.code === '247TRUCK')!.id;
    const lonAssignment = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: awtOrganizationId,
      p_location_id: t.lonLocationId,
      p_active: true,
    });
    if (lonAssignment.error) throw lonAssignment.error;
    const regAssignment = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: truckOrganizationId,
      p_location_id: t.regLocationId,
      p_active: true,
    });
    if (regAssignment.error) throw regAssignment.error;
    // REG is the real shared physical warehouse both businesses transact
    // against (see docs/stage-a-release-readiness-20260917.md, Stage D):
    // 247TRUCK and AWT are both legitimately active at REG simultaneously.
    const regAwtAssignment = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: awtOrganizationId,
      p_location_id: t.regLocationId,
      p_active: true,
    });
    if (regAwtAssignment.error) throw regAwtAssignment.error;
  });

  afterAll(async () => {
    // LON is used here as a fixture stand-in for "AWT's own location" in
    // several tests in this file, but production LON is deliberately left
    // with zero organization assignments (legacy/unverified - see
    // 20260917150000 and 20260917160000). Other integration test files
    // depend on LON genuinely having zero active assignments; deactivate
    // this file's own AWT+LON assignment so it doesn't leak into them.
    if (t && awtOrganizationId) {
      await t.admin.rpc('admin_assign_organization_location', {
        p_organization_id: awtOrganizationId, p_location_id: t.lonLocationId, p_active: false,
      });
    }
    await t?.cleanup();
  });

  async function productWithStock(quantity: number, priceInclGst = 110) {
    const { data: productId, error } = await t.admin.rpc('create_product_with_prices', {
      p_name: `Generic sale ${randomUUID()}`,
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: priceInclGst,
      p_wholesale_price_incl_gst: priceInclGst,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Generic',
      p_tyre_size: '295/80R22.5',
    });
    if (error || !productId) throw error ?? new Error('product creation failed');
    const stocked = await t.lon.rpc('post_inventory_movement_with_notes', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
      p_quantity_delta: quantity, p_movement_type: 'quick_stock_in', p_reason: null,
      p_inbound_unit_cost: 50, p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null, p_notes: null,
    });
    if (stocked.error) throw stocked.error;
    return String(productId);
  }

  async function onHand(productId: string) {
    return onHandAt(productId, t.lonLocationId);
  }

  async function onHandAt(productId: string, locationId: string) {
    const { data, error } = await t.service.from('inventory_balances')
      .select('on_hand,reserved').eq('product_id', productId).eq('location_id', locationId)
      .single<{ on_hand: number; reserved: number }>();
    if (error || !data) throw error ?? new Error('balance missing');
    return data;
  }

  async function stockIn(client: SupabaseClient, productId: string, locationId: string, quantity: number) {
    const stocked = await client.rpc('post_inventory_movement_with_notes', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: locationId,
      p_quantity_delta: quantity, p_movement_type: 'quick_stock_in', p_reason: null,
      p_inbound_unit_cost: 50, p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null, p_notes: null,
    });
    if (stocked.error) throw stocked.error;
  }

  async function productWithStockAt(client: SupabaseClient, locationId: string, quantity: number, priceInclGst = 110) {
    const { data: productId, error } = await t.admin.rpc('create_product_with_prices', {
      p_name: `Generic sale ${randomUUID()}`,
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: priceInclGst,
      p_wholesale_price_incl_gst: priceInclGst,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Generic',
      p_tyre_size: '295/80R22.5',
    });
    if (error || !productId) throw error ?? new Error('product creation failed');
    await stockIn(client, String(productId), locationId, quantity);
    return String(productId);
  }

  function sale(productId: string, quantity: number) {
    return t.lon.rpc('commit_sale', {
      p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.lonLocationId,
      p_items: [{ product_id: productId, quantity }],
    });
  }

  async function configureChannel(overrides: {
    provider: string;
    organizationId?: string;
    locationId?: string;
    source?: 'website' | 'stripe';
    orderNamespace?: string;
    expectedCurrency?: string;
  }) {
    const result = await t.admin.rpc('admin_upsert_sales_channel_config', {
      p_provider: overrides.provider,
      p_organization_id: overrides.organizationId ?? awtOrganizationId,
      p_location_id: overrides.locationId ?? t.lonLocationId,
      p_source: overrides.source ?? 'stripe',
      p_order_namespace: overrides.orderNamespace ?? 'awt-checkout',
      p_expected_currency: overrides.expectedCurrency ?? 'AUD',
      p_active: true,
    });
    if (result.error) throw result.error;
  }

  function webhook(overrides: {
    provider: string;
    eventId?: string;
    eventType?: string;
    externalOrderId?: string | null;
    amountTotal?: number | null;
    currency?: string | null;
    items: Array<{ product_id: string; quantity: number }>;
  }) {
    const items = overrides.items;
    return t.service.rpc('process_paid_sale_webhook', {
      p_provider: overrides.provider,
      p_event_id: overrides.eventId ?? `evt_${randomUUID()}`,
      p_event_type: overrides.eventType ?? 'checkout.session.completed',
      p_payload_hash: payloadHash(items),
      p_actor_user_id: t.adminUser.id,
      p_external_order_id: overrides.externalOrderId === undefined ? `ORDER-${randomUUID()}` : overrides.externalOrderId,
      p_amount_total: overrides.amountTotal === undefined ? null : overrides.amountTotal,
      p_currency: overrides.currency === undefined ? 'AUD' : overrides.currency,
      p_items: items,
    });
  }

  it('keeps the new authoritative tables RPC-only and manager assignments admin-only', async () => {
    expect((await t.anon().from('sales').select('*')).error).not.toBeNull();
    expect((await t.lon.from('sale_items').select('*')).error).not.toBeNull();
    expect((await t.lon.from('processed_webhook_events').select('*')).error).not.toBeNull();
    const other = await t.lon.rpc('admin_assign_organization_location', {
      p_organization_id: awtOrganizationId, p_location_id: t.regLocationId, p_active: true,
    });
    expect(other.error?.message).toContain('ACCESS_DENIED');
    const channelConfig = await t.lon.rpc('admin_upsert_sales_channel_config', {
      p_provider: `denied_${randomUUID().replace(/-/g, '')}`, p_organization_id: awtOrganizationId,
      p_location_id: t.lonLocationId, p_source: 'stripe', p_order_namespace: 'awt-checkout',
      p_expected_currency: 'AUD', p_active: true,
    });
    expect(channelConfig.error?.message).toContain('ACCESS_DENIED');
  });

  it('serializes competing 6 + 6 sales against stock of 10 so only one commits', async () => {
    const productId = await productWithStock(10);
    const results = await Promise.all([sale(productId, 6), sale(productId, 6)]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error?.message.includes('INSUFFICIENT_STOCK'))).toHaveLength(1);
    expect((await onHand(productId)).on_hand).toBe(4);
  });

  it('commits 2 + 3 racing sales against stock of 10 and leaves five', async () => {
    const productId = await productWithStock(10);
    const results = await Promise.all([sale(productId, 2), sale(productId, 3)]);
    expect(results.every((result) => result.error === null)).toBe(true);
    expect((await onHand(productId)).on_hand).toBe(5);
  });

  it('honours a simultaneous job reservation before committing a generic sale', async () => {
    const productId = await productWithStock(10);
    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: {
        customer_type: 'business', display_name: `Reserved fleet ${randomUUID()}`,
        company_name: 'Reserved Fleet', abn: '51824753556', mobile: '0400000002',
        street_address: '2 Test Street', suburb: 'Lonsdale', state: 'SA', postcode: '5160',
      },
    });
    if (customer.error) throw customer.error;
    const [job, sold] = await Promise.all([t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customer.data.customer_id, p_customer_vehicle_id: null,
      p_job: { source_type: 'direct' },
      p_lines: [{ line_type: 'product', product_id: productId, description: 'Reserved stock', quantity: 6 }],
    }), sale(productId, 5)]);
    expect([job, sold].filter(result => !result.error)).toHaveLength(1);
    expect([job, sold].find(result => result.error)?.error?.message).toContain('INSUFFICIENT_STOCK');
    expect(await onHand(productId)).toEqual(job.error
      ? { on_hand: 5, reserved: 0 }
      : { on_hand: 10, reserved: 6 });
    if (!job.error) {
      const cancelled = await t.lon.rpc('cancel_job', { p_job_id: job.data.job_id, p_expected_version: 1 });
      expect(cancelled.error).toBeNull();
    }
  });

  it('never lets a generic sale consume reserved stock: a job holding 9 of 10 leaves only 1 sellable', async () => {
    const productId = await productWithStock(10);
    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: {
        customer_type: 'business', display_name: `Reservation guard ${randomUUID()}`,
        company_name: 'Reservation Guard', abn: '51824753556', mobile: '0400000003',
        street_address: '3 Test Street', suburb: 'Lonsdale', state: 'SA', postcode: '5160',
      },
    });
    if (customer.error) throw customer.error;
    const job = await t.lon.rpc('create_job', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_customer_id: customer.data.customer_id, p_customer_vehicle_id: null,
      p_job: { source_type: 'direct' },
      p_lines: [{ line_type: 'product', product_id: productId, description: 'Reserved stock', quantity: 9 }],
    });
    expect(job.error).toBeNull();
    expect(await onHand(productId)).toEqual({ on_hand: 10, reserved: 9 });

    const overSell = await sale(productId, 2);
    expect(overSell.error?.message).toContain('INSUFFICIENT_STOCK');
    expect(await onHand(productId)).toEqual({ on_hand: 10, reserved: 9 });

    const exactSell = await sale(productId, 1);
    expect(exactSell.error).toBeNull();
    expect(await onHand(productId)).toEqual({ on_hand: 9, reserved: 9 });

    const cancelled = await t.lon.rpc('cancel_job', { p_job_id: job.data.job_id, p_expected_version: 1 });
    expect(cancelled.error).toBeNull();
  });

  it('does not allow a manager from another location to consume this organization location', async () => {
    const productId = await productWithStock(2);
    const denied = await t.reg.rpc('commit_sale', {
      p_request_id: randomUUID(), p_organization_id: truckOrganizationId, p_location_id: t.lonLocationId,
      p_items: [{ product_id: productId, quantity: 1 }],
    });
    expect(denied.error?.message).toContain('ACCESS_DENIED');
    expect((await onHand(productId)).on_hand).toBe(2);
  });

  it('replays a concurrent sale request once and rejects a changed quantity', async () => {
    const productId = await productWithStock(10);
    const input = {
      p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.lonLocationId,
      p_items: [{ product_id: productId, quantity: 2 }],
    };
    const results = await Promise.all([t.lon.rpc('commit_sale', input), t.lon.rpc('commit_sale', input)]);
    expect(results.every(result => !result.error)).toBe(true);
    expect(results[0].data.sale_id).toBe(results[1].data.sale_id);
    const mismatch = await t.lon.rpc('commit_sale', {
      ...input, p_items: [{ ...input.p_items[0], quantity: 3 }],
    });
    expect(mismatch.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    expect((await onHand(productId)).on_hand).toBe(8);
  });

  it('denies anonymous sales and non-service webhook execution under this role\'s real grants', async () => {
    const input = {
      p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.lonLocationId, p_items: [],
    };
    expect((await t.anon().rpc('commit_sale', input)).error?.code).toBe('42501');
    const webhookInput = {
      p_provider: 'stripe', p_event_id: randomUUID(), p_event_type: 'order.paid',
      p_payload_hash: payloadHash([]), p_actor_user_id: t.adminUser.id,
      p_external_order_id: randomUUID(), p_amount_total: 0, p_currency: 'AUD', p_items: [],
    };
    for (const client of [t.anon(), t.lon, t.admin]) {
      expect((await client.rpc('process_paid_sale_webhook', webhookInput)).error?.code).toBe('42501');
    }
  });

  it('derives price server-side and rejects a caller-supplied unit price', async () => {
    const productId = await productWithStock(10);
    const rejected = await t.lon.rpc('commit_sale', {
      p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.lonLocationId,
      p_items: [{ product_id: productId, quantity: 1, unit_price_incl_gst: 0 }],
    });
    expect(rejected.error?.message).toContain('INVALID_SALE_ITEM');
    expect((await onHand(productId)).on_hand).toBe(10);
  });

  it('accepts a two-decimal product price without losing cents (server-derived, not caller-supplied)', async () => {
    const productId = await productWithStock(10, 110.50);
    const result = await sale(productId, 2);
    expect(result.error).toBeNull();
    const stored = await t.service.from('sales').select('total_incl_gst').eq('id', result.data.sale_id).single();
    expect(stored.error).toBeNull();
    expect(Number(stored.data?.total_incl_gst)).toBe(221);
    expect((await onHand(productId)).on_hand).toBe(8);
  });

  it('rounds GST per line, matching the finance convention, not per unit then multiplied', async () => {
    const productId = await productWithStock(10, 0.05);
    const result = await t.lon.rpc('commit_sale', {
      p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.lonLocationId,
      p_items: [{ product_id: productId, quantity: 3 }],
    });
    expect(result.error).toBeNull();
    const item = await t.service.from('sale_items').select('tax_amount,line_total_incl_gst')
      .eq('sale_id', result.data.sale_id).single();
    expect(item.error).toBeNull();
    expect(Number(item.data?.line_total_incl_gst)).toBe(0.15);
    expect(Number(item.data?.tax_amount)).toBe(0.01);
  });

  it('rejects an unconfigured/unknown provider before persisting any event row', async () => {
    const productId = await productWithStock(5);
    const provider = `unknown_${randomUUID().replace(/-/g, '')}`;
    const result = await webhook({ provider, items: [{ product_id: productId, quantity: 1 }], amountTotal: 110 });
    expect(result.error?.message).toContain('UNKNOWN_PROVIDER');
    const events = await t.service.from('processed_webhook_events').select('id').eq('provider', provider);
    expect(events.data).toHaveLength(0);
    expect((await onHand(productId)).on_hand).toBe(5);
  });

  it('only an admin can bind a provider, and cannot bind it to an org/location pair without an active assignment', async () => {
    expect((await t.lon.rpc('admin_upsert_sales_channel_config', {
      p_provider: `staff_denied_${randomUUID().replace(/-/g, '')}`, p_organization_id: awtOrganizationId,
      p_location_id: t.lonLocationId, p_source: 'stripe', p_order_namespace: 'awt-checkout',
      p_expected_currency: 'AUD', p_active: true,
    })).error?.message).toContain('ACCESS_DENIED');

    // 247TRUCK has never been assigned to LON (only AWT and, separately,
    // 247TRUCK+REG and AWT+REG are active - REG legitimately has both
    // organizations, so this test must use a pair that is genuinely
    // unassigned, not REG+AWT).
    const unassigned = await t.admin.rpc('admin_upsert_sales_channel_config', {
      p_provider: `unassigned_${randomUUID().replace(/-/g, '')}`,
      p_organization_id: truckOrganizationId, p_location_id: t.lonLocationId,
      p_source: 'stripe', p_order_namespace: 'truck-checkout', p_expected_currency: 'AUD', p_active: true,
    });
    expect(unassigned.error?.message).toContain('ORGANIZATION_LOCATION_NOT_ASSIGNED');
  });

  it('treats the same external order as one sale, even through two channel aliases sharing a namespace', async () => {
    const providerA = `stripe_alias_a_${randomUUID().replace(/-/g, '')}`;
    const providerB = `stripe_alias_b_${randomUUID().replace(/-/g, '')}`;
    const namespace = `alias-ns-${randomUUID().slice(0, 8)}`;
    await configureChannel({ provider: providerA, orderNamespace: namespace });
    await configureChannel({ provider: providerB, orderNamespace: namespace, source: 'website' });
    const productId = await productWithStock(10);
    const externalOrderId = `WEB-${randomUUID()}`;
    const items = [{ product_id: productId, quantity: 2 }];

    const first = await webhook({ provider: providerA, externalOrderId, items, amountTotal: 220 });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: 'committed', webhook_status: 'completed' });
    const second = await webhook({ provider: providerB, externalOrderId, items, amountTotal: 220 });
    expect(second.error).toBeNull();
    expect((second.data as { replayed: boolean }).replayed).toBe(true);
    expect(second.data.sale_id).toBe(first.data.sale_id);
    expect((await onHand(productId)).on_hand).toBe(8);
    const movements = await t.service.from('inventory_movements').select('id')
      .eq('product_id', productId).eq('source_type', 'generic_sale');
    expect(movements.data).toHaveLength(1);
  });

  it('does not collide when an unrelated provider legitimately reuses the same external order string', async () => {
    const providerA = `standalone_a_${randomUUID().replace(/-/g, '')}`;
    const providerB = `standalone_b_${randomUUID().replace(/-/g, '')}`;
    await configureChannel({ provider: providerA, orderNamespace: `ns-a-${randomUUID().slice(0, 8)}` });
    await configureChannel({ provider: providerB, orderNamespace: `ns-b-${randomUUID().slice(0, 8)}` });
    const productA = await productWithStock(10);
    const productB = await productWithStock(10);
    const sharedExternalOrderId = `SHARED-${randomUUID()}`;

    const first = await webhook({
      provider: providerA, externalOrderId: sharedExternalOrderId,
      items: [{ product_id: productA, quantity: 1 }], amountTotal: 110,
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: 'committed', replayed: false });
    const second = await webhook({
      provider: providerB, externalOrderId: sharedExternalOrderId,
      items: [{ product_id: productB, quantity: 1 }], amountTotal: 110,
    });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ status: 'committed', replayed: false });
    expect(second.data.sale_id).not.toBe(first.data.sale_id);
    expect((await onHand(productA)).on_hand).toBe(9);
    expect((await onHand(productB)).on_hand).toBe(9);
  });

  it('serializes different webhook event IDs for the same business order', async () => {
    const provider = `serial_${randomUUID().replace(/-/g, '')}`;
    await configureChannel({ provider });
    const productId = await productWithStock(10);
    const externalOrderId = `review-${randomUUID()}`;
    const items = [{ product_id: productId, quantity: 2 }];
    const results = await Promise.all([randomUUID(), randomUUID()].map(eventId =>
      webhook({ provider, eventId, externalOrderId, items, amountTotal: 220, eventType: 'order.paid' })));
    for (const result of results) {
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ status: 'committed', webhook_status: 'completed' });
    }
    expect(results[0].data.sale_id).toBe(results[1].data.sale_id);
    expect((await onHand(productId)).on_hand).toBe(8);
    const events = await t.service.from('processed_webhook_events').select('id')
      .eq('external_order_id', externalOrderId);
    expect(events.data).toHaveLength(2);
    const movements = await t.service.from('inventory_movements').select('id')
      .eq('product_id', productId).eq('source_type', 'generic_sale');
    expect(movements.data).toHaveLength(1);
  });

  it('records duplicate paid events once, ignores refunds, and accepts one physical return', async () => {
    const provider = `dup_${randomUUID().replace(/-/g, '')}`;
    await configureChannel({ provider });
    const productId = await productWithStock(10);
    const items = [{ product_id: productId, quantity: 4 }];
    const eventId = `evt_generic_${randomUUID()}`;
    const externalOrderId = `STRIPE-${randomUUID()}`;

    const first = await webhook({ provider, eventId, externalOrderId, items, amountTotal: 440 });
    const replay = await webhook({ provider, eventId, externalOrderId, items, amountTotal: 440 });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: 'committed', webhook_status: 'completed' });
    expect(replay.error).toBeNull();
    expect((replay.data as { replayed: boolean }).replayed).toBe(true);
    expect((await onHand(productId)).on_hand).toBe(6);

    const refund = await webhook({
      provider, eventId: `evt_generic_refund_${randomUUID()}`, eventType: 'charge.refunded',
      externalOrderId, items: [], amountTotal: null,
    });
    expect(refund.error).toBeNull();
    expect((refund.data as { status: string }).status).toBe('ignored');
    expect((await onHand(productId)).on_hand).toBe(6);

    const returnRequestId = randomUUID();
    const returned = await t.lon.rpc('post_customer_return_movement', {
      p_request_id: returnRequestId, p_product_id: productId, p_location_id: t.lonLocationId,
      p_quantity: 1, p_reason: 'Physical return received', p_unit_cost: null,
      p_credit_note_id: null, p_notes: null,
    });
    const returnReplay = await t.lon.rpc('post_customer_return_movement', {
      p_request_id: returnRequestId, p_product_id: productId, p_location_id: t.lonLocationId,
      p_quantity: 1, p_reason: 'Physical return received', p_unit_cost: null,
      p_credit_note_id: null, p_notes: null,
    });
    expect(returned.error).toBeNull();
    expect(returnReplay.error).toBeNull();
    expect((await onHand(productId)).on_hand).toBe(7);
  });

  it('requires a business order identity before a paid webhook can consume stock', async () => {
    const provider = `orderreq_${randomUUID().replace(/-/g, '')}`;
    await configureChannel({ provider });
    const productId = await productWithStock(10);
    const items = [{ product_id: productId, quantity: 2 }];
    for (const orderId of [null, '', '   ']) {
      const result = await webhook({ provider, externalOrderId: orderId, items, amountTotal: 220 });
      expect(result.error?.message).toContain('WEBHOOK_ORDER_REQUIRED');
    }
    expect((await onHand(productId)).on_hand).toBe(10);
  });

  it('rejects a payment amount that does not match the computed sale total', async () => {
    const provider = `amount_${randomUUID().replace(/-/g, '')}`;
    await configureChannel({ provider });
    const productId = await productWithStock(10);
    const eventId = randomUUID();
    const result = await webhook({
      provider, eventId, items: [{ product_id: productId, quantity: 2 }], amountTotal: 1,
    });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ status: 'failed', error_code: '22023' });
    expect((await onHand(productId)).on_hand).toBe(10);
    const event = await t.service.from('processed_webhook_events').select('status,error_message')
      .eq('provider', provider).eq('event_id', eventId).single();
    expect(event.data).toMatchObject({ status: 'failed', error_message: 'PAYMENT_AMOUNT_MISMATCH' });
  });

  it('rejects a currency that does not match the configured provider currency', async () => {
    const provider = `currency_${randomUUID().replace(/-/g, '')}`;
    await configureChannel({ provider, expectedCurrency: 'AUD' });
    const productId = await productWithStock(10);
    const result = await webhook({ provider, items: [{ product_id: productId, quantity: 1 }], amountTotal: 110, currency: 'USD' });
    expect(result.error?.message).toContain('PAYMENT_CURRENCY_MISMATCH');
    expect((await onHand(productId)).on_hand).toBe(10);
  });

  it('rolls back the entire sale when a later product lacks stock and retains the failed event', async () => {
    const provider = `rollback_${randomUUID().replace(/-/g, '')}`;
    await configureChannel({ provider });
    const productIds = [await productWithStock(10), await productWithStock(10)].sort();
    const items = productIds.map((productId, i) => ({ product_id: productId, quantity: i === 0 ? 2 : 11 }));
    const eventId = randomUUID();
    const result = await webhook({ provider, eventId, items, amountTotal: 1320 });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ status: 'failed' });
    for (const id of productIds) expect((await onHand(id)).on_hand).toBe(10);
    const event = await t.service.from('processed_webhook_events').select('status,sale_id,error_message')
      .eq('provider', provider).eq('event_id', eventId).single();
    expect(event.error).toBeNull();
    expect(event.data).toMatchObject({ status: 'failed', sale_id: null, error_message: 'INSUFFICIENT_STOCK' });
    const movements = await t.service.from('inventory_movements').select('id')
      .in('product_id', productIds).eq('source_type', 'generic_sale');
    expect(movements.error).toBeNull();
    expect(movements.data).toHaveLength(0);
  });

  it('lets a shared catalogue product carry stock in both organizations without merging their balances', async () => {
    const productId = await productWithStockAt(t.reg, t.regLocationId, 3);

    // Zero-balance rows are seeded at every location for a shared product
    // (owner_location_id null), so selling at LON before it has stock fails
    // on quantity, not on a missing product/location relationship - and
    // REG's stock must be completely unaffected by the attempt.
    const deniedAtLon = await sale(productId, 1);
    expect(deniedAtLon.error?.message).toContain('INSUFFICIENT_STOCK');
    expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(3);

    await stockIn(t.lon, productId, t.lonLocationId, 4);
    const soldAtLon = await sale(productId, 1);
    expect(soldAtLon.error).toBeNull();
    expect((await onHandAt(productId, t.lonLocationId)).on_hand).toBe(3);
    // Org 247TRUCK's own sale must never touch AWT's balance for the same
    // global catalogue Product ID.
    expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(3);

    // And symmetrically: 247TRUCK's own sale at REG must never touch AWT's
    // balance for the same global catalogue Product ID.
    const soldAtReg = await t.reg.rpc('commit_sale', {
      p_request_id: randomUUID(), p_organization_id: truckOrganizationId, p_location_id: t.regLocationId,
      p_items: [{ product_id: productId, quantity: 1 }],
    });
    expect(soldAtReg.error).toBeNull();
    expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(2);
    expect((await onHandAt(productId, t.lonLocationId)).on_hand).toBe(3);
  });

  it('does not let a manager read another organization\'s location balance row directly', async () => {
    const productId = await productWithStockAt(t.lon, t.lonLocationId, 4);
    const foreignRead = await t.reg.from('inventory_balances').select('on_hand')
      .eq('product_id', productId).eq('location_id', t.lonLocationId);
    expect(foreignRead.error).toBeNull();
    expect(foreignRead.data).toHaveLength(0);
  });

  it('denies selling a workspace-owned product transferred into a foreign organization\'s location, and allows it at its own', async () => {
    const created = await t.admin.rpc('create_workspace_product', {
      p_location_id: t.lonLocationId,
      p_name: `Workspace isolation ${randomUUID()}`,
      p_retail_price_incl_gst: 110,
    });
    expect(created.error).toBeNull();
    const productId = String(created.data);
    await stockIn(t.lon, productId, t.lonLocationId, 5);

    // Move 2 units from LON (AWT-owned product's own location) to REG
    // (247TRUCK) through the pre-existing, organization-unaware transfer
    // feature. This is the real mechanism that can create a stray
    // inventory_balances row for a workspace-owned product at a foreign
    // organization's location; commit_sale must not trust that row alone.
    const transferNumber = await t.admin.rpc('create_transfer_request', {
      p_source_location_id: t.lonLocationId, p_destination_location_id: t.regLocationId,
      p_notes: null, p_lines: [{ product_id: productId, requested_quantity: 2 }],
    });
    expect(transferNumber.error).toBeNull();
    const transferRow = await t.service.from('stock_transfers').select('id')
      .eq('transfer_number', transferNumber.data as string).single<{ id: string }>();
    expect(transferRow.error).toBeNull();
    const transferId = transferRow.data!.id;
    expect((await t.admin.rpc('submit_transfer_request', { p_transfer_id: transferId })).error).toBeNull();
    expect((await t.admin.rpc('approve_transfer', { p_transfer_id: transferId })).error).toBeNull();
    expect((await t.admin.rpc('dispatch_transfer', {
      p_transfer_id: transferId, p_request_id: randomUUID(),
    })).error).toBeNull();
    expect((await t.admin.rpc('receive_transfer', {
      p_transfer_id: transferId, p_request_id: randomUUID(),
      p_receipts: [{ product_id: productId, received_quantity: 2 }],
    })).error).toBeNull();
    expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(2);

    // 247TRUCK now genuinely holds a balance row for this product, but the
    // product itself is owned by AWT's location. Selling it at REG must
    // still be denied before any sale/item/movement row is written.
    const denied = await t.reg.rpc('commit_sale', {
      p_request_id: randomUUID(), p_organization_id: truckOrganizationId, p_location_id: t.regLocationId,
      p_items: [{ product_id: productId, quantity: 1 }],
    });
    expect(denied.error?.message).toContain('PRODUCT_NOT_AVAILABLE_AT_LOCATION');
    expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(2);
    const saleItemsForProduct = await t.service.from('sale_items').select('id').eq('product_id', productId);
    expect(saleItemsForProduct.data).toHaveLength(0);
    const movementsAtReg = await t.service.from('inventory_movements').select('id')
      .eq('product_id', productId).eq('location_id', t.regLocationId).eq('source_type', 'generic_sale');
    expect(movementsAtReg.data).toHaveLength(0);

    // The same product remains sellable at its own organization's location.
    const allowed = await t.lon.rpc('commit_sale', {
      p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.lonLocationId,
      p_items: [{ product_id: productId, quantity: 1 }],
    });
    expect(allowed.error).toBeNull();
    expect((await onHandAt(productId, t.lonLocationId)).on_hand).toBe(2);
  });

  describe('shared-location multi-organization sales (REG serves both businesses)', () => {
    it('lets 247TRUCK and AWT both hold an active assignment at REG simultaneously', async () => {
      const assignments = await t.service.from('organization_location_assignments')
        .select('organization_id,active').eq('location_id', t.regLocationId);
      expect(assignments.error).toBeNull();
      const active = new Set((assignments.data ?? []).filter((a) => a.active).map((a) => a.organization_id));
      expect(active.has(truckOrganizationId)).toBe(true);
      expect(active.has(awtOrganizationId)).toBe(true);
    });

    it('does not create a duplicate assignment row when the same org/location pair is assigned again', async () => {
      const before = await t.service.from('organization_location_assignments')
        .select('organization_id').eq('location_id', t.regLocationId).eq('organization_id', truckOrganizationId);
      const reassigned = await t.admin.rpc('admin_assign_organization_location', {
        p_organization_id: truckOrganizationId, p_location_id: t.regLocationId, p_active: true,
      });
      expect(reassigned.error).toBeNull();
      const after = await t.service.from('organization_location_assignments')
        .select('organization_id').eq('location_id', t.regLocationId).eq('organization_id', truckOrganizationId);
      expect(before.data).toHaveLength(1);
      expect(after.data).toHaveLength(1);
    });

    it('deactivating one organization at REG does not deactivate the other', async () => {
      const deactivated = await t.admin.rpc('admin_assign_organization_location', {
        p_organization_id: awtOrganizationId, p_location_id: t.regLocationId, p_active: false,
      });
      expect(deactivated.error).toBeNull();
      const rows = await t.service.from('organization_location_assignments')
        .select('organization_id,active').eq('location_id', t.regLocationId);
      const truckRow = rows.data?.find((r) => r.organization_id === truckOrganizationId);
      const awtRow = rows.data?.find((r) => r.organization_id === awtOrganizationId);
      expect(truckRow?.active).toBe(true);
      expect(awtRow?.active).toBe(false);

      // An AWT sale at REG is now correctly denied while the assignment is inactive.
      const productId = await productWithStockAt(t.reg, t.regLocationId, 5);
      const deniedWhileInactive = await t.reg.rpc('commit_sale', {
        p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 1 }],
      });
      expect(deniedWhileInactive.error?.message).toContain('ORGANIZATION_LOCATION_NOT_ASSIGNED');
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(5);

      // Restore it for the remaining tests in this suite.
      const reactivated = await t.admin.rpc('admin_assign_organization_location', {
        p_organization_id: awtOrganizationId, p_location_id: t.regLocationId, p_active: true,
      });
      expect(reactivated.error).toBeNull();
    });

    it('lets two organizations sell the same physical REG stock without splitting the balance row', async () => {
      const productId = await productWithStockAt(t.reg, t.regLocationId, 10);

      const truckSale = await t.reg.rpc('commit_sale', {
        p_request_id: randomUUID(), p_organization_id: truckOrganizationId, p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 2 }],
      });
      expect(truckSale.error).toBeNull();
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(8);

      const awtSale = await t.reg.rpc('commit_sale', {
        p_request_id: randomUUID(), p_organization_id: awtOrganizationId, p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 3 }],
      });
      expect(awtSale.error).toBeNull();
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(5);

      expect(truckSale.data.sale_id).not.toBe(awtSale.data.sale_id);

      // Sale attribution is correct and distinct for each sale.
      const rows = await t.service.from('sales').select('id,organization_id,location_id')
        .in('id', [truckSale.data.sale_id, awtSale.data.sale_id]);
      const truckRow = rows.data?.find((r) => r.id === truckSale.data.sale_id);
      const awtRow = rows.data?.find((r) => r.id === awtSale.data.sale_id);
      expect(truckRow).toMatchObject({ organization_id: truckOrganizationId, location_id: t.regLocationId });
      expect(awtRow).toMatchObject({ organization_id: awtOrganizationId, location_id: t.regLocationId });

      // Exactly one physical inventory_balances row for this product at REG -
      // stock is one shared pool, never split or duplicated by organization.
      const balanceRows = await t.service.from('inventory_balances').select('product_id')
        .eq('product_id', productId).eq('location_id', t.regLocationId);
      expect(balanceRows.data).toHaveLength(1);
    });

    it('lets both authorized businesses sell a REG workspace product from one stock balance', async () => {
      const created = await t.admin.rpc('create_workspace_product', {
        p_location_id: t.regLocationId, p_name: `Shared REG workspace ${randomUUID()}`,
        p_retail_price_incl_gst: 110,
      });
      expect(created.error).toBeNull();
      const productId = String(created.data);
      await stockIn(t.reg, productId, t.regLocationId, 2);

      for (const organizationId of [truckOrganizationId, awtOrganizationId]) {
        const sale = await t.reg.rpc('commit_sale', {
          p_request_id: randomUUID(), p_organization_id: organizationId,
          p_location_id: t.regLocationId,
          p_items: [{ product_id: productId, quantity: 1 }],
        });
        expect(sale.error).toBeNull();
      }
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(0);
    });

    it('rejects an organization with no active assignment at the selling location', async () => {
      const productId = await productWithStockAt(t.reg, t.regLocationId, 5);
      // truckOrganizationId has never been assigned to LON.
      const denied = await t.lon.rpc('commit_sale', {
        p_request_id: randomUUID(), p_organization_id: truckOrganizationId, p_location_id: t.lonLocationId,
        p_items: [{ product_id: productId, quantity: 1 }],
      });
      expect(denied.error?.message).toContain('ORGANIZATION_LOCATION_NOT_ASSIGNED');
    });

    it('rejects a caller-supplied organization id that does not exist at all (attack case)', async () => {
      const productId = await productWithStockAt(t.reg, t.regLocationId, 5);
      const denied = await t.reg.rpc('commit_sale', {
        p_request_id: randomUUID(), p_organization_id: randomUUID(), p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 1 }],
      });
      expect(denied.error?.message).toContain('ORGANIZATION_LOCATION_NOT_ASSIGNED');
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(5);
      const sales = await t.service.from('sales').select('id').eq('location_id', t.regLocationId)
        .eq('organization_id', truckOrganizationId).is('external_order_id', null);
      // No sale row exists for the rejected attempt (a random org id can never
      // match an existing sale row, this just documents the fail-closed shape).
      expect(sales.error).toBeNull();
    });

    it('denies a real organization/location pair when the actor is not authorized at that location (attack case)', async () => {
      const productId = await productWithStockAt(t.reg, t.regLocationId, 5);
      // t.lon's manager is only authorized at LON. 247TRUCK+REG is a genuine,
      // active assignment - but naming it from the wrong actor must still fail.
      const denied = await t.lon.rpc('commit_sale', {
        p_request_id: randomUUID(), p_organization_id: truckOrganizationId, p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 1 }],
      });
      expect(denied.error?.message).toContain('ACCESS_DENIED');
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(5);
    });

    it('does not let one organization\'s sale request identity collide with another organization\'s', async () => {
      const productId = await productWithStockAt(t.reg, t.regLocationId, 5);
      const requestId = randomUUID();
      const truckSale = await t.reg.rpc('commit_sale', {
        p_request_id: requestId, p_organization_id: truckOrganizationId, p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 1 }],
      });
      expect(truckSale.error).toBeNull();
      // Reusing the same request_id (same actor + location) for a different
      // organization is rejected loudly, never silently reattributed.
      const reused = await t.reg.rpc('commit_sale', {
        p_request_id: requestId, p_organization_id: awtOrganizationId, p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 1 }],
      });
      expect(reused.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(4);
    });

    it('does not collide two organizations legitimately reusing the same external order id at the shared REG location', async () => {
      const providerTruck = `reg_truck_${randomUUID().replace(/-/g, '')}`;
      const providerAwt = `reg_awt_${randomUUID().replace(/-/g, '')}`;
      await configureChannel({
        provider: providerTruck, organizationId: truckOrganizationId, locationId: t.regLocationId,
        orderNamespace: `truck-ns-${randomUUID().slice(0, 8)}`,
      });
      await configureChannel({
        provider: providerAwt, organizationId: awtOrganizationId, locationId: t.regLocationId,
        orderNamespace: `awt-ns-${randomUUID().slice(0, 8)}`,
      });
      const productTruck = await productWithStockAt(t.reg, t.regLocationId, 10);
      const productAwt = await productWithStockAt(t.reg, t.regLocationId, 10);
      const sharedExternalOrderId = `SHARED-REG-${randomUUID()}`;

      const truckEvent = await webhook({
        provider: providerTruck, externalOrderId: sharedExternalOrderId,
        items: [{ product_id: productTruck, quantity: 1 }], amountTotal: 110,
      });
      expect(truckEvent.error).toBeNull();
      expect(truckEvent.data).toMatchObject({ status: 'committed', replayed: false });
      const awtEvent = await webhook({
        provider: providerAwt, externalOrderId: sharedExternalOrderId,
        items: [{ product_id: productAwt, quantity: 1 }], amountTotal: 110,
      });
      expect(awtEvent.error).toBeNull();
      expect(awtEvent.data).toMatchObject({ status: 'committed', replayed: false });
      expect(awtEvent.data.sale_id).not.toBe(truckEvent.data.sale_id);

      const truckSaleRow = await t.service.from('sales').select('organization_id')
        .eq('id', truckEvent.data.sale_id).single();
      const awtSaleRow = await t.service.from('sales').select('organization_id')
        .eq('id', awtEvent.data.sale_id).single();
      expect(truckSaleRow.data?.organization_id).toBe(truckOrganizationId);
      expect(awtSaleRow.data?.organization_id).toBe(awtOrganizationId);
      expect((await onHandAt(productTruck, t.regLocationId)).on_hand).toBe(9);
      expect((await onHandAt(productAwt, t.regLocationId)).on_hand).toBe(9);
    });

    it('confirms the old location-derived commit_sale signature no longer exists', async () => {
      const productId = await productWithStockAt(t.reg, t.regLocationId, 5);
      // The pre-shared-location 3-argument shape (no p_organization_id) must
      // be gone, not merely superseded - calling it should fail as an unknown
      // function/overload, not silently succeed with a guessed organization.
      const oldShape = await t.reg.rpc('commit_sale', {
        p_request_id: randomUUID(), p_location_id: t.regLocationId,
        p_items: [{ product_id: productId, quantity: 1 }],
      });
      expect(oldShape.error).not.toBeNull();
      expect((await onHandAt(productId, t.regLocationId)).on_hand).toBe(5);
    });
  });
});
