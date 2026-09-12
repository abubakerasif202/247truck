import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { friendlyTransferError } from '@/lib/transfers/errors';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[transfer error sanitization] skipped: missing ${gap.join(', ')}\n`);
}

const GENERIC = 'The transfer action could not be completed.';
// Anything that looks like raw Postgres/PostgREST text leaking through.
const RAW_DB_TEXT = /\b(select|insert|update|delete|from|where|relation|column|constraint|violat|syntax|pg_|plpgsql|schema|permission denied|function .* does not exist)\b/i;

/** Asserts the real RPC raised a bare sentinel and that the UI mapping hides it. */
function expectSanitised(error: { message?: string } | null, sentinel: string) {
  expect(error, 'RPC should have failed').not.toBeNull();
  expect(error!.message).toBe(sentinel);
  const friendly = friendlyTransferError(error!.message);
  expect(friendly).not.toBe(GENERIC);
  expect(friendly).not.toContain(sentinel);
  expect(friendly).not.toMatch(RAW_DB_TEXT);
}

suite('transfer RPC failures against the real database are sanitised before reaching the UI', () => {
  let t: TestTenants;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'inventory.transfer_request'],
      regPermissions: ['inventory.view', 'inventory.transfer_request'],
    });
    const product = await t.admin.rpc('create_product', {
      p_name: `Transfer Sanitise Tyre ${randomUUID().slice(0, 8)}`, p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 500, p_tyre_condition: 'new', p_tyre_brand: 'Michelin', p_tyre_size: '295/80R22.5',
    });
    expect(product.error, JSON.stringify(product.error)).toBeNull();
    productId = product.data as string;
    const stocked = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
      p_quantity_delta: 2, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100,
    });
    expect(stocked.error, JSON.stringify(stocked.error)).toBeNull();
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  async function transferId(transferNumber: string): Promise<string> {
    const { data, error } = await t.service.from('stock_transfers').select('id').eq('transfer_number', transferNumber).single<{ id: string }>();
    expect(error).toBeNull();
    return data!.id;
  }

  it('insufficient stock', async () => {
    const created = await t.lon.rpc('create_transfer_request', {
      p_source_location_id: t.lonLocationId, p_destination_location_id: t.regLocationId,
      p_notes: null, p_lines: [{ product_id: productId, requested_quantity: 50 }],
    });
    // Quantity is validated at dispatch (stock may arrive between request and dispatch).
    expect(created.error, JSON.stringify(created.error)).toBeNull();
    const id = await transferId(created.data as string);
    expect((await t.lon.rpc('submit_transfer_request', { p_transfer_id: id })).error).toBeNull();
    expect((await t.admin.rpc('approve_transfer', { p_transfer_id: id })).error).toBeNull();
    const dispatched = await t.lon.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() });
    expectSanitised(dispatched.error, 'INSUFFICIENT_STOCK');
  });

  it('wrong state', async () => {
    const created = await t.lon.rpc('create_transfer_request', {
      p_source_location_id: t.lonLocationId, p_destination_location_id: t.regLocationId,
      p_notes: null, p_lines: [{ product_id: productId, requested_quantity: 1 }],
    });
    expect(created.error, JSON.stringify(created.error)).toBeNull();
    const id = await transferId(created.data as string);
    // Still a draft: dispatching, receiving and approving are all invalid transitions.
    expectSanitised((await t.lon.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() })).error, 'INVALID_TRANSFER_TRANSITION');
    expectSanitised((await t.reg.rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: [{ product_id: productId, received_quantity: 1 }] })).error, 'INVALID_TRANSFER_TRANSITION');
    expectSanitised((await t.admin.rpc('approve_transfer', { p_transfer_id: id })).error, 'INVALID_TRANSFER_TRANSITION');
  });

  it('missing transfer', async () => {
    const ghost = randomUUID();
    // Each RPC reports a missing row through its own guard order
    // (approve_transfer folds it into the state check, submit into the
    // branch-authorisation check); every one is a mapped sentinel.
    expectSanitised((await t.admin.rpc('transfer_detail', { p_transfer_id: ghost })).error, 'TRANSFER_NOT_FOUND');
    expectSanitised((await t.admin.rpc('approve_transfer', { p_transfer_id: ghost })).error, 'INVALID_TRANSFER_TRANSITION');
    expectSanitised((await t.lon.rpc('submit_transfer_request', { p_transfer_id: ghost })).error, 'ACCESS_DENIED');
    expectSanitised((await t.lon.rpc('dispatch_transfer', { p_transfer_id: ghost, p_request_id: randomUUID() })).error, 'TRANSFER_NOT_FOUND');
  });

  it('access denied', async () => {
    const created = await t.lon.rpc('create_transfer_request', {
      p_source_location_id: t.lonLocationId, p_destination_location_id: t.regLocationId,
      p_notes: null, p_lines: [{ product_id: productId, requested_quantity: 1 }],
    });
    expect(created.error, JSON.stringify(created.error)).toBeNull();
    const id = await transferId(created.data as string);
    expect((await t.lon.rpc('submit_transfer_request', { p_transfer_id: id })).error).toBeNull();
    // A branch manager may not approve; the destination branch may not dispatch.
    expectSanitised((await t.lon.rpc('approve_transfer', { p_transfer_id: id })).error, 'ACCESS_DENIED');
    expect((await t.admin.rpc('approve_transfer', { p_transfer_id: id })).error).toBeNull();
    expectSanitised((await t.reg.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() })).error, 'ACCESS_DENIED');
    // Anonymous callers are stopped by the function grant itself; Postgres'
    // own wording must still collapse to the generic message.
    const anonymous = await t.anon().rpc('approve_transfer', { p_transfer_id: id });
    expect(anonymous.error?.message).toMatch(/permission denied for function approve_transfer/);
    expect(friendlyTransferError(anonymous.error?.message)).toBe(GENERIC);
  });

  it('never echoes an unknown database message', () => {
    for (const raw of [
      'permission denied for table stock_transfers',
      'null value in column "product_id" violates not-null constraint',
      'syntax error at or near "select"',
      'function public.dispatch_transfer(uuid) does not exist',
      undefined,
    ]) {
      const friendly = friendlyTransferError(raw);
      expect(friendly).toBe(GENERIC);
      expect(friendly).not.toMatch(RAW_DB_TEXT);
    }
  });
});
