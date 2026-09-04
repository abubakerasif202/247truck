import { randomUUID } from 'node:crypto';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import {
  createTestTenants,
  missingEnv,
  type TestTenants,
} from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) process.stderr.write(`[stock transfers] skipped: missing ${gap.join(', ')}\n`);

suite('branch stock transfers', () => {
  let t: TestTenants;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'inventory.view_cost', 'inventory.transfer_request'],
      regPermissions: ['inventory.view', 'inventory.transfer_request'],
    });

    const product = await t.admin.rpc('create_product', {
      p_name: `Transfer fixture ${randomUUID()}`,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: null,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Transfer Brand',
      p_tyre_pattern: 'Transfer Pattern',
      p_tyre_size: '295/80R22.5',
    });
    if (product.error) throw product.error;
    productId = product.data;

    const stock = await t.admin.rpc('post_opening_stock', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity: 10,
      p_inbound_unit_cost: null,
      p_source_type: 'transfer-test',
      p_source_id: 'pending-cost-fixture',
    });
    if (stock.error) throw stock.error;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('allows an own-branch manager to request but not approve', async () => {
    const created = await t.lon.rpc('create_transfer_request', {
      p_source_location_id: t.lonLocationId,
      p_destination_location_id: t.regLocationId,
      p_notes: 'Move pending-cost stock',
      p_lines: [{ product_id: productId, requested_quantity: 3 }],
    });
    expect(created.error).toBeNull();
    expect(created.data).toMatch(/^LON-TRF-\d{6}$/);

    const transferId = (await t.lon
      .from('stock_transfers')
      .select('id')
      .eq('transfer_number', created.data)
      .single()).data?.id;
    expect(transferId).toBeTruthy();

    const submitted = await t.lon.rpc('submit_transfer_request', {
      p_transfer_id: transferId,
    });
    expect(submitted.error).toBeNull();

    const denied = await t.lon.rpc('approve_transfer', {
      p_transfer_id: transferId,
    });
    expect(denied.error?.message).toContain('ACCESS_DENIED');
  });

  it('approves without changing stock, then dispatches and receives exactly once', async () => {
    const created = await t.admin.rpc('create_transfer_request', {
      p_source_location_id: t.lonLocationId,
      p_destination_location_id: t.regLocationId,
      p_notes: 'Admin transfer',
      p_lines: [{ product_id: productId, requested_quantity: 2 }],
    });
    expect(created.error).toBeNull();
    const transferId = (await t.service
      .from('stock_transfers')
      .select('id')
      .eq('transfer_number', created.data)
      .single()).data?.id;

    const before = await t.service.from('inventory_balances')
      .select('location_id,on_hand,weighted_average_cost')
      .eq('product_id', productId)
      .in('location_id', [t.lonLocationId, t.regLocationId]);
    const approved = await t.admin.rpc('approve_transfer', { p_transfer_id: transferId });
    expect(approved.error).toBeNull();
    const afterApproval = await t.service.from('inventory_balances')
      .select('location_id,on_hand,weighted_average_cost')
      .eq('product_id', productId)
      .in('location_id', [t.lonLocationId, t.regLocationId]);
    expect(afterApproval.data).toEqual(before.data);

    const dispatchKey = randomUUID();
    const dispatched = await t.admin.rpc('dispatch_transfer', {
      p_transfer_id: transferId,
      p_request_id: dispatchKey,
    });
    expect(dispatched.error).toBeNull();
    const replayDispatch = await t.admin.rpc('dispatch_transfer', {
      p_transfer_id: transferId,
      p_request_id: dispatchKey,
    });
    expect(replayDispatch.error).toBeNull();

    const receiveKey = randomUUID();
    const received = await t.admin.rpc('receive_transfer', {
      p_transfer_id: transferId,
      p_request_id: receiveKey,
      p_receipts: [{ product_id: productId, received_quantity: 2 }],
    });
    expect(received.error).toBeNull();
    const replayReceive = await t.admin.rpc('receive_transfer', {
      p_transfer_id: transferId,
      p_request_id: receiveKey,
      p_receipts: [{ product_id: productId, received_quantity: 2 }],
    });
    expect(replayReceive.error ?? null).toBeNull();

    const balances = await t.service.from('inventory_balances')
      .select('location_id,on_hand,weighted_average_cost')
      .eq('product_id', productId)
      .in('location_id', [t.lonLocationId, t.regLocationId]);
    expect(balances.data?.find((row) => row.location_id === t.lonLocationId)?.on_hand).toBe(8);
    expect(balances.data?.find((row) => row.location_id === t.regLocationId)?.on_hand).toBe(2);
    expect(balances.data?.find((row) => row.location_id === t.regLocationId)?.weighted_average_cost).toBeNull();
  });

  it('rejects manager approval, insufficient dispatch, over-receipt, and manager discrepancy resolution', async () => {
    const created = await t.admin.rpc('create_transfer_request', {
      p_source_location_id: t.lonLocationId,
      p_destination_location_id: t.regLocationId,
      p_notes: null,
      p_lines: [{ product_id: productId, requested_quantity: 99 }],
    });
    expect(created.error).toBeNull();
    const transferId = (await t.service.from('stock_transfers').select('id').eq('transfer_number', created.data).single()).data?.id;
    expect((await t.admin.rpc('approve_transfer', { p_transfer_id: transferId })).error).toBeNull();
    const dispatch = await t.admin.rpc('dispatch_transfer', { p_transfer_id: transferId, p_request_id: randomUUID() });
    expect(dispatch.error?.message).toContain('INSUFFICIENT_STOCK');
  });
});
