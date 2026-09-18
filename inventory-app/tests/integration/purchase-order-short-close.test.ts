import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[purchase-order-short-close] skipped: missing ${gap.join(', ')}\n`);
}

/**
 * A supplier may ship less than ordered and never deliver, or cancel, the
 * remainder. cancel_purchase_order refuses 'partially_received' by design
 * (a real receipt must never be discarded by a "cancellation"), but nothing
 * ever wrote 'closed'/closed_at either -- both existed in the schema with no
 * writer -- so a short-shipped PO was a permanent dead end. close_purchase_order
 * is the explicit Admin-only terminal transition: it must preserve already
 * received quantities and GRNs exactly, post no inventory movement, and
 * never touch historic receipt costs.
 */
suite('close_purchase_order (short-close)', () => {
  let t: TestTenants;
  let supplierId: string;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'purchasing.view', 'purchasing.create_po', 'purchasing.submit_po', 'purchasing.receive_po'],
    });
    const supplier = await t.admin.rpc('create_supplier', { p_name: `Short close supplier ${randomUUID().slice(0, 8)}`, p_abn: null, p_contact_name: null, p_phone: null, p_email: null, p_address: null, p_payment_terms: null, p_account_reference: null, p_notes: null });
    expect(supplier.error).toBeNull();
    supplierId = supplier.data as string;
    const product = await t.admin.rpc('create_product_with_prices', { p_name: `Short close tyre ${randomUUID().slice(0, 8)}`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 500, p_wholesale_price_incl_gst: 500, p_tyre_condition: 'new', p_tyre_brand: 'Short', p_tyre_size: '11R22.5' });
    expect(product.error).toBeNull();
    productId = product.data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  async function partiallyReceivedPo(orderedQuantity: number, receivedQuantity: number, unitCost = 100) {
    const created = await t.admin.rpc('create_purchase_order_draft', { p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: null, p_supplier_reference: randomUUID() });
    expect(created.error).toBeNull();
    const replaced = await t.admin.rpc('replace_purchase_order_lines', { p_purchase_order_id: created.data, p_lines: [{ product_id: productId, ordered_quantity: orderedQuantity, unit_cost: unitCost, notes: null }] });
    expect(replaced.error).toBeNull();
    expect((await t.admin.rpc('submit_purchase_order', { p_purchase_order_id: created.data })).error).toBeNull();
    expect((await t.admin.rpc('approve_purchase_order', { p_purchase_order_id: created.data })).error).toBeNull();
    const lines = await t.service.from('purchase_order_lines').select('id').eq('purchase_order_id', created.data);
    expect(lines.error).toBeNull();
    const received = await t.admin.rpc('receive_purchase_order', {
      p_request_id: randomUUID(), p_purchase_order_id: created.data,
      p_lines: [{ purchaseOrderLineId: lines.data![0].id, quantityReceived: receivedQuantity }],
    });
    expect(received.error, JSON.stringify(received.error)).toBeNull();
    const detail = await t.admin.rpc('purchase_order_detail', { p_purchase_order_id: created.data });
    expect(detail.error).toBeNull();
    expect(detail.data[0].status).toBe('partially_received');
    return created.data as string;
  }

  it('closes a partially received PO, preserving received quantity, GRNs, historic cost, and posting no movement', async () => {
    const poId = await partiallyReceivedPo(10, 4, 130);

    const before = await t.service.from('inventory_balances').select('on_hand,reserved,weighted_average_cost').eq('product_id', productId).eq('location_id', t.lonLocationId).single();
    const movementsBefore = await t.service.from('inventory_movements').select('id', { count: 'exact', head: true });
    const grnBefore = await t.service.from('goods_receipt_lines').select('id,quantity_received,unit_cost').eq('purchase_order_line_id', (await t.service.from('purchase_order_lines').select('id').eq('purchase_order_id', poId).single()).data!.id);

    const closed = await t.admin.rpc('close_purchase_order', { p_request_id: randomUUID(), p_purchase_order_id: poId, p_reason: 'Supplier discontinued remaining stock' });
    expect(closed.error, JSON.stringify(closed.error)).toBeNull();

    const detail = await t.admin.rpc('purchase_order_detail', { p_purchase_order_id: poId });
    expect(detail.error).toBeNull();
    expect(detail.data[0]).toMatchObject({
      status: 'closed', closed_reason: 'Supplier discontinued remaining stock',
      ordered_quantity: 10, received_quantity: 4,
    });
    expect(detail.data[0].closed_at).not.toBeNull();

    const after = await t.service.from('inventory_balances').select('on_hand,reserved,weighted_average_cost').eq('product_id', productId).eq('location_id', t.lonLocationId).single();
    expect(after.data).toEqual(before.data);
    const movementsAfter = await t.service.from('inventory_movements').select('id', { count: 'exact', head: true });
    expect(movementsAfter.count).toBe(movementsBefore.count);
    const grnAfter = await t.service.from('goods_receipt_lines').select('id,quantity_received,unit_cost').eq('purchase_order_line_id', (await t.service.from('purchase_order_lines').select('id').eq('purchase_order_id', poId).single()).data!.id);
    expect(grnAfter.data).toEqual(grnBefore.data);

    const audit = await t.service.from('audit_events').select('event_type').eq('entity_id', poId).eq('event_type', 'PURCHASE_ORDER_CLOSED');
    expect(audit.data?.length).toBeGreaterThan(0);
  });

  it('requires a non-empty reason', async () => {
    const poId = await partiallyReceivedPo(6, 2);
    const empty = await t.admin.rpc('close_purchase_order', { p_request_id: randomUUID(), p_purchase_order_id: poId, p_reason: '   ' });
    expect(empty.error?.message).toContain('CLOSE_REASON_REQUIRED');
    const missing = await t.admin.rpc('close_purchase_order', { p_request_id: randomUUID(), p_purchase_order_id: poId, p_reason: null });
    expect(missing.error?.message).toContain('CLOSE_REASON_REQUIRED');
  });

  it('is Admin-only', async () => {
    const poId = await partiallyReceivedPo(6, 2);
    const denied: SupabaseClient = t.lon;
    const result = await denied.rpc('close_purchase_order', { p_request_id: randomUUID(), p_purchase_order_id: poId, p_reason: 'Not an admin' });
    expect(result.error?.message).toContain('ACCESS_DENIED');
  });

  it('refuses every status other than partially_received, including a fresh-key close attempt after already closed', async () => {
    const draft = await t.admin.rpc('create_purchase_order_draft', { p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: null, p_supplier_reference: randomUUID() });
    expect(draft.error).toBeNull();
    const draftClose = await t.admin.rpc('close_purchase_order', { p_request_id: randomUUID(), p_purchase_order_id: draft.data, p_reason: 'x' });
    expect(draftClose.error?.message).toContain('PO_CANNOT_CLOSE');

    const poId = await partiallyReceivedPo(6, 2);
    const first = await t.admin.rpc('close_purchase_order', { p_request_id: randomUUID(), p_purchase_order_id: poId, p_reason: 'first close' });
    expect(first.error).toBeNull();
    // A genuinely distinct request (its own fresh request_id, not a replay of
    // the first) that arrives after the PO is already closed must still be
    // refused, not silently treated as a replay of an unrelated request.
    const second = await t.admin.rpc('close_purchase_order', { p_request_id: randomUUID(), p_purchase_order_id: poId, p_reason: 'retry after already closed' });
    expect(second.error?.message).toContain('PO_CANNOT_CLOSE');
  });

  // Regression: close_purchase_order used to be "safe by rejection" on
  // retry -- a lost response followed by an identical retry saw
  // PO_CANNOT_CLOSE (the PO was already closed by the first, uncommunicated
  // call), even though nothing was actually wrong. That is not idempotent:
  // the caller cannot tell "already succeeded" apart from "can never
  // succeed". close_purchase_order now threads p_request_id and replays the
  // original result verbatim, matching receive_purchase_order and
  // complete_job.
  it('replays the original result when the exact same request is retried after a lost response, with only one state transition and one audit event', async () => {
    const poId = await partiallyReceivedPo(6, 2);
    const requestId = randomUUID();
    const reasonText = 'Supplier confirmed no further shipment';

    const first = await t.admin.rpc('close_purchase_order', { p_request_id: requestId, p_purchase_order_id: poId, p_reason: reasonText });
    expect(first.error, JSON.stringify(first.error)).toBeNull();

    // Simulate the client never receiving the first response and retrying
    // with the exact same request.
    const retry = await t.admin.rpc('close_purchase_order', { p_request_id: requestId, p_purchase_order_id: poId, p_reason: reasonText });
    expect(retry.error, JSON.stringify(retry.error)).toBeNull();
    expect(retry.data).toEqual(first.data);

    const detail = await t.admin.rpc('purchase_order_detail', { p_purchase_order_id: poId });
    expect(detail.error).toBeNull();
    expect(detail.data[0].status).toBe('closed');

    const audit = await t.service.from('audit_events').select('id').eq('entity_id', poId).eq('event_type', 'PURCHASE_ORDER_CLOSED');
    expect(audit.data).toHaveLength(1);
    const closedAtValues = sql(`select closed_at from public.purchase_orders where id = '${poId}'`);
    expect(closedAtValues.split('\n')).toHaveLength(1);
  });

  it('reusing the same request_id for a different purchase order is IDEMPOTENCY_KEY_REUSED', async () => {
    const poA = await partiallyReceivedPo(6, 2);
    const poB = await partiallyReceivedPo(6, 2);
    const requestId = randomUUID();

    const first = await t.admin.rpc('close_purchase_order', { p_request_id: requestId, p_purchase_order_id: poA, p_reason: 'first PO' });
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    const reused = await t.admin.rpc('close_purchase_order', { p_request_id: requestId, p_purchase_order_id: poB, p_reason: 'different PO, same key' });
    expect(reused.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');

    const detailB = await t.admin.rpc('purchase_order_detail', { p_purchase_order_id: poB });
    expect(detailB.data[0].status).toBe('partially_received');
  });
});
