import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[purchase-receiving-lock-order] skipped: missing ${gap.join(', ')}\n`);
}

/**
 * Regression for a deadlock hazard in receive_purchase_order: both locking
 * loops locked purchase_order_lines `order by line.id`, and line.id is
 * gen_random_uuid(), uncorrelated with product_id. Nothing prevents two open
 * purchase orders at one branch from sharing the same two products, so two
 * such orders received concurrently -- with their line ids happening to sort
 * in opposite order -- lock the underlying per-product balance rows (inside
 * post_inventory_movement) in opposite order too: a classic deadlock,
 * surfaced to the receiving Manager as an opaque "Could not receive the
 * purchase order." The fix (20260919094000_purchase_receiving_product_lock_order.sql)
 * locks `order by line.product_id, line.id` instead, matching the same
 * convention complete_job already uses for exactly this bug class.
 *
 * This forces the adversarial ordering deterministically -- rather than
 * hoping two random UUIDs happen to invert -- by setting each purchase
 * order's line ids directly once the (real, RPC-created) purchase orders
 * exist, so PO A's lines sort [productX, productY] by id while PO B's lines
 * sort [productY, productX].
 */
suite('purchase-order receiving locks balances in a deterministic order', () => {
  let t: TestTenants;
  let supplierId: string;
  let productXId: string;
  let productYId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'purchasing.view', 'purchasing.create_po', 'purchasing.submit_po', 'purchasing.receive_po'],
    });
    const supplier = await t.admin.rpc('create_supplier', {
      p_name: `Lock Order Supplier ${randomUUID().slice(0, 8)}`, p_abn: null, p_contact_name: null, p_phone: null,
      p_email: null, p_address: null, p_payment_terms: null, p_account_reference: null, p_notes: null,
    });
    expect(supplier.error).toBeNull();
    supplierId = supplier.data as string;

    const x = await t.admin.rpc('create_product_with_prices', { p_name: `Lock Order X ${randomUUID().slice(0, 8)}`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 500, p_wholesale_price_incl_gst: 500, p_tyre_condition: 'new', p_tyre_brand: 'Lock', p_tyre_size: '11R22.5' });
    expect(x.error).toBeNull();
    productXId = x.data as string;
    const y = await t.admin.rpc('create_product_with_prices', { p_name: `Lock Order Y ${randomUUID().slice(0, 8)}`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 500, p_wholesale_price_incl_gst: 500, p_tyre_condition: 'new', p_tyre_brand: 'Lock', p_tyre_size: '295/80R22.5' });
    expect(y.error).toBeNull();
    productYId = y.data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  async function createApprovedPo(lines: Array<{ product_id: string; ordered_quantity: number; unit_cost: number }>) {
    const created = await t.lon.rpc('create_purchase_order_draft', {
      p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: 'lock order test', p_supplier_reference: randomUUID(),
    });
    expect(created.error).toBeNull();
    const replaced = await t.lon.rpc('replace_purchase_order_lines', {
      p_purchase_order_id: created.data, p_lines: lines.map((line) => ({ ...line, notes: null })),
    });
    expect(replaced.error).toBeNull();
    expect((await t.lon.rpc('submit_purchase_order', { p_purchase_order_id: created.data })).error).toBeNull();
    expect((await t.admin.rpc('approve_purchase_order', { p_purchase_order_id: created.data })).error).toBeNull();
    return created.data as string;
  }

  /**
   * Force a purchase order's two line ids to sort by `product_id, id` first
   * vs second, as requested. Ids must be globally unique (purchase_order_lines.id
   * is the table's primary key, not scoped per order), so each call takes
   * its own pair of ids.
   */
  function forceLineOrder(poId: string, firstProductId: string, firstId: string, secondProductId: string, secondId: string) {
    sql(`
      update public.purchase_order_lines set id = '${firstId}' where purchase_order_id = '${poId}' and product_id = '${firstProductId}';
      update public.purchase_order_lines set id = '${secondId}' where purchase_order_id = '${poId}' and product_id = '${secondProductId}';
    `);
  }

  it('receives two purchase orders sharing two products concurrently without deadlocking, regardless of line id order', async () => {
    const poA = await createApprovedPo([
      { product_id: productXId, ordered_quantity: 5, unit_cost: 100 },
      { product_id: productYId, ordered_quantity: 5, unit_cost: 100 },
    ]);
    const poB = await createApprovedPo([
      { product_id: productXId, ordered_quantity: 3, unit_cost: 110 },
      { product_id: productYId, ordered_quantity: 3, unit_cost: 110 },
    ]);

    // PO A's lines sort id-ascending as [X, Y]; PO B's sort as [Y, X] --
    // the opposite order. Locking `order by line.id` (the bug) would take
    // PO A's balance locks as [X, Y] and PO B's as [Y, X]: a lock-order
    // inversion. Locking `order by line.product_id, line.id` (the fix)
    // takes both as [X, Y] regardless of each line's own id.
    const nonce = randomUUID().replaceAll('-', '').slice(-8);
    const orderedId = (position: number) => `00000000-0000-4000-8000-${String(position).padStart(4, '0')}${nonce}`;
    const lineIdsA: Record<string, string> = { [productXId]: orderedId(1), [productYId]: orderedId(2) };
    const lineIdsB: Record<string, string> = { [productYId]: orderedId(3), [productXId]: orderedId(4) };
    forceLineOrder(poA, productXId, lineIdsA[productXId], productYId, lineIdsA[productYId]);
    forceLineOrder(poB, productYId, lineIdsB[productYId], productXId, lineIdsB[productXId]);

    const idsA = sql(`select id, product_id from public.purchase_order_lines where purchase_order_id = '${poA}' order by id;`);
    const idsB = sql(`select id, product_id from public.purchase_order_lines where purchase_order_id = '${poB}' order by id;`);
    expect(idsA.split('\n')[0]).toContain(productXId);
    expect(idsB.split('\n')[0]).toContain(productYId);

    const client: SupabaseClient = t.lon;
    const [resultA, resultB] = await Promise.all([
      client.rpc('receive_purchase_order', {
        p_request_id: randomUUID(), p_purchase_order_id: poA,
        p_lines: [
          { purchaseOrderLineId: lineIdsA[productXId], quantityReceived: 5 },
          { purchaseOrderLineId: lineIdsA[productYId], quantityReceived: 5 },
        ],
      }),
      client.rpc('receive_purchase_order', {
        p_request_id: randomUUID(), p_purchase_order_id: poB,
        p_lines: [
          { purchaseOrderLineId: lineIdsB[productXId], quantityReceived: 3 },
          { purchaseOrderLineId: lineIdsB[productYId], quantityReceived: 3 },
        ],
      }),
    ]);

    expect(resultA.error, JSON.stringify(resultA.error)).toBeNull();
    expect(resultB.error, JSON.stringify(resultB.error)).toBeNull();

    const balanceX = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productXId).eq('location_id', t.lonLocationId).single();
    const balanceY = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productYId).eq('location_id', t.lonLocationId).single();
    expect(balanceX.data?.on_hand).toBe(8);
    expect(balanceY.data?.on_hand).toBe(8);
  }, 20_000);
});
