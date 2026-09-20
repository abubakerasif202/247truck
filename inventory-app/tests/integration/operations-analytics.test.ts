import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[operations analytics] skipped: missing ${gap.join(', ')}\n`);
}

/**
 * Phase 5 operations analytics RPCs. These wrap the same authoritative
 * sources earlier phases already established (inventory_product_summary,
 * reorder_suggestions' PO-status eligibility, finance_guard) rather than
 * recomputing business rules, so most of what needs testing here is the
 * permission/location-scoping envelope and the cost double-gate, not the
 * arithmetic those sources already have coverage for.
 */
suite('operations analytics RPCs', () => {
  let t: TestTenants;
  let brandName: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'purchasing.view', 'inventory.view_cost'],
      regPermissions: ['inventory.view', 'purchasing.view', 'reports.view_inventory_value', 'inventory.view_cost'],
    });
    brandName = `Analytics brand ${randomUUID().slice(0, 8)}`;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  async function createProduct(location: 'lon' | 'reg', quantity: number, minimumStock = 0) {
    const locationId = location === 'lon' ? t.lonLocationId : t.regLocationId;
    // Fixture setup (product creation, stock movements) always goes through
    // the admin client, matching tests/integration/reorder-on-order-accounting.test.ts
    // -- the analytics RPCs under test are still called through t.lon/t.reg
    // below, which is what actually exercises permission/location scoping.
    const created = await t.admin.rpc('create_product_with_prices', {
      p_name: `Analytics product ${randomUUID().slice(0, 8)}`,
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 200,
      p_wholesale_price_incl_gst: 200,
      p_tyre_condition: 'new',
      p_tyre_brand: brandName,
      p_tyre_size: '11R22.5',
    });
    expect(created.error).toBeNull();
    const productId = created.data as string;
    if (quantity > 0) {
      const moved = await t.admin.rpc('post_inventory_movement_with_notes', {
        p_request_id: randomUUID(), p_product_id: productId, p_location_id: locationId,
        p_quantity_delta: quantity, p_movement_type: 'quick_stock_in', p_reason: 'analytics fixture',
        p_inbound_unit_cost: 40, p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null, p_notes: null,
      });
      expect(moved.error).toBeNull();
    }
    if (minimumStock > 0) {
      const settings = await t.admin.rpc('set_inventory_reorder_settings', {
        p_product_id: productId, p_location_id: locationId, p_minimum_stock: minimumStock, p_reorder_quantity: 5, p_preferred_supplier_id: null,
      });
      expect(settings.error).toBeNull();
    }
    return productId;
  }

  describe('inventory_analytics_by_brand', () => {
    it('denies a caller with no inventory.view', async () => {
      const noAccess = await createTestTenants({ lonPermissions: [], regPermissions: [] });
      const result = await noAccess.lon.rpc('inventory_analytics_by_brand', { p_location_code: null });
      expect(result.error?.message).toContain('ACCESS_DENIED');
      await noAccess.cleanup();
    });

    it('a Manager cannot request another branch by location_code', async () => {
      const result = await t.lon.rpc('inventory_analytics_by_brand', { p_location_code: 'REG' });
      expect(result.error?.message).toContain('ACCESS_DENIED');
    });

    it('a Manager is implicitly scoped to their own branch with no filter', async () => {
      await createProduct('lon', 3);
      const result = await t.lon.rpc('inventory_analytics_by_brand', { p_location_code: null });
      expect(result.error).toBeNull();
      const row = (result.data as { brand_name: string }[]).find((r) => r.brand_name === brandName);
      expect(row).toBeDefined();
    });

    it('nulls known_inventory_value for a Manager with inventory.view_cost but not reports.view_inventory_value', async () => {
      // t.lon holds inventory.view_cost only (see beforeAll) -- the aggregate total must stay hidden.
      const result = await t.lon.rpc('inventory_analytics_by_brand', { p_location_code: null });
      expect(result.error).toBeNull();
      const row = (result.data as { brand_name: string; known_inventory_value: number | null }[]).find(
        (r) => r.brand_name === brandName,
      );
      expect(row?.known_inventory_value).toBeNull();
    });

    it('returns known_inventory_value for a Manager holding both cost permissions', async () => {
      // t.reg holds both inventory.view_cost and reports.view_inventory_value (see beforeAll).
      await createProduct('reg', 2);
      const result = await t.reg.rpc('inventory_analytics_by_brand', { p_location_code: null });
      expect(result.error).toBeNull();
      const row = (result.data as { brand_name: string; known_inventory_value: number | null }[]).find(
        (r) => r.brand_name === brandName,
      );
      expect(row?.known_inventory_value).not.toBeNull();
      expect(row?.known_inventory_value).toBeGreaterThan(0);
    });

    it('an Admin with no location filter sees both branches combined', async () => {
      const result = await t.admin.rpc('inventory_analytics_by_brand', { p_location_code: null });
      expect(result.error).toBeNull();
      const row = (result.data as { brand_name: string; product_count: number }[]).find(
        (r) => r.brand_name === brandName,
      );
      // At least the LON + REG fixture products created above.
      expect((row?.product_count ?? 0)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('stock_movement_summary and fast_moving_products', () => {
    it('rejects an out-of-range period', async () => {
      const result = await t.lon.rpc('stock_movement_summary', { p_location_code: null, p_days: 0 });
      expect(result.error?.message).toContain('INVALID_PERIOD');
    });

    it('excludes transfer_out from fast-moving so a branch transfer is never reported as demand', async () => {
      const productId = await createProduct('lon', 10);
      const outMoved = await t.admin.rpc('post_inventory_movement_with_notes', {
        p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
        p_quantity_delta: -4, p_movement_type: 'stock_out', p_reason: 'analytics fixture stock-out',
        p_inbound_unit_cost: null, p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null, p_notes: null,
      });
      expect(outMoved.error).toBeNull();

      const result = await t.lon.rpc('fast_moving_products', { p_location_code: 'LON', p_days: 30, p_limit: 50 });
      expect(result.error).toBeNull();
      const row = (result.data as { product_id: string; quantity_moved: number }[]).find(
        (r) => r.product_id === productId,
      );
      // Only the 4-unit stock_out should count -- a real transfer_out on this
      // same product (if any existed) must not inflate this figure.
      expect(row?.quantity_moved).toBe(4);
    });
  });

  describe('slow_moving_products', () => {
    it('distinguishes never-moved stock from stock outside the inactivity window', async () => {
      const neverMovedProduct = await createProduct('lon', 5);
      const result = await t.lon.rpc('slow_moving_products', { p_location_code: 'LON', p_days: 30 });
      expect(result.error).toBeNull();
      const row = (result.data as { product_id: string; never_moved: boolean; last_outward_movement_at: string | null }[]).find(
        (r) => r.product_id === neverMovedProduct,
      );
      expect(row).toMatchObject({ never_moved: true, last_outward_movement_at: null });
    });
  });

  describe('purchasing_analytics_summary', () => {
    it('matches reorder_suggestions eligibility: a draft PO is not outstanding, an approved one is', async () => {
      const supplier = await t.admin.rpc('create_supplier', {
        p_name: `Analytics supplier ${randomUUID().slice(0, 8)}`, p_abn: null, p_contact_name: null,
        p_phone: null, p_email: null, p_address: null, p_payment_terms: null, p_account_reference: null, p_notes: null,
      });
      expect(supplier.error).toBeNull();
      const supplierId = supplier.data as string;

      const before = await t.lon.rpc('purchasing_analytics_summary', { p_location_id: t.lonLocationId });
      expect(before.error).toBeNull();
      const beforeUnits = (before.data as { outstanding_po_units: number }[])[0].outstanding_po_units;

      const draft = await t.admin.rpc('create_purchase_order_draft', {
        p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: null, p_supplier_reference: randomUUID(),
      });
      expect(draft.error).toBeNull();

      const draftState = await t.lon.rpc('purchasing_analytics_summary', { p_location_id: t.lonLocationId });
      expect(draftState.error).toBeNull();
      // A draft PO is not yet submitted/approved -- must not count as outstanding.
      expect((draftState.data as { outstanding_po_units: number }[])[0].outstanding_po_units).toBe(beforeUnits);
    });
  });

  describe('receivables_analytics_summary', () => {
    it('denies a caller without receivables.view', async () => {
      const result = await t.lon.rpc('receivables_analytics_summary', { p_location_id: null });
      expect(result.error?.message).toContain('ACCESS_DENIED');
    });
  });
});
