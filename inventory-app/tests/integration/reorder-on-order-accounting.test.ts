import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[reorder on-order accounting] skipped: missing ${gap.join(', ')}\n`);
}

type SuggestionRow = {
  product_id: string;
  available: number;
  on_order: number;
  minimum_stock: number;
};

/**
 * reorder_suggestions and create_draft_purchase_orders_from_reorder both
 * used to compare `available` against `minimum_stock` with no regard for
 * purchase orders already raised for the shortfall. A product with an
 * approved-but-unreceived PO kept reappearing as a suggestion every day
 * until goods physically landed, and staff could generate a duplicate draft
 * PO for the same shortage before the first one arrived. Both now compare
 * `available + on_order` (sum of ordered_quantity - received_quantity across
 * this product's lines on purchase orders in approved/sent/partially_received
 * at the location) against `minimum_stock`.
 */
suite('reorder suggestions account for on-order purchase order stock', () => {
  let t: TestTenants;
  let supplierId: string;

  async function createProduct(name: string): Promise<string> {
    const result = await t.admin.rpc('create_product_with_prices', { p_name: name, p_category_code: 'other_part', p_retail_price_incl_gst: 100, p_wholesale_price_incl_gst: 100});
    expect(result.error).toBeNull();
    return result.data as string;
  }

  async function stockIn(productId: string, quantity: number) {
    const result = await t.admin.rpc('post_inventory_movement_with_notes', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId, p_quantity_delta: quantity,
      p_movement_type: 'quick_stock_in', p_reason: 'on-order fixture', p_inbound_unit_cost: 25, p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null,
    p_notes: null });
    expect(result.error).toBeNull();
  }

  async function associate(productId: string) {
    const result = await t.service.from('product_suppliers').insert({ product_id: productId, supplier_id: supplierId, minimum_order_qty: 1, last_cost: 25 });
    expect(result.error).toBeNull();
  }

  async function setSettings(productId: string, minimumStock: number, reorderQuantity: number) {
    const result = await t.admin.rpc('set_inventory_reorder_settings', {
      p_product_id: productId, p_location_id: t.lonLocationId, p_minimum_stock: minimumStock, p_reorder_quantity: reorderQuantity, p_preferred_supplier_id: supplierId,
    });
    expect(result.error).toBeNull();
  }

  /** Creates an approved PO for one product; optionally receives part or all of it. */
  async function createPo(productId: string, orderedQuantity: number, receiveQuantity = 0, status: 'sent' | 'approved' = 'approved') {
    const created = await t.admin.rpc('create_purchase_order_draft', { p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: null, p_supplier_reference: randomUUID() });
    expect(created.error).toBeNull();
    const replaced = await t.admin.rpc('replace_purchase_order_lines', { p_purchase_order_id: created.data, p_lines: [{ product_id: productId, ordered_quantity: orderedQuantity, unit_cost: 25, notes: null }] });
    expect(replaced.error).toBeNull();
    expect((await t.admin.rpc('submit_purchase_order', { p_purchase_order_id: created.data })).error).toBeNull();
    expect((await t.admin.rpc('approve_purchase_order', { p_purchase_order_id: created.data })).error).toBeNull();
    if (status === 'sent') {
      expect((await t.admin.rpc('mark_purchase_order_sent', { p_purchase_order_id: created.data })).error).toBeNull();
    }
    if (receiveQuantity > 0) {
      const lines = await t.service.from('purchase_order_lines').select('id').eq('purchase_order_id', created.data);
      expect(lines.error).toBeNull();
      const received = await t.admin.rpc('receive_purchase_order', {
        p_request_id: randomUUID(), p_purchase_order_id: created.data,
        p_lines: [{ purchaseOrderLineId: lines.data![0].id, quantityReceived: receiveQuantity }],
      });
      expect(received.error).toBeNull();
    }
    return created.data as string;
  }

  async function suggestionFor(productId: string): Promise<SuggestionRow | undefined> {
    const result = await t.admin.rpc('reorder_suggestions', { p_location_id: t.lonLocationId });
    expect(result.error).toBeNull();
    const rows = (result.data ?? []) as SuggestionRow[];
    return rows.find((row) => row.product_id === productId);
  }

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: ['inventory.view', 'purchasing.view', 'purchasing.create_po', 'purchasing.submit_po', 'purchasing.receive_po'] });
    const supplier = await t.admin.rpc('create_supplier', { p_name: `On-order supplier ${randomUUID().slice(0, 8)}`, p_abn: null, p_contact_name: null, p_phone: null, p_email: null, p_address: null, p_payment_terms: null, p_account_reference: null, p_notes: null });
    expect(supplier.error).toBeNull();
    supplierId = supplier.data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('no existing PO: suggested with on_order 0', async () => {
    const product = await createProduct('On-order case: no PO');
    await stockIn(product, 4);
    await associate(product);
    await setSettings(product, 10, 10);
    const row = await suggestionFor(product);
    expect(row).toMatchObject({ available: 4, on_order: 0 });
  });

  it('fully outstanding PO covers the shortfall: not suggested, and draft generation is refused', async () => {
    const product = await createProduct('On-order case: fully outstanding');
    await stockIn(product, 4);
    await associate(product);
    await setSettings(product, 10, 10);
    await createPo(product, 6, 0);
    expect(await suggestionFor(product)).toBeUndefined();
    const draft = await t.admin.rpc('create_draft_purchase_orders_from_reorder', { p_location_id: t.lonLocationId, p_product_ids: [product] });
    expect(draft.error?.message).toContain('REORDER_NOT_ELIGIBLE');
  });

  it('partially received PO: remaining outstanding still counts, and receiving also raises available', async () => {
    const product = await createProduct('On-order case: partially received');
    await stockIn(product, 4);
    await associate(product);
    // Receiving 2 of the 10 ordered raises available by that same 2 (real
    // stock landed), leaving 8 still outstanding on the PO -- both effects
    // must show up: available 4+2=6, on_order 10-2=8.
    await setSettings(product, 20, 10);
    await createPo(product, 10, 2);
    const row = await suggestionFor(product);
    expect(row).toMatchObject({ available: 6, on_order: 8 });
  });

  it('PO fully received: excluded from on_order once its status leaves the eligible set', async () => {
    const product = await createProduct('On-order case: fully received');
    await stockIn(product, 4);
    await associate(product);
    await setSettings(product, 1000, 10);
    await createPo(product, 10, 10);
    const row = await suggestionFor(product);
    expect(row).toMatchObject({ available: 14, on_order: 0 });
  });

  it('multiple active purchase orders: on_order sums across them', async () => {
    const product = await createProduct('On-order case: multiple POs');
    await stockIn(product, 4);
    await associate(product);
    await setSettings(product, 10, 10);
    await createPo(product, 3, 0, 'approved');
    await createPo(product, 2, 0, 'sent');
    const row = await suggestionFor(product);
    expect(row).toMatchObject({ available: 4, on_order: 5 });
  });

  it('insufficient on-order quantity: still suggested, and draft generation still succeeds', async () => {
    const product = await createProduct('On-order case: insufficient');
    await stockIn(product, 4);
    await associate(product);
    await setSettings(product, 10, 10);
    await createPo(product, 4, 0);
    const row = await suggestionFor(product);
    expect(row).toMatchObject({ available: 4, on_order: 4 });
    const draft = await t.admin.rpc('create_draft_purchase_orders_from_reorder', { p_location_id: t.lonLocationId, p_product_ids: [product] });
    expect(draft.error).toBeNull();
  });

  it('sufficient on-order quantity: no longer suggested even though available alone is short', async () => {
    const product = await createProduct('On-order case: sufficient');
    await stockIn(product, 4);
    await associate(product);
    await setSettings(product, 10, 10);
    await createPo(product, 10, 0);
    expect(await suggestionFor(product)).toBeUndefined();
  });
});
