import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[review-inventory-pagination] skipped: missing ${missing.join(', ')}`);

const PRODUCT_COUNT = 520;
const LOW_STOCK_COUNT = 100; // subset with minimum_stock > on_hand at LON

run('Review remediation: inventory_summary_page + inventory_dashboard_metrics', () => {
  let t: TestTenants;
  let runTag: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view'],
      regPermissions: ['inventory.view'],
    });
    runTag = `BULKPAGE-${randomUUID().slice(0, 8)}`;

    // Direct bulk SQL, not the RPC path: 520 * (post_inventory_movement round
    // trips) would be far too slow for a test budget. Inserting products
    // directly is safe here (no financial/ledger invariants at stake) and the
    // products_seed_inventory_balances trigger auto-creates a zero row at both
    // LON and REG for every product, giving >=1040 balance rows for free.
    sql(`
      insert into public.products (name, category_code, selling_price_incl_gst, created_by)
      select '${runTag} ' || lpad(gs::text,5,'0'), 'rim_wheel', 50.00, '${t.adminUser.id}'
      from generate_series(1,${PRODUCT_COUNT}) gs;
    `);

    // Give every seeded product on-hand stock at both locations.
    sql(`
      update public.inventory_balances b set on_hand=10, reserved=0, weighted_average_cost=25.0000
      from public.products p, public.locations l
      where b.product_id=p.id and b.location_id=l.id and p.name like '${runTag} %';
    `);

    // First LOW_STOCK_COUNT products (by name) are low stock at LON only
    // (minimum_stock=20 > on_hand=10); REG keeps default settings (not low).
    sql(`
      insert into public.inventory_settings (product_id, location_id, minimum_stock, reorder_quantity)
      select p.id, l.id, 20, 40
      from public.products p, public.locations l
      where p.name like '${runTag} %' and l.code='LON'
        and p.name <= '${runTag} ' || lpad(${LOW_STOCK_COUNT}::text,5,'0')
      on conflict (product_id, location_id) do update set minimum_stock=excluded.minimum_stock, reorder_quantity=excluded.reorder_quantity;
    `);

    // Five products with on_hand > 0 but an *unknown* WAC at LON (never 0).
    sql(`
      update public.inventory_balances b set weighted_average_cost=null
      from public.products p
      where b.product_id=p.id and b.location_id='${t.lonLocationId}'
        and p.name in (select '${runTag} ' || lpad(gs::text,5,'0') from generate_series(1,5) gs);
    `);
  }, 180_000);

  afterAll(async () => {
    if (!t) return;
    sql(`
      delete from public.inventory_settings s using public.products p where s.product_id=p.id and p.name like '${runTag} %';
      delete from public.inventory_balances b using public.products p where b.product_id=p.id and p.name like '${runTag} %';
      delete from public.products where name like '${runTag} %';
    `);
    await t.cleanup();
  });

  it('pages through every product exactly once with no split across pages, and has_more transitions correctly', async () => {
    const seenProductIds = new Set<string>();
    const allRows: { product_id: string; location_code: string }[] = [];
    let offset = 0;
    let hasMore = true;
    let total = -1;
    let pages = 0;

    while (hasMore) {
      pages += 1;
      expect(pages).toBeLessThan(10);
      const res = await t.admin.rpc('inventory_summary_page', {
        p_location_code: null, p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
        p_low_stock_only: false, p_include_archived: false, p_offset: offset, p_limit: 200,
      });
      expect(res.error, JSON.stringify(res.error)).toBeNull();
      total = res.data.total_products;
      const rows = res.data.rows as { product_id: string; location_code: string }[];
      const pageProductIds = new Set(rows.map((r) => r.product_id));
      // No product's rows may be split across pages: none of this page's
      // product ids may have already been seen on an earlier page.
      for (const id of pageProductIds) expect(seenProductIds.has(id)).toBe(false);
      for (const id of pageProductIds) seenProductIds.add(id);
      allRows.push(...rows);
      hasMore = res.data.has_more;
      offset += 200;
    }

    expect(total).toBe(PRODUCT_COUNT);
    expect(seenProductIds.size).toBe(PRODUCT_COUNT);
    // Both LON and REG rows for every product.
    expect(allRows).toHaveLength(PRODUCT_COUNT * 2);
    const finalCheck = await t.admin.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: offset, p_limit: 200,
    });
    expect(finalCheck.data.has_more).toBe(false);
  });

  it('inventory_dashboard_metrics matches a direct SQL aggregate over the same scope (distinct products, not rows)', async () => {
    const bothLocations = await t.admin.rpc('inventory_dashboard_metrics', { p_location_code: null });
    expect(bothLocations.error, JSON.stringify(bothLocations.error)).toBeNull();
    const bothRow = Array.isArray(bothLocations.data) ? bothLocations.data[0] : bothLocations.data;
    const expectedBoth = sql(`
      select count(distinct b.product_id) || '|' || coalesce(sum(b.on_hand),0) || '|' ||
        count(*) filter (where (b.on_hand - b.reserved) < coalesce(s.minimum_stock,0))
      from public.inventory_balances b
      join public.products p on p.id=b.product_id and p.active
      left join public.inventory_settings s on s.product_id=b.product_id and s.location_id=b.location_id;
    `);
    const [expActive, expOnHand, expLow] = expectedBoth.split('|');
    expect(String(bothRow.active_products)).toBe(expActive);
    expect(String(bothRow.total_on_hand)).toBe(expOnHand);
    expect(String(bothRow.low_stock_items)).toBe(expLow);

    const lonOnly = await t.admin.rpc('inventory_dashboard_metrics', { p_location_code: 'LON' });
    expect(lonOnly.error).toBeNull();
    const lonRow = Array.isArray(lonOnly.data) ? lonOnly.data[0] : lonOnly.data;
    const expectedLon = sql(`
      select count(distinct b.product_id) || '|' || coalesce(sum(b.on_hand),0) || '|' ||
        count(*) filter (where (b.on_hand - b.reserved) < coalesce(s.minimum_stock,0))
      from public.inventory_balances b
      join public.products p on p.id=b.product_id and p.active
      left join public.inventory_settings s on s.product_id=b.product_id and s.location_id=b.location_id
      where b.location_id='${t.lonLocationId}';
    `);
    const [lonActive, lonOnHand, lonLow] = expectedLon.split('|');
    expect(String(lonRow.active_products)).toBe(lonActive);
    expect(String(lonRow.total_on_hand)).toBe(lonOnHand);
    expect(String(lonRow.low_stock_items)).toBe(lonLow);
    // Our seeded low-stock set alone should already contribute LOW_STOCK_COUNT.
    expect(Number(lonRow.low_stock_items)).toBeGreaterThanOrEqual(LOW_STOCK_COUNT);
  });

  it('Manager LON sees only LON rows via inventory_summary_page; REG is ACCESS_DENIED for a LON Manager', async () => {
    const lonPage = await t.lon.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 200,
    });
    expect(lonPage.error, JSON.stringify(lonPage.error)).toBeNull();
    expect((lonPage.data.rows as { location_code: string }[]).every((r) => r.location_code === 'LON')).toBe(true);

    const denied = await t.lon.rpc('inventory_summary_page', {
      p_location_code: 'REG', p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
    });
    expect(denied.error?.message).toBe('ACCESS_DENIED');

    const deniedMetrics = await t.lon.rpc('inventory_dashboard_metrics', { p_location_code: 'REG' });
    expect(deniedMetrics.error?.message).toBe('ACCESS_DENIED');
  });

  it('masks weighted_average_cost for a Manager without inventory.view_cost, and never reports 0 for an unknown cost with positive stock', async () => {
    const lonNoCost = await t.lon.rpc('inventory_summary_page', {
      p_location_code: 'LON', p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 200,
    });
    expect(lonNoCost.error).toBeNull();
    const rows = lonNoCost.data.rows as { weighted_average_cost: number | null; on_hand: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.weighted_average_cost === null)).toBe(true);

    const adminPage = await t.admin.rpc('inventory_summary_page', {
      p_location_code: 'LON', p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 200,
    });
    expect(adminPage.error).toBeNull();
    const adminRows = adminPage.data.rows as { weighted_average_cost: number | null; on_hand: number }[];
    const knownCostRows = adminRows.filter((r) => r.on_hand > 0);
    // 5 of our LON rows have a deliberately-unset WAC; they must read null, not 0.
    const unknownCostRows = knownCostRows.filter((r) => r.weighted_average_cost === null);
    expect(unknownCostRows.length).toBe(5);
    const knownRows = knownCostRows.filter((r) => r.weighted_average_cost !== null);
    expect(knownRows.every((r) => Number(r.weighted_average_cost) === 25)).toBe(true);
  });

  it('contrasts with the raw PostgREST view, which truncates at supabase/config.toml max_rows=1000 for the Admin', async () => {
    // >=1040 balance rows exist for our seeded products alone (520 * 2
    // locations), which already exceeds the project's configured max_rows.
    const raw = await t.admin.from('inventory_product_summary').select('product_id');
    expect(raw.error).toBeNull();
    expect((raw.data ?? []).length).toBe(1000);

    const rpcTotal = await t.admin.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: true, p_offset: 0, p_limit: 1,
    });
    expect(rpcTotal.error).toBeNull();
    // Scoped to just our seeded set, the RPC's DB-computed total correctly
    // reports every product (no silent 1000-row ceiling like the raw select).
    expect(rpcTotal.data.total_products).toBe(PRODUCT_COUNT);
  });

  it('rejects invalid pagination input', async () => {
    const badLimit = await t.admin.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: null, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 201,
    });
    expect(badLimit.error?.message).toBe('INVALID_LIMIT');

    const badOffset = await t.admin.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: null, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: -1, p_limit: 50,
    });
    expect(badOffset.error?.message).toBe('INVALID_LIMIT');
  });
});
