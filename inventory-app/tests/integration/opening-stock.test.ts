import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[opening stock] skipped: missing ${gap.join(', ')}\n`);
}

suite('Admin-only opening stock ledger path', () => {
  let t: TestTenants;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'inventory.stock_in'],
      regPermissions: ['inventory.view', 'inventory.stock_in'],
    });

    const { data, error } = await t.admin.rpc('create_product', {
      p_name: 'Opening stock test 295/80R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: null,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Opening Test',
      p_tyre_pattern: 'OT1',
      p_tyre_size: '295/80R22.5',
    });
    if (error || !data) throw error ?? new Error('opening product create failed');
    productId = data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('posts positive Regency Park opening stock with genuinely unknown cost', async () => {
    const requestId = randomUUID();
    const result = await t.admin.rpc('post_opening_stock', {
      p_request_id: requestId,
      p_product_id: productId,
      p_location_id: t.regLocationId,
      p_quantity: 12,
      p_inbound_unit_cost: null,
      p_source_type: 'opening_stock_import',
      p_source_id: 'source-row-1',
    });
    expect(result.error).toBeNull();

    const { data: balances } = await t.service
      .from('inventory_balances')
      .select('location_id, on_hand, weighted_average_cost')
      .eq('product_id', productId);
    const reg = balances?.find((row) => row.location_id === t.regLocationId);
    const lon = balances?.find((row) => row.location_id === t.lonLocationId);
    expect(reg?.on_hand).toBe(12);
    expect(reg?.weighted_average_cost).toBeNull();
    expect(lon?.on_hand).toBe(0);

    const { data: movement } = await t.service
      .from('inventory_movements')
      .select('id, movement_type, inbound_unit_cost, cost_snapshot, quantity_delta')
      .eq('request_id', requestId)
      .single();
    expect(movement).toMatchObject({
      movement_type: 'opening_stock',
      inbound_unit_cost: null,
      cost_snapshot: null,
      quantity_delta: 12,
    });

    const { data: audit } = await t.service
      .from('audit_events')
      .select('event_type, entity_id')
      .eq('entity_id', movement!.id)
      .eq('event_type', 'OPENING_STOCK_POSTED');
    expect(audit).toHaveLength(1);

    const replay = await t.admin.rpc('post_opening_stock', {
      p_request_id: requestId,
      p_product_id: productId,
      p_location_id: t.regLocationId,
      p_quantity: 12,
      p_inbound_unit_cost: null,
      p_source_type: 'opening_stock_import',
      p_source_id: 'source-row-1',
    });
    expect(replay.error).toBeNull();

    const { data: replayBalance } = await t.service
      .from('inventory_balances')
      .select('on_hand')
      .eq('product_id', productId)
      .eq('location_id', t.regLocationId)
      .single();
    expect(replayBalance?.on_hand).toBe(12);
  });

  it('denies Managers even when they have ordinary Stock In permission', async () => {
    const attempt = await t.reg.rpc('post_opening_stock', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.regLocationId,
      p_quantity: 1,
      p_inbound_unit_cost: null,
      p_source_type: 'opening_stock_import',
      p_source_id: 'manager-attempt',
    });
    expect(attempt.error?.message).toContain('ACCESS_DENIED');
  });

  it('rejects invalid quantity and negative cost', async () => {
    for (const quantity of [0, -1]) {
      const result = await t.admin.rpc('post_opening_stock', {
        p_request_id: randomUUID(),
        p_product_id: productId,
        p_location_id: t.regLocationId,
        p_quantity: quantity,
        p_inbound_unit_cost: null,
        p_source_type: 'opening_stock_import',
        p_source_id: `bad-qty-${quantity}`,
      });
      expect(result.error?.message).toContain('INVALID_OPENING_QUANTITY');
    }

    const cost = await t.admin.rpc('post_opening_stock', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.regLocationId,
      p_quantity: 1,
      p_inbound_unit_cost: -0.01,
      p_source_type: 'opening_stock_import',
      p_source_id: 'bad-cost',
    });
    expect(cost.error?.message).toContain('INVALID_COST');
  });

  it('does not allow opening stock through the generic movement RPC', async () => {
    const result = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.regLocationId,
      p_quantity_delta: 1,
      p_movement_type: 'opening_stock',
      p_reason: null,
      p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null,
      p_source_type: 'bypass',
      p_source_id: 'bypass',
      p_supplier_name: null,
    });
    expect(result.error?.message).toContain('OPENING_STOCK_REQUIRES_IMPORT_PATH');
  });

  it('still requires known cost for ordinary Quick Stock In', async () => {
    const result = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 1,
      p_movement_type: 'quick_stock_in',
      p_reason: null,
      p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null,
      p_source_type: 'quick_stock_in',
      p_source_id: null,
      p_supplier_name: null,
    });
    expect(result.error?.message).toContain('INBOUND_COST_REQUIRED');
  });

  it('assigns opening cost later and reconstructs current WAC without mutating history', async () => {
    const { data: created, error: createError } = await t.admin.rpc('create_product', {
      p_name: 'Delayed cost timeline 11R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: null,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Timeline',
      p_tyre_pattern: 'TC1',
      p_tyre_size: '11R22.5',
    });
    if (createError || !created) throw createError ?? new Error('timeline product create failed');
    const timelineProductId = created as string;

    const openingRequest = randomUUID();
    const opening = await t.admin.rpc('post_opening_stock', {
      p_request_id: openingRequest,
      p_product_id: timelineProductId,
      p_location_id: t.lonLocationId,
      p_quantity: 10,
      p_inbound_unit_cost: null,
      p_source_type: 'opening_stock_import',
      p_source_id: 'timeline-opening',
    });
    expect(opening.error).toBeNull();

    const quickIn = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: timelineProductId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 10,
      p_movement_type: 'quick_stock_in',
      p_reason: null,
      p_inbound_unit_cost: 500,
      p_used_tyre_unit_id: null,
      p_source_type: 'timeline',
      p_source_id: 'receipt-1',
      p_supplier_name: 'Timeline Supplier',
    });
    expect(quickIn.error).toBeNull();

    const stockOut = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: timelineProductId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: -2,
      p_movement_type: 'stock_out',
      p_reason: 'damaged',
      p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null,
      p_source_type: 'timeline',
      p_source_id: 'out-1',
      p_supplier_name: null,
    });
    expect(stockOut.error).toBeNull();

    const { data: unresolvedBalance } = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', timelineProductId)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(unresolvedBalance?.on_hand).toBe(18);
    expect(unresolvedBalance?.weighted_average_cost).toBeNull();

    const { data: openingMovement } = await t.service
      .from('inventory_movements')
      .select('id, inbound_unit_cost, cost_snapshot')
      .eq('request_id', openingRequest)
      .single();
    expect(openingMovement?.inbound_unit_cost).toBeNull();
    expect(openingMovement?.cost_snapshot).toBeNull();

    const pending = await t.admin.rpc('list_pending_opening_costs', {
      p_product_id: timelineProductId,
      p_location_id: t.lonLocationId,
    });
    expect(pending.error).toBeNull();
    expect(pending.data).toEqual([
      expect.objectContaining({
        movement_id: openingMovement!.id,
        quantity: 10,
      }),
    ]);

    const assigned = await t.admin.rpc('assign_opening_stock_cost', {
      p_opening_movement_id: openingMovement!.id,
      p_unit_cost: 400,
    });
    expect(assigned.error).toBeNull();

    const { data: resolvedBalance } = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', timelineProductId)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(resolvedBalance?.on_hand).toBe(18);
    expect(Number(resolvedBalance?.weighted_average_cost)).toBe(450);

    const { data: unchangedOpening } = await t.service
      .from('inventory_movements')
      .select('inbound_unit_cost, cost_snapshot')
      .eq('id', openingMovement!.id)
      .single();
    expect(unchangedOpening).toEqual({ inbound_unit_cost: null, cost_snapshot: null });

    const { data: assignment } = await t.service
      .from('opening_stock_cost_assignments')
      .select('unit_cost, assigned_by')
      .eq('opening_movement_id', openingMovement!.id)
      .single();
    expect(Number(assignment?.unit_cost)).toBe(400);
    expect(assignment?.assigned_by).toBe(t.adminUser.id);

    const { data: audit } = await t.service
      .from('audit_events')
      .select('event_type')
      .eq('entity_id', openingMovement!.id)
      .eq('event_type', 'OPENING_STOCK_COST_ASSIGNED');
    expect(audit).toHaveLength(1);

    const second = await t.admin.rpc('assign_opening_stock_cost', {
      p_opening_movement_id: openingMovement!.id,
      p_unit_cost: 410,
    });
    expect(second.error?.message).toContain('OPENING_COST_ALREADY_ASSIGNED');

    const manager = await t.lon.rpc('assign_opening_stock_cost', {
      p_opening_movement_id: openingMovement!.id,
      p_unit_cost: 410,
    });
    expect(manager.error?.message).toContain('ACCESS_DENIED');
  });
});
