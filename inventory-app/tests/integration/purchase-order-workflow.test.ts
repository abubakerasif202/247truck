import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[purchase order workflow] skipped: missing ${gap.join(', ')}\n`);
}

type PurchaseOrderRow = {
  id: string;
  location_id: string;
  supplier_id: string;
  po_number: string;
  status: string;
};

suite('purchase order workflow', () => {
  let t: TestTenants;
  let supplierId: string;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: [
        'inventory.view',
        'purchasing.view',
        'purchasing.create_po',
        'purchasing.submit_po',
      ],
      regPermissions: ['inventory.view', 'purchasing.view'],
    });

    const supplier = await t.admin.rpc('create_supplier', {
      p_name: 'PO Workflow Supplier',
      p_abn: null,
      p_contact_name: 'Purchasing Desk',
      p_phone: null,
      p_email: 'po-workflow@example.test',
      p_address: null,
      p_payment_terms: '30 days',
      p_account_reference: 'PO-WORKFLOW',
      p_notes: null,
    });
    if (supplier.error) throw supplier.error;
    supplierId = supplier.data as string;

    const product = await t.admin.rpc('create_product', {
      p_name: 'PO Workflow Tyre',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 650,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Workflow Brand',
      p_tyre_size: '11R22.5',
    });
    if (product.error) throw product.error;
    productId = product.data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  async function createPo(
    client: SupabaseClient,
    locationId: string,
    notes = 'workflow draft',
  ): Promise<string> {
    const result = await client.rpc('create_purchase_order', {
      p_location_id: locationId,
      p_supplier_id: supplierId,
      p_notes: notes,
      p_supplier_reference: 'SUP-REF-1',
    });
    expect(result.error).toBeNull();
    return result.data as string;
  }

  async function replaceLines(
    client: SupabaseClient,
    purchaseOrderId: string,
    quantity = 4,
    unitCost = 275.5,
  ) {
    return client.rpc('replace_purchase_order_lines', {
      p_purchase_order_id: purchaseOrderId,
      p_lines: [
        {
          product_id: productId,
          ordered_quantity: quantity,
          unit_cost: unitCost,
          notes: 'primary line',
        },
      ],
    });
  }

  it('creates a complete draft through one atomic RPC', async () => {
    const result = await t.lon.rpc('create_purchase_order_draft', {
      p_location_id: t.lonLocationId,
      p_supplier_id: supplierId,
      p_notes: 'atomic draft',
      p_supplier_reference: 'ATOMIC-DRAFT',
      p_lines: [
        {
          product_id: productId,
          ordered_quantity: 3,
          unit_cost: 201.125,
          notes: 'atomic line',
        },
      ],
    });

    expect(result.error).toBeNull();
    const purchaseOrderId = result.data as string;

    const header = await t.service
      .from('purchase_orders')
      .select('id, status, supplier_reference')
      .eq('id', purchaseOrderId)
      .single();
    expect(header.error).toBeNull();
    expect(header.data).toMatchObject({
      id: purchaseOrderId,
      status: 'draft',
      supplier_reference: 'ATOMIC-DRAFT',
    });

    const lines = await t.service
      .from('purchase_order_lines')
      .select('purchase_order_id, product_id, ordered_quantity, unit_cost, notes')
      .eq('purchase_order_id', purchaseOrderId);
    expect(lines.error).toBeNull();
    expect(lines.data).toHaveLength(1);
    expect(lines.data?.[0]).toMatchObject({
      purchase_order_id: purchaseOrderId,
      product_id: productId,
      ordered_quantity: 3,
      notes: 'atomic line',
    });
    expect(Number(lines.data?.[0]?.unit_cost)).toBe(201.125);
  });

  it('rolls the header back when atomic draft line creation fails', async () => {
    const result = await t.lon.rpc('create_purchase_order_draft', {
      p_location_id: t.lonLocationId,
      p_supplier_id: supplierId,
      p_notes: 'must roll back',
      p_supplier_reference: 'ATOMIC-ROLLBACK',
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
      .select('id')
      .eq('supplier_reference', 'ATOMIC-ROLLBACK');
    expect(header.error).toBeNull();
    expect(header.data).toHaveLength(0);
  });

  it('lets a Manager create a draft only for their assigned location', async () => {
    const id = await createPo(t.lon, t.lonLocationId);

    const own = await t.lon
      .from('purchase_orders')
      .select('id, location_id, supplier_id, po_number, status')
      .eq('id', id)
      .single<PurchaseOrderRow>();

    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({
      id,
      location_id: t.lonLocationId,
      supplier_id: supplierId,
      status: 'draft',
    });

    const otherBranch = await t.lon.rpc('create_purchase_order', {
      p_location_id: t.regLocationId,
      p_supplier_id: supplierId,
      p_notes: null,
      p_supplier_reference: null,
    });
    expect(otherBranch.error?.message).toContain('ACCESS_DENIED');
  });

  it('allocates atomic location-prefixed PO numbers', async () => {
    const lonId = await createPo(t.lon, t.lonLocationId, 'numbering LON');
    const regId = await createPo(t.admin, t.regLocationId, 'numbering REG');

    const rows = await t.service
      .from('purchase_orders')
      .select('id, po_number')
      .in('id', [lonId, regId]);
    expect(rows.error).toBeNull();

    const lonNumber = rows.data?.find((row) => row.id === lonId)?.po_number;
    const regNumber = rows.data?.find((row) => row.id === regId)?.po_number;
    expect(lonNumber).toMatch(/^LON-PO-\d{6}$/);
    expect(regNumber).toMatch(/^REG-PO-\d{6}$/);
    expect(lonNumber).not.toBe(regNumber);
  });

  it('allows line edits only while a PO is draft or rejected', async () => {
    const id = await createPo(t.lon, t.lonLocationId, 'editable draft');
    const draftEdit = await replaceLines(t.lon, id, 3, 250);
    expect(draftEdit.error).toBeNull();

    const submit = await t.lon.rpc('submit_purchase_order', {
      p_purchase_order_id: id,
    });
    expect(submit.error).toBeNull();

    const submittedEdit = await replaceLines(t.lon, id, 5, 260);
    expect(submittedEdit.error?.message).toContain('PO_NOT_EDITABLE');

    const reject = await t.admin.rpc('reject_purchase_order', {
      p_purchase_order_id: id,
      p_reason: 'Please revise quantity',
    });
    expect(reject.error).toBeNull();

    const rejectedEdit = await replaceLines(t.lon, id, 5, 260);
    expect(rejectedEdit.error).toBeNull();
  });

  it('requires purchasing.submit_po to submit', async () => {
    const id = await createPo(t.admin, t.regLocationId, 'submit permission');
    const lines = await replaceLines(t.admin, id, 2, 200);
    expect(lines.error).toBeNull();

    const denied = await t.reg.rpc('submit_purchase_order', {
      p_purchase_order_id: id,
    });
    expect(denied.error?.message).toContain('ACCESS_DENIED');
  });

  it('keeps approval and rejection Admin-only', async () => {
    const id = await createPo(t.lon, t.lonLocationId, 'admin decision');
    expect((await replaceLines(t.lon, id)).error).toBeNull();
    expect(
      (
        await t.lon.rpc('submit_purchase_order', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();

    const managerApprove = await t.lon.rpc('approve_purchase_order', {
      p_purchase_order_id: id,
    });
    expect(managerApprove.error?.message).toContain('ACCESS_DENIED');

    const managerReject = await t.lon.rpc('reject_purchase_order', {
      p_purchase_order_id: id,
      p_reason: 'crafted manager rejection',
    });
    expect(managerReject.error?.message).toContain('ACCESS_DENIED');

    const adminApprove = await t.admin.rpc('approve_purchase_order', {
      p_purchase_order_id: id,
    });
    expect(adminApprove.error).toBeNull();
  });

  it('does not change inventory when Admin approves a PO', async () => {
    const id = await createPo(t.lon, t.lonLocationId, 'approval stock invariant');
    expect((await replaceLines(t.lon, id, 7, 310)).error).toBeNull();

    const before = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(before.error).toBeNull();

    expect(
      (
        await t.lon.rpc('submit_purchase_order', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await t.admin.rpc('approve_purchase_order', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();

    const after = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
  });

  it('prevents line edits after approval', async () => {
    const id = await createPo(t.lon, t.lonLocationId, 'approved immutable lines');
    expect((await replaceLines(t.lon, id)).error).toBeNull();
    expect(
      (
        await t.lon.rpc('submit_purchase_order', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await t.admin.rpc('approve_purchase_order', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();

    const edit = await replaceLines(t.lon, id, 9, 299);
    expect(edit.error?.message).toContain('PO_NOT_EDITABLE');
  });

  it('hides PO line costs from Managers without inventory.view_cost', async () => {
    const id = await createPo(t.lon, t.lonLocationId, 'cost visibility');
    expect((await replaceLines(t.lon, id, 2, 333.25)).error).toBeNull();

    const directCost = await t.lon
      .from('purchase_order_lines')
      .select('unit_cost')
      .eq('purchase_order_id', id);
    expect(directCost.error).not.toBeNull();

    const managerDetail = await t.lon.rpc('purchase_order_detail', {
      p_purchase_order_id: id,
    });
    expect(managerDetail.error).toBeNull();
    expect(managerDetail.data?.[0]?.unit_cost ?? null).toBeNull();

    const adminDetail = await t.admin.rpc('purchase_order_detail', {
      p_purchase_order_id: id,
    });
    expect(adminDetail.error).toBeNull();
    expect(Number(adminDetail.data?.[0]?.unit_cost)).toBe(333.25);
  });

  it('writes audit events for PO creation and every status transition', async () => {
    const id = await createPo(t.lon, t.lonLocationId, 'audit workflow');
    expect((await replaceLines(t.lon, id)).error).toBeNull();
    expect(
      (
        await t.lon.rpc('submit_purchase_order', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await t.admin.rpc('approve_purchase_order', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await t.admin.rpc('mark_purchase_order_sent', {
          p_purchase_order_id: id,
        })
      ).error,
    ).toBeNull();

    const audit = await t.service
      .from('audit_events')
      .select('event_type, entity_id')
      .eq('entity_type', 'purchase_order')
      .eq('entity_id', id);
    expect(audit.error).toBeNull();

    const events = new Set((audit.data ?? []).map((row) => row.event_type));
    expect(events.has('PURCHASE_ORDER_CREATED')).toBe(true);
    expect(events.has('PURCHASE_ORDER_LINES_REPLACED')).toBe(true);
    expect(events.has('PURCHASE_ORDER_SUBMITTED')).toBe(true);
    expect(events.has('PURCHASE_ORDER_APPROVED')).toBe(true);
    expect(events.has('PURCHASE_ORDER_SENT')).toBe(true);
  });
});
