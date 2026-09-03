import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[goods receiving] skipped: missing ${gap.join(', ')}\n`);
}

suite('atomic purchase-order goods receiving', () => {
  let t: TestTenants;
  let supplierId: string;
  let productId: string;
  let secondProductId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: [
        'inventory.view',
        'inventory.stock_in',
        'inventory.view_cost',
        'purchasing.view',
        'purchasing.create_po',
        'purchasing.submit_po',
        'purchasing.receive_po',
      ],
      regPermissions: ['inventory.view', 'purchasing.view', 'purchasing.receive_po'],
    });

    const supplier = await t.admin.rpc('create_supplier', {
      p_name: `Receiving Supplier ${randomUUID().slice(0, 8)}`,
      p_abn: null,
      p_contact_name: null,
      p_phone: null,
      p_email: null,
      p_address: null,
      p_payment_terms: null,
      p_account_reference: null,
      p_notes: null,
    });
    expect(supplier.error).toBeNull();
    supplierId = supplier.data as string;

    const product = await t.admin.rpc('create_product', {
      p_name: `Receiving Tyre ${randomUUID().slice(0, 8)}`,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 650,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Receiving Brand',
      p_tyre_size: '11R22.5',
    });
    expect(product.error).toBeNull();
    productId = product.data as string;

    const secondProduct = await t.admin.rpc('create_product', {
      p_name: `Receiving Second Tyre ${randomUUID().slice(0, 8)}`,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 700,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Receiving Brand',
      p_tyre_size: '295/80R22.5',
    });
    expect(secondProduct.error).toBeNull();
    secondProductId = secondProduct.data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  async function createApprovedPo(
    client: SupabaseClient = t.lon,
    locationId = t.lonLocationId,
    lines: Array<{ product_id: string; ordered_quantity: number; unit_cost: number }> = [
      { product_id: productId, ordered_quantity: 10, unit_cost: 130 },
    ],
  ): Promise<{ poId: string; lineIds: string[] }> {
    const created = await client.rpc('create_purchase_order', {
      p_location_id: locationId,
      p_supplier_id: supplierId,
      p_notes: 'receiving test',
      p_supplier_reference: randomUUID(),
    });
    expect(created.error).toBeNull();

    const replaced = await client.rpc('replace_purchase_order_lines', {
      p_purchase_order_id: created.data,
      p_lines: lines.map((line) => ({ ...line, notes: null })),
    });
    expect(replaced.error).toBeNull();

    const submitted = await client.rpc('submit_purchase_order', {
      p_purchase_order_id: created.data,
    });
    expect(submitted.error).toBeNull();
    const approved = await t.admin.rpc('approve_purchase_order', {
      p_purchase_order_id: created.data,
    });
    expect(approved.error).toBeNull();

    const rows = await t.service
      .from('purchase_order_lines')
      .select('id')
      .eq('purchase_order_id', created.data)
      .order('id');
    expect(rows.error).toBeNull();
    return { poId: created.data as string, lineIds: (rows.data ?? []).map((row) => row.id) };
  }

  async function receive(
    client: SupabaseClient,
    poId: string,
    lines: Array<{ purchaseOrderLineId: string; quantityReceived: number }>,
    requestId = randomUUID(),
  ) {
    return client.rpc('receive_purchase_order', {
      p_request_id: requestId,
      p_purchase_order_id: poId,
      p_lines: lines,
      p_supplier_delivery_reference: 'DELIVERY-1',
      p_notes: 'received in test',
    });
  }

  async function inventory(product = productId) {
    const result = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', product)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(result.error).toBeNull();
    return result.data as { on_hand: number; weighted_average_cost: number };
  }

  it('receives an approved PO and increases stock using line unit cost', async () => {
    const po = await createApprovedPo();
    const result = await receive(t.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 4 }]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual(expect.any(String));
    expect((await inventory()).on_hand).toBe(4);
  });

  it('recalculates location WAC using the existing formula', async () => {
    const first = await createApprovedPo(t.lon, t.lonLocationId, [
      { product_id: secondProductId, ordered_quantity: 10, unit_cost: 130 },
    ]);
    await t.lon.rpc('receive_purchase_order', {
      p_request_id: randomUUID(), p_purchase_order_id: first.poId,
      p_lines: [{ purchaseOrderLineId: first.lineIds[0], quantityReceived: 5 }],
    });
    const second = await createApprovedPo(t.lon, t.lonLocationId, [
      { product_id: secondProductId, ordered_quantity: 5, unit_cost: 170 },
    ]);
    await t.lon.rpc('receive_purchase_order', {
      p_request_id: randomUUID(), p_purchase_order_id: second.poId,
      p_lines: [{ purchaseOrderLineId: second.lineIds[0], quantityReceived: 5 }],
    });
    const balance = await inventory(secondProductId);
    expect(balance.on_hand).toBe(10);
    expect(Number(balance.weighted_average_cost)).toBeCloseTo(150, 4);
  });

  it('partial receipt leaves outstanding quantity and status partially_received', async () => {
    const po = await createApprovedPo();
    await receive(t.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 3 }]);
    const row = await t.service.from('purchase_orders').select('status').eq('id', po.poId).single();
    const line = await t.service.from('purchase_order_lines').select('ordered_quantity, received_quantity').eq('id', po.lineIds[0]).single();
    expect(row.data?.status).toBe('partially_received');
    expect(line.data).toMatchObject({ ordered_quantity: 10, received_quantity: 3 });
  });

  it('final receipt changes status to received', async () => {
    const po = await createApprovedPo();
    await receive(t.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 10 }]);
    const row = await t.service.from('purchase_orders').select('status').eq('id', po.poId).single();
    expect(row.data?.status).toBe('received');
  });

  it('blocks receive-now quantity above outstanding', async () => {
    const po = await createApprovedPo();
    const result = await receive(t.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 11 }]);
    expect(result.error?.message).toContain('RECEIPT_QUANTITY_EXCEEDS_OUTSTANDING');
  });

  it('blocks receiving before approval', async () => {
    const created = await t.lon.rpc('create_purchase_order', {
      p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: null, p_supplier_reference: randomUUID(),
    });
    const lines = await t.lon.rpc('replace_purchase_order_lines', {
      p_purchase_order_id: created.data, p_lines: [{ product_id: productId, ordered_quantity: 1, unit_cost: 130, notes: null }],
    });
    expect(lines.error).toBeNull();
    const poLines = await t.service.from('purchase_order_lines').select('id').eq('purchase_order_id', created.data);
    const result = await receive(t.lon, created.data as string, [{ purchaseOrderLineId: poLines.data?.[0]?.id, quantityReceived: 1 }]);
    expect(result.error?.message).toContain('PO_NOT_RECEIVABLE');
  });

  it('manager cannot receive another branch PO', async () => {
    const po = await createApprovedPo(t.admin, t.regLocationId);
    const result = await receive(t.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 1 }]);
    expect(result.error?.message).toContain('ACCESS_DENIED');
  });

  it('manager requires purchasing.receive_po', async () => {
    const po = await createApprovedPo();
    const deniedTenants = await createTestTenants({ lonPermissions: ['purchasing.view'] });
    try {
      const result = await receive(deniedTenants.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 1 }]);
      expect(result.error?.message).toContain('ACCESS_DENIED');
    } finally {
      await deniedTenants.cleanup();
    }
  });

  it('replayed request id does not double receive', async () => {
    const po = await createApprovedPo();
    const before = await inventory();
    const requestId = randomUUID();
    const input = [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 2 }];
    const first = await receive(t.lon, po.poId, input, requestId);
    const replay = await receive(t.lon, po.poId, input, requestId);
    expect(first.error).toBeNull();
    expect(replay.error).toBeNull();
    expect(replay.data).toBe(first.data);
    expect((await inventory()).on_hand).toBe(before.on_hand + 2);
  });

  it('concurrent receives cannot over-receive', async () => {
    const po = await createApprovedPo();
    const before = await inventory();
    const results = await Promise.all([
      receive(t.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 7 }]),
      receive(t.lon, po.poId, [{ purchaseOrderLineId: po.lineIds[0], quantityReceived: 7 }]),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    const line = await t.service.from('purchase_order_lines').select('received_quantity').eq('id', po.lineIds[0]).single();
    expect(line.data?.received_quantity).toBe(7);
    expect((await inventory()).on_hand).toBe(before.on_hand + 7);
  });

  it('successful receipt updates the supplier last cost', async () => {
    const po = await createApprovedPo(t.lon, t.lonLocationId, [
      { product_id: productId, ordered_quantity: 1, unit_cost: 147.25 },
    ]);
    const result = await receive(t.lon, po.poId, [
      { purchaseOrderLineId: po.lineIds[0], quantityReceived: 1 },
    ]);
    expect(result.error).toBeNull();

    const supplierProduct = await t.service
      .from('product_suppliers')
      .select('last_cost')
      .eq('product_id', productId)
      .eq('supplier_id', supplierId)
      .single();
    expect(supplierProduct.error).toBeNull();
    expect(Number(supplierProduct.data?.last_cost)).toBe(147.25);
  });

  it('failed receipt does not update the supplier last cost', async () => {
    const po = await createApprovedPo(t.lon, t.lonLocationId, [
      { product_id: productId, ordered_quantity: 2, unit_cost: 188.5 },
      { product_id: secondProductId, ordered_quantity: 2, unit_cost: 199.5 },
    ]);
    const before = await t.service
      .from('product_suppliers')
      .select('product_id, last_cost')
      .eq('supplier_id', supplierId)
      .in('product_id', [productId, secondProductId])
      .order('product_id');
    expect(before.error).toBeNull();

    const result = await receive(t.lon, po.poId, [
      { purchaseOrderLineId: po.lineIds[0], quantityReceived: 1 },
      { purchaseOrderLineId: po.lineIds[1], quantityReceived: 3 },
    ]);
    expect(result.error).not.toBeNull();

    const after = await t.service
      .from('product_suppliers')
      .select('product_id, last_cost')
      .eq('supplier_id', supplierId)
      .in('product_id', [productId, secondProductId])
      .order('product_id');
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
  });

  it('goods receipt, inventory movements, balances and PO counters commit atomically', async () => {
    const po = await createApprovedPo(t.lon, t.lonLocationId, [
      { product_id: productId, ordered_quantity: 4, unit_cost: 130 },
      { product_id: secondProductId, ordered_quantity: 4, unit_cost: 170 },
    ]);
    const beforeFirst = await inventory(productId);
    const beforeSecond = await inventory(secondProductId);
    const beforeMovements = await t.service
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .in('product_id', [productId, secondProductId]);
    expect(beforeMovements.error).toBeNull();
    const result = await receive(t.lon, po.poId, [
      { purchaseOrderLineId: po.lineIds[0], quantityReceived: 2 },
      { purchaseOrderLineId: po.lineIds[1], quantityReceived: 5 },
    ]);
    expect(result.error).not.toBeNull();

    const receipts = await t.service.from('goods_receipts').select('id').eq('purchase_order_id', po.poId);
    const movements = await t.service
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .in('product_id', [productId, secondProductId]);
    const lines = await t.service.from('purchase_order_lines').select('received_quantity').eq('purchase_order_id', po.poId).order('id');
    expect(receipts.data).toHaveLength(0);
    expect(movements.count).toBe(beforeMovements.count);
    expect(lines.data?.map((line) => line.received_quantity)).toEqual([0, 0]);
    expect(await inventory(productId)).toEqual(beforeFirst);
    expect(await inventory(secondProductId)).toEqual(beforeSecond);
  });
});
