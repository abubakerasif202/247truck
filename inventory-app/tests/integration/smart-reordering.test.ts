import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[smart reordering] skipped: missing ${gap.join(', ')}\n`);
}

type SuggestionRow = {
  product_id: string;
  product_name: string;
  location_code: 'LON' | 'REG';
  available: number;
  minimum_stock: number;
  reorder_quantity: number;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
};

type DraftLine = {
  product_id: string;
  ordered_quantity: number;
  unit_cost: number | string;
};

suite('smart reordering', () => {
  let t: TestTenants;
  let productA: string;
  let productB: string;
  let productC: string;
  let supplierX: string;
  let supplierY: string;
  let inactiveSupplier: string;

  async function createProduct(name: string): Promise<string> {
    const result = await t.admin.rpc('create_product', {
      p_name: name,
      p_category_code: 'other_part',
      p_selling_price_incl_gst: 100,
    });
    if (result.error) throw result.error;
    return result.data as string;
  }

  async function createSupplier(name: string): Promise<string> {
    const result = await t.admin.rpc('create_supplier', {
      p_name: name,
      p_abn: null,
      p_contact_name: null,
      p_phone: null,
      p_email: null,
      p_address: null,
      p_payment_terms: null,
      p_account_reference: null,
      p_notes: null,
    });
    if (result.error) throw result.error;
    return result.data as string;
  }

  async function associate(
    productId: string,
    supplierId: string,
    options: { minimumOrderQty?: number; lastCost?: number | null } = {},
  ) {
    const result = await t.service.from('product_suppliers').insert({
      product_id: productId,
      supplier_id: supplierId,
      minimum_order_qty: options.minimumOrderQty ?? 1,
      last_cost: options.lastCost ?? 25,
    });
    if (result.error) throw result.error;
  }

  async function stockIn(productId: string, locationId: string, quantity: number) {
    const result = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: locationId,
      p_quantity_delta: quantity,
      p_movement_type: 'quick_stock_in',
      p_reason: 'smart reorder fixture',
      p_inbound_unit_cost: 25,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
    });
    if (result.error) throw result.error;
  }

  async function setSettings(
    client: TestTenants['admin'] | TestTenants['lon'] | TestTenants['reg'],
    productId: string,
    locationId: string,
    minimumStock: number,
    reorderQuantity: number,
    preferredSupplierId: string | null,
  ) {
    return client.rpc('set_inventory_reorder_settings', {
      p_product_id: productId,
      p_location_id: locationId,
      p_minimum_stock: minimumStock,
      p_reorder_quantity: reorderQuantity,
      p_preferred_supplier_id: preferredSupplierId,
    });
  }

  async function suggestions(client: TestTenants['admin'] | TestTenants['lon']) {
    return client.rpc('reorder_suggestions', { p_location_id: null }).returns<SuggestionRow[]>();
  }

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'purchasing.view', 'purchasing.create_po'],
      regPermissions: ['inventory.view', 'purchasing.view'],
    });

    [productA, productB, productC] = await Promise.all([
      createProduct('Smart reorder tyre A'),
      createProduct('Smart reorder tyre B'),
      createProduct('Smart reorder valve C'),
    ]);
    [supplierX, supplierY, inactiveSupplier] = await Promise.all([
      createSupplier('Smart supplier X'),
      createSupplier('Smart supplier Y'),
      createSupplier('Inactive smart supplier'),
    ]);

    await associate(productA, supplierX, { minimumOrderQty: 10, lastCost: 41.5 });
    await associate(productB, supplierX, { minimumOrderQty: 1, lastCost: 32 });
    await associate(productC, supplierY, { minimumOrderQty: 4, lastCost: 12 });
    await associate(productA, inactiveSupplier, { lastCost: 50 });
    const archived = await t.admin.rpc('set_supplier_active', {
      p_supplier_id: inactiveSupplier,
      p_active: false,
    });
    if (archived.error) throw archived.error;

    await stockIn(productA, t.lonLocationId, 2);
    await stockIn(productB, t.lonLocationId, 2);
    await stockIn(productC, t.lonLocationId, 20);
    await stockIn(productA, t.regLocationId, 2);
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('allows a Manager with purchasing.create_po to configure only their own location', async () => {
    const own = await setSettings(t.lon, productA, t.lonLocationId, 5, 4, supplierX);
    expect(own.error).toBeNull();

    const other = await setSettings(t.lon, productA, t.regLocationId, 5, 4, supplierX);
    expect(other.error?.message).toContain('ACCESS_DENIED');

    const admin = await setSettings(t.admin, productA, t.regLocationId, 5, 4, supplierX);
    expect(admin.error).toBeNull();
  });

  it('requires purchasing.create_po for settings and draft generation', async () => {
    const settings = await setSettings(t.reg, productA, t.regLocationId, 5, 4, supplierX);
    expect(settings.error?.message).toContain('ACCESS_DENIED');

    const draft = await t.reg.rpc('create_draft_purchase_orders_from_reorder', {
      p_location_id: t.regLocationId,
      p_product_ids: [productA],
    });
    expect(draft.error?.message).toContain('ACCESS_DENIED');
  });

  it('rejects negative thresholds, inactive suppliers, and unassociated suppliers', async () => {
    expect((await setSettings(t.admin, productA, t.lonLocationId, -1, 4, supplierX)).error?.message)
      .toContain('INVALID_SETTINGS');
    expect((await setSettings(t.admin, productA, t.lonLocationId, 5, -1, supplierX)).error?.message)
      .toContain('INVALID_SETTINGS');
    expect((await setSettings(t.admin, productA, t.lonLocationId, 5, 4, inactiveSupplier)).error?.message)
      .toContain('SUPPLIER_INACTIVE');
    expect((await setSettings(t.admin, productA, t.lonLocationId, 5, 4, supplierY)).error?.message)
      .toContain('SUPPLIER_NOT_ASSOCIATED');
  });

  it('projects only location-specific low-stock products with positive reorder quantities', async () => {
    expect((await setSettings(t.admin, productA, t.lonLocationId, 5, 4, supplierX)).error).toBeNull();
    expect((await setSettings(t.admin, productA, t.regLocationId, 5, 4, supplierX)).error).toBeNull();
    expect((await setSettings(t.admin, productB, t.lonLocationId, 2, 4, supplierX)).error).toBeNull();
    expect((await setSettings(t.admin, productC, t.lonLocationId, 25, 0, supplierY)).error).toBeNull();

    const admin = await suggestions(t.admin);
    expect(admin.error).toBeNull();
    const adminRows = (admin.data ?? []) as SuggestionRow[];
    expect(adminRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        product_id: productA,
        location_code: 'LON',
        available: 2,
        minimum_stock: 5,
        reorder_quantity: 4,
        preferred_supplier_id: supplierX,
        preferred_supplier_name: 'Smart supplier X',
      }),
      expect.objectContaining({
        product_id: productA,
        location_code: 'REG',
        preferred_supplier_id: supplierX,
      }),
    ]));
    expect(adminRows.some((row) => row.product_id === productB)).toBe(false);
    expect(adminRows.some((row) => row.product_id === productC)).toBe(false);

    const lon = await suggestions(t.lon);
    expect(lon.error).toBeNull();
    const lonRows = (lon.data ?? []) as SuggestionRow[];
    expect(lonRows.every((row) => row.location_code === 'LON')).toBe(true);
  });

  it('shows missing preferred suppliers as configuration-needed but never generates them', async () => {
    expect((await setSettings(t.admin, productB, t.lonLocationId, 5, 4, null)).error).toBeNull();
    const projection = await suggestions(t.admin);
    expect(projection.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        product_id: productB,
        preferred_supplier_id: null,
        preferred_supplier_name: null,
      }),
    ]));

    const generation = await t.admin.rpc('create_draft_purchase_orders_from_reorder', {
      p_location_id: t.lonLocationId,
      p_product_ids: [productB],
    });
    expect(generation.error?.message).toContain('PREFERRED_SUPPLIER_REQUIRED');
  });

  it('creates one draft PO per preferred supplier, uses MOQ, and deduplicates selections', async () => {
    expect((await setSettings(t.admin, productA, t.lonLocationId, 5, 4, supplierX)).error).toBeNull();
    expect((await setSettings(t.admin, productB, t.lonLocationId, 5, 12, supplierX)).error).toBeNull();
    expect((await setSettings(t.admin, productC, t.lonLocationId, 25, 6, supplierY)).error).toBeNull();

    const before = await t.service
      .from('purchase_orders')
      .select('id')
      .eq('supplier_reference', 'smart-reorder-test');
    expect(before.error).toBeNull();
    expect(before.data).toHaveLength(0);

    const generated = await t.admin.rpc('create_draft_purchase_orders_from_reorder', {
      p_location_id: t.lonLocationId,
      p_product_ids: [productA, productA, productB, productC],
    });
    expect(generated.error).toBeNull();
    expect(generated.data).toHaveLength(2);

    const headers = await t.service
      .from('purchase_orders')
      .select('id, supplier_id, location_id, status, submitted_at, approved_at, sent_at, supplier_reference')
      .in('id', generated.data as string[]);
    expect(headers.error).toBeNull();
    expect(headers.data).toHaveLength(2);
    expect(headers.data?.every((row) => row.location_id === t.lonLocationId && row.status === 'draft'))
      .toBe(true);
    expect(headers.data?.every((row) => !row.submitted_at && !row.approved_at && !row.sent_at)).toBe(true);

    const lines = await t.service
      .from('purchase_order_lines')
      .select('purchase_order_id, product_id, ordered_quantity, unit_cost')
      .in('purchase_order_id', generated.data as string[])
      .order('product_id')
      .returns<DraftLine & { purchase_order_id: string }[]>();
    expect(lines.error).toBeNull();
    expect(lines.data).toHaveLength(3);
    expect(lines.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ product_id: productA, ordered_quantity: 10, unit_cost: 41.5 }),
      expect.objectContaining({ product_id: productB, ordered_quantity: 12, unit_cost: 32 }),
      expect.objectContaining({ product_id: productC, ordered_quantity: 6, unit_cost: 12 }),
    ]));
  });

  it('does not create anything until explicit generation and rejects stale or inactive selections', async () => {
    const noAutomatic = await t.service
      .from('purchase_orders')
      .select('id');
    expect(noAutomatic.error).toBeNull();

    const forceInactive = await t.service
      .from('inventory_settings')
      .update({ preferred_supplier_id: inactiveSupplier })
      .eq('product_id', productA)
      .eq('location_id', t.lonLocationId);
    expect(forceInactive.error).toBeNull();

    const inactive = await t.admin.rpc('create_draft_purchase_orders_from_reorder', {
      p_location_id: t.lonLocationId,
      p_product_ids: [productA],
    });
    expect(inactive.error).not.toBeNull();

    const crossLocation = await t.lon.rpc('create_draft_purchase_orders_from_reorder', {
      p_location_id: t.regLocationId,
      p_product_ids: [productA],
    });
    expect(crossLocation.error?.message).toContain('ACCESS_DENIED');

    const headers = await t.service
      .from('purchase_orders')
      .select('id');
    expect(headers.data?.length).toBe(noAutomatic.data?.length);
  });
});
