import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[purchase order draft update] skipped: missing ${gap.join(', ')}\n`);
}

suite('purchase order draft update', () => {
  let t: TestTenants;
  let supplierId: string;
  let productId: string;
  let purchaseOrderId: string;
  let originalPoNumber: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'purchasing.view', 'purchasing.create_po'],
      regPermissions: ['inventory.view'],
    });

    const supplier = await t.admin.rpc('create_supplier', {
      p_name: 'Draft Update Supplier',
      p_abn: null,
      p_contact_name: null,
      p_phone: null,
      p_email: null,
      p_address: null,
      p_payment_terms: null,
      p_account_reference: null,
      p_notes: null,
    });
    if (supplier.error) throw supplier.error;
    supplierId = supplier.data as string;

    const product = await t.admin.rpc('create_product', {
      p_name: 'Draft Update Part',
      p_category_code: 'other_part',
      p_selling_price_incl_gst: 80,
      p_tyre_condition: null,
      p_tyre_brand: null,
      p_tyre_size: null,
    });
    if (product.error) throw product.error;
    productId = product.data as string;

    const created = await t.lon.rpc('create_purchase_order_draft', {
      p_location_id: t.lonLocationId,
      p_supplier_id: supplierId,
      p_notes: 'before',
      p_supplier_reference: 'BEFORE',
      p_lines: [
        {
          product_id: productId,
          ordered_quantity: 1,
          unit_cost: 20,
          notes: 'before line',
        },
      ],
    });
    if (created.error) throw created.error;
    purchaseOrderId = created.data as string;

    const header = await t.service
      .from('purchase_orders')
      .select('po_number')
      .eq('id', purchaseOrderId)
      .single();
    if (header.error) throw header.error;
    originalPoNumber = header.data.po_number;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('updates draft header and lines atomically without changing location or PO number', async () => {
    const result = await t.lon.rpc('update_purchase_order_draft', {
      p_purchase_order_id: purchaseOrderId,
      p_supplier_id: supplierId,
      p_notes: 'after',
      p_supplier_reference: 'AFTER',
      p_lines: [
        {
          product_id: productId,
          ordered_quantity: 6,
          unit_cost: 31.125,
          notes: 'after line',
        },
      ],
    });
    expect(result.error).toBeNull();

    const header = await t.service
      .from('purchase_orders')
      .select('location_id, po_number, supplier_reference, notes, status')
      .eq('id', purchaseOrderId)
      .single();
    expect(header.error).toBeNull();
    expect(header.data).toMatchObject({
      location_id: t.lonLocationId,
      po_number: originalPoNumber,
      supplier_reference: 'AFTER',
      notes: 'after',
      status: 'draft',
    });

    const lines = await t.service
      .from('purchase_order_lines')
      .select('ordered_quantity, unit_cost, notes')
      .eq('purchase_order_id', purchaseOrderId)
      .single();
    expect(lines.error).toBeNull();
    expect(lines.data?.ordered_quantity).toBe(6);
    expect(Number(lines.data?.unit_cost)).toBe(31.125);
    expect(lines.data?.notes).toBe('after line');
  });

  it('rolls header changes back if replacement lines are invalid', async () => {
    const result = await t.lon.rpc('update_purchase_order_draft', {
      p_purchase_order_id: purchaseOrderId,
      p_supplier_id: supplierId,
      p_notes: 'must not persist',
      p_supplier_reference: 'ROLLBACK-UPDATE',
      p_lines: [
        {
          product_id: '00000000-0000-0000-0000-000000000000',
          ordered_quantity: 1,
          unit_cost: 1,
          notes: null,
        },
      ],
    });
    expect(result.error).not.toBeNull();

    const header = await t.service
      .from('purchase_orders')
      .select('supplier_reference, notes')
      .eq('id', purchaseOrderId)
      .single();
    expect(header.error).toBeNull();
    expect(header.data).toMatchObject({ supplier_reference: 'AFTER', notes: 'after' });
  });
});
