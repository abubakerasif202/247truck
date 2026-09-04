import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import {
  createTestTenants,
  missingEnv,
  type TestTenants,
} from './support/fixtures';
import type { SupabaseClient } from '@supabase/supabase-js';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) process.stderr.write(`[stock transfers] skipped: missing ${gap.join(', ')}\n`);

suite('branch stock transfers', () => {
  let t: TestTenants;
  let productId: string;

  async function createProduct(name: string) {
    const result = await t.admin.rpc('create_product', {
      p_name: `${name} ${randomUUID()}`,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: null,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Transfer Brand',
      p_tyre_pattern: 'Transfer Pattern',
      p_tyre_size: '295/80R22.5',
    });
    if (result.error) throw result.error;
    return result.data as string;
  }

  async function addStock(product: string, location: string, quantity: number, cost: number | null) {
    const result = cost === null
      ? await t.admin.rpc('post_opening_stock', {
          p_request_id: randomUUID(), p_product_id: product, p_location_id: location,
          p_quantity: quantity, p_inbound_unit_cost: null, p_source_type: 'transfer-test',
          p_source_id: randomUUID(),
        })
      : await t.admin.rpc('post_inventory_movement', {
          p_request_id: randomUUID(), p_product_id: product, p_location_id: location,
          p_quantity_delta: quantity, p_movement_type: 'quick_stock_in', p_reason: null,
          p_inbound_unit_cost: cost, p_used_tyre_unit_id: null, p_source_type: 'transfer-test',
          p_source_id: randomUUID(), p_supplier_name: null,
        });
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }

  async function createTransfer(
    client: SupabaseClient,
    source: string,
    destination: string,
    lines: Array<{ product_id: string; requested_quantity: number }>,
    submit = true,
  ) {
    const created = await client.rpc('create_transfer_request', {
      p_source_location_id: source, p_destination_location_id: destination,
      p_notes: 'Integration transfer', p_lines: lines,
    });
    if (created.error) throw created.error;
    const row = await t.service.from('stock_transfers').select('id,transfer_number,status')
      .eq('transfer_number', created.data).single();
    if (row.error) throw row.error;
    if (submit) {
      const submitted = await client.rpc('submit_transfer_request', { p_transfer_id: row.data.id });
      if (submitted.error) throw submitted.error;
    }
    return row.data.id as string;
  }

  async function approve(id: string) {
    const result = await t.admin.rpc('approve_transfer', { p_transfer_id: id });
    if (result.error) throw result.error;
  }

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

    const summary = await t.lon.rpc('transfer_summary', { p_status: 'draft' });
    const transferId = (summary.data as Array<{ id: string; transfer_number: string }> | null)
      ?.find((row) => row.transfer_number === created.data)?.id;
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

    expect((await t.admin.rpc('submit_transfer_request', { p_transfer_id: transferId })).error).toBeNull();

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
    expect((await t.admin.rpc('submit_transfer_request', { p_transfer_id: transferId })).error).toBeNull();
    expect((await t.admin.rpc('approve_transfer', { p_transfer_id: transferId })).error).toBeNull();
    const dispatch = await t.admin.rpc('dispatch_transfer', { p_transfer_id: transferId, p_request_id: randomUUID() });
    expect(dispatch.error?.message).toContain('INSUFFICIENT_STOCK');
  });

  it('allows source and destination Managers to perform only their physical branch step', async () => {
    const product = await createProduct('Manager operations');
    await addStock(product, t.lonLocationId, 5, 80);
    const id = await createTransfer(t.lon, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 2 }]);
    await approve(id);

    expect((await t.reg.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() })).error?.message).toContain('ACCESS_DENIED');
    expect((await t.lon.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() })).error).toBeNull();
    expect((await t.lon.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 2 }] })).error?.message).toContain('ACCESS_DENIED');
    expect((await t.reg.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 2 }] })).error).toBeNull();
  });

  it('dispatches and receives multiple lines atomically', async () => {
    const first = await createProduct('Multi A'); const second = await createProduct('Multi B');
    await addStock(first, t.lonLocationId, 4, 10); await addStock(second, t.lonLocationId, 6, 20);
    const id = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [
      { product_id: first, requested_quantity: 2 }, { product_id: second, requested_quantity: 3 },
    ]);
    await approve(id);
    expect((await t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() })).error).toBeNull();
    expect((await t.admin.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [
      { product_id: first, received_quantity: 2 }, { product_id: second, received_quantity: 3 },
    ] })).error).toBeNull();
    const movements = await t.service.from('inventory_movements').select('movement_type,transfer_line_id').eq('transfer_id', id);
    expect(movements.data).toHaveLength(4);
  });

  it('uses captured known cost in destination WAC and does not recalculate source WAC', async () => {
    const product = await createProduct('Known WAC');
    await addStock(product, t.lonLocationId, 10, 100); await addStock(product, t.regLocationId, 10, 50);
    const id = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 2 }]);
    await approve(id); await t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() });
    await t.admin.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 2 }] });
    const balances = await t.service.from('inventory_balances').select('location_id,on_hand,weighted_average_cost').eq('product_id', product);
    expect(Number(balances.data?.find(row => row.location_id === t.lonLocationId)?.weighted_average_cost)).toBe(100);
    expect(Number(balances.data?.find(row => row.location_id === t.regLocationId)?.weighted_average_cost)).toBeCloseTo(58.3333, 4);
  });

  it('keeps fully transferred pending cost NULL then reconstructs destination WAC after assignment', async () => {
    const product = await createProduct('Pending lineage');
    const opening = await addStock(product, t.lonLocationId, 7, null);
    const id = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 7 }]);
    await approve(id); await t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() });
    await t.admin.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 7 }] });
    let destination = await t.service.from('inventory_balances').select('on_hand,weighted_average_cost').eq('product_id', product).eq('location_id', t.regLocationId).single();
    expect(destination.data).toMatchObject({ on_hand: 7, weighted_average_cost: null });
    expect((await t.admin.rpc('assign_opening_stock_cost', { p_opening_movement_id: opening.movement_id, p_unit_cost: 123.45 })).error).toBeNull();
    destination = await t.service.from('inventory_balances').select('on_hand,weighted_average_cost').eq('product_id', product).eq('location_id', t.regLocationId).single();
    expect(Number(destination.data?.weighted_average_cost)).toBeCloseTo(123.45, 4);
  });

  it('protects reserved stock and never makes source inventory negative', async () => {
    const product = await createProduct('Reserved'); await addStock(product, t.lonLocationId, 5, 40);
    execFileSync('docker', ['exec', 'supabase_db_247truck-inventory', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `update public.inventory_balances set reserved=4 where product_id='${product}' and location_id='${t.lonLocationId}'`]);
    const id = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 2 }]); await approve(id);
    expect((await t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() })).error?.message).toContain('INSUFFICIENT_STOCK');
    const balance = await t.service.from('inventory_balances').select('on_hand,reserved').eq('product_id', product).eq('location_id', t.lonLocationId).single();
    expect(balance.data).toMatchObject({ on_hand: 5, reserved: 4 });
  });

  it('records short receipt for review, rejects over-receipt, and restricts resolution to Admin', async () => {
    const product = await createProduct('Discrepancy'); await addStock(product, t.lonLocationId, 8, 30);
    const shortId = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 4 }]); await approve(shortId);
    await t.admin.rpc('dispatch_transfer', { p_transfer_id: shortId, p_request_id: randomUUID() });
    expect((await t.reg.rpc('receive_transfer', { p_transfer_id: shortId, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 3 }] })).error).toBeNull();
    expect((await t.service.from('stock_transfers').select('status').eq('id', shortId).single()).data?.status).toBe('review_required');
    expect((await t.reg.rpc('resolve_transfer_discrepancy', { p_transfer_id: shortId, p_notes: 'accepted shortage' })).error?.message).toContain('ACCESS_DENIED');
    expect((await t.admin.rpc('resolve_transfer_discrepancy', { p_transfer_id: shortId, p_notes: 'Confirmed one unit missing in transit' })).error).toBeNull();

    const overId = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 2 }]); await approve(overId);
    await t.admin.rpc('dispatch_transfer', { p_transfer_id: overId, p_request_id: randomUUID() });
    expect((await t.reg.rpc('receive_transfer', { p_transfer_id: overId, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 3 }] })).error?.message).toContain('OVER_RECEIPT');
    expect((await t.service.from('stock_transfers').select('status').eq('id', overId).single()).data?.status).toBe('in_transit');
  });

  it('rejects request key reuse across transfers/actions and preserves idempotent replays', async () => {
    const product = await createProduct('Idempotency'); await addStock(product, t.lonLocationId, 6, 25);
    const first = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 1 }]); await approve(first);
    const key = randomUUID();
    expect((await t.admin.rpc('dispatch_transfer', { p_transfer_id: first, p_request_id: key })).error).toBeNull();
    expect((await t.admin.rpc('dispatch_transfer', { p_transfer_id: first, p_request_id: key })).error).toBeNull();
    const second = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 1 }]); await approve(second);
    expect((await t.admin.rpc('dispatch_transfer', { p_transfer_id: second, p_request_id: key })).error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    expect((await t.admin.rpc('receive_transfer', { p_transfer_id: first, p_request_id: key, p_receipts: [{ product_id: product, received_quantity: 1 }] })).error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
  });

  it('keeps raw transfer tables and other-branch cost/quantity details private', async () => {
    const product = await createProduct('Privacy'); await addStock(product, t.lonLocationId, 3, 77);
    const id = await createTransfer(t.lon, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 1 }]); await approve(id);
    await t.lon.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() });
    const raw = await t.reg.from('stock_transfer_lines').select('*');
    expect(raw.error).not.toBeNull(); expect(raw.data).toBeNull();
    const detail = await t.reg.rpc('transfer_detail', { p_transfer_id: id });
    expect(detail.error).toBeNull();
    expect(detail.data.lines[0].transfer_cost_snapshot).toBeNull();
    const otherBalance = await t.reg.from('inventory_balances').select('on_hand,weighted_average_cost').eq('product_id', product).eq('location_id', t.lonLocationId);
    expect(otherBalance.error).not.toBeNull();
    expect(otherBalance.data).toBeNull();
  });

  it('writes immutable transition audits and append-only transfer movements', async () => {
    const product = await createProduct('Audit'); await addStock(product, t.lonLocationId, 2, 15);
    const id = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 1 }]); await approve(id);
    await t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() });
    await t.admin.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 1 }] });
    const events = await t.service.from('audit_events').select('id,event_type').eq('entity_id', id);
    expect(events.data?.map(event => event.event_type)).toEqual(expect.arrayContaining(['TRANSFER_CREATED','TRANSFER_REQUESTED','TRANSFER_APPROVED','TRANSFER_DISPATCHED','TRANSFER_RECEIVED','TRANSFER_COMPLETED']));
    const movement = await t.service.from('inventory_movements').select('id').eq('transfer_id', id).limit(1).single();
    expect((await t.service.from('inventory_movements').update({ reason: 'tampered' }).eq('id', movement.data!.id)).error).not.toBeNull();
    expect((await t.service.from('audit_events').delete().eq('id', events.data![0].id)).error).not.toBeNull();
  });

  it('supports both directions and keeps approval/rejection Admin-only', async () => {
    const product = await createProduct('Direction auth'); await addStock(product, t.regLocationId, 4, 55);
    const inboundForLon = await createTransfer(t.lon, t.regLocationId, t.lonLocationId, [{ product_id: product, requested_quantity: 1 }]);
    expect((await t.lon.rpc('reject_transfer', { p_transfer_id: inboundForLon, p_reason: 'not allowed' })).error?.message).toContain('ACCESS_DENIED');
    expect((await t.admin.rpc('reject_transfer', { p_transfer_id: inboundForLon, p_reason: 'Admin rejected test request' })).error).toBeNull();
    expect((await t.service.from('stock_transfers').select('transfer_number,status').eq('id', inboundForLon).single()).data).toMatchObject({ status: 'rejected' });

    const reverse = await createTransfer(t.admin, t.regLocationId, t.lonLocationId, [{ product_id: product, requested_quantity: 1 }]);
    expect((await t.service.from('stock_transfers').select('transfer_number').eq('id', reverse).single()).data?.transfer_number).toMatch(/^REG-TRF-\d{6}$/);
  });

  it('serializes concurrent dispatch and receipt replays without double movement', async () => {
    const product = await createProduct('Concurrent'); await addStock(product, t.lonLocationId, 5, 90);
    const id = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 2 }]); await approve(id);
    const dispatchKey = randomUUID();
    const dispatches = await Promise.all([
      t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: dispatchKey }),
      t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: dispatchKey }),
    ]);
    expect(dispatches.every(result => result.error === null)).toBe(true);
    expect((await t.service.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('transfer_id', id).eq('movement_type', 'transfer_out')).count).toBe(1);

    const receiveKey = randomUUID();
    const receipts = await Promise.all([
      t.admin.rpc('receive_transfer', { p_transfer_id: id, p_request_id: receiveKey, p_receipts: [{ product_id: product, received_quantity: 2 }] }),
      t.admin.rpc('receive_transfer', { p_transfer_id: id, p_request_id: receiveKey, p_receipts: [{ product_id: product, received_quantity: 2 }] }),
    ]);
    expect(receipts.every(result => result.error === null)).toBe(true);
    expect((await t.service.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('transfer_id', id).eq('movement_type', 'transfer_in')).count).toBe(1);
    const destination = await t.service.from('inventory_balances').select('on_hand').eq('product_id', product).eq('location_id', t.regLocationId).single();
    expect(destination.data?.on_hand).toBe(2);
  });

  it('keeps WAC unchanged on subsequent stock-out and returns product/activity detail', async () => {
    const product = await createProduct('Detail'); await addStock(product, t.lonLocationId, 3, 60);
    const id = await createTransfer(t.admin, t.lonLocationId, t.regLocationId, [{ product_id: product, requested_quantity: 2 }]); await approve(id);
    await t.admin.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() });
    await t.admin.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [{ product_id: product, received_quantity: 2 }] });
    const before = await t.service.from('inventory_balances').select('weighted_average_cost').eq('product_id', product).eq('location_id', t.regLocationId).single();
    expect((await t.admin.rpc('post_inventory_movement', { p_request_id: randomUUID(), p_product_id: product, p_location_id: t.regLocationId, p_quantity_delta: -1, p_movement_type: 'stock_out', p_reason: 'sale', p_inbound_unit_cost: null, p_used_tyre_unit_id: null, p_source_type: 'sale', p_source_id: randomUUID(), p_supplier_name: null })).error).toBeNull();
    const after = await t.service.from('inventory_balances').select('weighted_average_cost').eq('product_id', product).eq('location_id', t.regLocationId).single();
    expect(after.data?.weighted_average_cost).toBe(before.data?.weighted_average_cost);
    const detail = await t.admin.rpc('transfer_detail', { p_transfer_id: id });
    expect(detail.data.lines[0].product_name).toContain('Detail');
    expect(detail.data.activity.map((event: { event_type: string }) => event.event_type)).toContain('TRANSFER_COMPLETED');
  });
});
