import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[stock movement notes GUC] skipped: missing ${gap.join(', ')}\n`);
}

/**
 * Regression for 20260912140000_stock_movement_notes_guc_reset.sql.
 *
 * post_inventory_movement_with_notes hands its note to the insert trigger via
 * a transaction-local GUC. Every PostgREST call is its own transaction, so the
 * leak could only ever show up when both entry points ran inside ONE
 * transaction — which is exactly what this test does through psql, acting as
 * the admin user the way the API gateway would.
 */
suite('stock movement notes GUC is reset within the same transaction', () => {
  let t: TestTenants;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: ['inventory.view'] });
    const product = await t.admin.rpc('create_product', {
      p_name: `GUC Reset Tyre ${randomUUID().slice(0, 8)}`, p_category_code: 'truck_tyre', p_selling_price_incl_gst: 400,
      p_tyre_condition: 'new', p_tyre_brand: 'Michelin', p_tyre_size: '295/80R22.5',
    });
    expect(product.error, JSON.stringify(product.error)).toBeNull();
    productId = product.data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('attaches note A to the wrapped movement only; a raw post in the same transaction inherits nothing', async () => {
    const noteA = `note-A-${randomUUID()}`;
    const firstRequest = randomUUID();
    const secondRequest = randomUUID();
    const claims = JSON.stringify({ sub: t.adminUser.id, role: 'authenticated' });

    const out = sql(`
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '${claims}', true);
      select movement_id from public.post_inventory_movement_with_notes(
        '${firstRequest}', '${productId}', '${t.lonLocationId}', 3, 'quick_stock_in',
        null, 100, null, null, null, null, '${noteA}');
      select current_setting('app.inventory_movement_notes', true);
      select movement_id from public.post_inventory_movement(
        '${secondRequest}', '${productId}', '${t.lonLocationId}', 2, 'quick_stock_in',
        null, 100, null, null, null, null);
      reset role;
      select request_id || '=' || coalesce(notes, '<null>')
      from public.inventory_movements
      where request_id in ('${firstRequest}', '${secondRequest}')
      order by request_id = '${firstRequest}' desc;
      commit;
    `);
    // psql echoes command tags for non-query statements; drop those but keep
    // blank lines, because a cleared GUC prints as an empty line.
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => !['BEGIN', 'SET', 'RESET', 'COMMIT'].includes(l));

    // Order of psql outputs: set_config echo, movement A id, GUC value after
    // the wrapper returned, movement B id, then the two ledger rows.
    expect(lines[0]).toBe(claims);
    expect(lines[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines[2], 'GUC must be cleared as soon as the wrapped call completes').toBe('');
    expect(lines[3]).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines[1]).not.toBe(lines[3]);
    expect(lines[4]).toBe(`${firstRequest}=${noteA}`);
    expect(lines[5]).toBe(`${secondRequest}=<null>`);

    // Both rows were committed and are readable by an authenticated user via
    // the column-granted base-table path (guards the notes column grant that
    // the dashboard "Recent movements" panel relies on).
    const { data, error } = await t.admin
      .from('inventory_movements')
      .select('request_id, notes')
      .in('request_id', [firstRequest, secondRequest]);
    expect(error).toBeNull();
    const byRequest = new Map((data ?? []).map((row) => [row.request_id as string, row.notes as string | null]));
    expect(byRequest.get(firstRequest)).toBe(noteA);
    expect(byRequest.get(secondRequest)).toBeNull();
  });
});
