import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[review-inventory-authorization] skipped: missing ${missing.join(', ')}`);

run('Review remediation: inventory_summary_page / inventory_dashboard_metrics authorization', () => {
  let t: TestTenants;
  let runTag: string;
  let knownCostProductId: string;
  let unknownCostProductId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view'],
      regPermissions: ['inventory.view'],
    });
    runTag = `AUTHINV-${randomUUID().slice(0, 8)}`;

    sql(`
      insert into public.products (name, category_code, selling_price_incl_gst, created_by)
      select '${runTag} ' || lpad(gs::text,2,'0'), 'rim_wheel', 50.00, '${t.adminUser.id}'
      from generate_series(1,3) gs;
    `);
    sql(`
      update public.inventory_balances b set on_hand=10, reserved=0, weighted_average_cost=25.0000
      from public.products p, public.locations l
      where b.product_id=p.id and b.location_id=l.id and p.name like '${runTag} %';
    `);
    // Product 02 at LON has an unknown (null) WAC despite positive on_hand.
    sql(`
      update public.inventory_balances b set weighted_average_cost=null
      from public.products p
      where b.product_id=p.id and b.location_id='${t.lonLocationId}' and p.name='${runTag} 02';
    `);

    const ids = sql(`select id, name from public.products where name like '${runTag} %' order by name`);
    const rows = ids.split('\n').map((line) => line.split('|'));
    knownCostProductId = rows.find((r) => r[1] === `${runTag} 01`)![0];
    unknownCostProductId = rows.find((r) => r[1] === `${runTag} 02`)![0];
  }, 60_000);

  afterAll(async () => {
    if (!t) return;
    sql(`
      delete from public.inventory_settings s using public.products p where s.product_id=p.id and p.name like '${runTag} %';
      delete from public.inventory_balances b using public.products p where b.product_id=p.id and p.name like '${runTag} %';
      delete from public.products where name like '${runTag} %';
    `);
    await t.cleanup();
  });

  it('anonymous: both RPCs error and the raw view returns no rows', async () => {
    const anon = t.anon();
    const page = await anon.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
    });
    expect(page.error).not.toBeNull();
    expect(['42501', 'PGRST301', 'PGRST401', undefined]).toContain(page.error?.code);

    const metrics = await anon.rpc('inventory_dashboard_metrics', { p_location_code: null });
    expect(metrics.error).not.toBeNull();

    // Spec contradiction: `inventory_product_summary` is `revoke all ... from
    // public, anon`, so an anonymous select errors (permission denied, 42501)
    // rather than returning an empty row set. Asserting the actual behavior.
    const view = await anon.from('inventory_product_summary').select('product_id');
    expect(view.error).not.toBeNull();
    expect(view.error?.code).toBe('42501');
    expect(view.data).toBeNull();
  });

  it('manager without inventory.view: ACCESS_DENIED on both RPCs', async () => {
    const noAccess = await createTestTenants({ lonPermissions: [], regPermissions: [] });
    try {
      const page = await noAccess.reg.rpc('inventory_summary_page', {
        p_location_code: null, p_product_id: null, p_search: null, p_category: null, p_tyre_condition: null,
        p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
      });
      expect(page.error?.message).toBe('ACCESS_DENIED');
      expect(page.error?.code).toBe('42501');

      const metrics = await noAccess.reg.rpc('inventory_dashboard_metrics', { p_location_code: null });
      expect(metrics.error?.message).toBe('ACCESS_DENIED');
      expect(metrics.error?.code).toBe('42501');
    } finally {
      await noAccess.cleanup();
    }
  });

  it('disabled user (has inventory.view): ACCESS_DENIED on both RPCs; re-enabled afterwards', async () => {
    sql(`update public.user_profiles set active=false where user_id='${t.lonUser.id}'`);
    try {
      const page = await t.lon.rpc('inventory_summary_page', {
        p_location_code: null, p_product_id: null, p_search: null, p_category: null, p_tyre_condition: null,
        p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
      });
      expect(page.error?.message).toBe('ACCESS_DENIED');

      const metrics = await t.lon.rpc('inventory_dashboard_metrics', { p_location_code: null });
      expect(metrics.error?.message).toBe('ACCESS_DENIED');
    } finally {
      sql(`update public.user_profiles set active=true where user_id='${t.lonUser.id}'`);
    }
  });

  it("manager LON with only inventory.view: LON-only rows, weighted_average_cost always null, REG is ACCESS_DENIED, and valuation is ACCESS_DENIED", async () => {
    const page = await t.lon.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
    });
    expect(page.error, JSON.stringify(page.error)).toBeNull();
    const rows = page.data.rows as { location_code: string; weighted_average_cost: number | null; on_hand: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.location_code === 'LON')).toBe(true);
    expect(rows.every((r) => r.weighted_average_cost === null)).toBe(true);
    // Sanity: at least one of these rows genuinely has on_hand > 0 and a known
    // cost at the DB level (product 01) yet is still masked to null here.
    expect(rows.some((r) => r.on_hand > 0)).toBe(true);

    const denied = await t.lon.rpc('inventory_summary_page', {
      p_location_code: 'REG', p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
    });
    expect(denied.error?.message).toBe('ACCESS_DENIED');
    expect(denied.error?.code).toBe('42501');

    const deniedMetrics = await t.lon.rpc('inventory_dashboard_metrics', { p_location_code: 'REG' });
    expect(deniedMetrics.error?.message).toBe('ACCESS_DENIED');

    const valuation = await t.lon.rpc('inventory_valuation_for_scope', { p_location_code: 'LON' });
    expect(valuation.error?.message).toBe('ACCESS_DENIED');
    expect(valuation.error?.code).toBe('42501');
  });

  it('manager LON with inventory.view + inventory.view_cost: numeric cost where known, null (never 0) where unknown', async () => {
    const withCost = await createTestTenants({ lonPermissions: ['inventory.view', 'inventory.view_cost'] });
    try {
      const page = await withCost.lon.rpc('inventory_summary_page', {
        p_location_code: 'LON', p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
        p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
      });
      expect(page.error, JSON.stringify(page.error)).toBeNull();
      const rows = page.data.rows as { product_id: string; weighted_average_cost: number | null; on_hand: number }[];
      const known = rows.find((r) => r.product_id === knownCostProductId);
      const unknown = rows.find((r) => r.product_id === unknownCostProductId);
      expect(known).toBeDefined();
      expect(unknown).toBeDefined();
      expect(known!.on_hand).toBeGreaterThan(0);
      expect(unknown!.on_hand).toBeGreaterThan(0);
      expect(Number(known!.weighted_average_cost)).toBe(25);
      expect(unknown!.weighted_average_cost).toBeNull();
    } finally {
      await withCost.cleanup();
    }
  });

  it('admin: p_location_code LON returns only LON rows; null returns both locations', async () => {
    const lonOnly = await t.admin.rpc('inventory_summary_page', {
      p_location_code: 'LON', p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
    });
    expect(lonOnly.error).toBeNull();
    const lonRows = lonOnly.data.rows as { location_code: string }[];
    expect(lonRows.length).toBeGreaterThan(0);
    expect(lonRows.every((r) => r.location_code === 'LON')).toBe(true);

    const both = await t.admin.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
    });
    expect(both.error).toBeNull();
    const bothRows = both.data.rows as { location_code: string }[];
    expect(new Set(bothRows.map((r) => r.location_code))).toEqual(new Set(['LON', 'REG']));
  });

  it("inventory_dashboard_metrics('LON') active_products equals a direct-SQL distinct LON product count", async () => {
    const metrics = await t.admin.rpc('inventory_dashboard_metrics', { p_location_code: 'LON' });
    expect(metrics.error, JSON.stringify(metrics.error)).toBeNull();
    const row = Array.isArray(metrics.data) ? metrics.data[0] : metrics.data;
    const expected = sql(`
      select count(distinct b.product_id)
      from public.inventory_balances b
      join public.products p on p.id=b.product_id and p.active
      where b.location_id='${t.lonLocationId}';
    `);
    expect(String(row.active_products)).toBe(expected);
  });
});
