import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { commitIdempotencyHash } from '@/lib/integrations/adelaide-auth';
import { sql } from '../integration/support/review-fixtures';
import { PASSWORD } from '../integration/support/fixtures';

/**
 * Adelaide integration upgrade proof. Runs twice from
 * scripts/verify-migration-upgrade.sh:
 *
 *   phase=seed   at the schema where 20260913110000 (the merged integration)
 *                is applied but the production-hardening migrations are not:
 *                writes real reservations, commits, releases, request hashes
 *                and balances through the RPCs of that schema and snapshots them.
 *   phase=verify after 20260913120000 + 20260914100000 have been applied on
 *                top of that data: every original field is intact, the new
 *                columns/relations exist with their protections, and the
 *                upgraded RPCs still honour the identities recorded before.
 */
const CLIENT = 'awt-upgrade-test';
const tables = ['adelaide_product_mappings', 'adelaide_inventory_reservations', 'adelaide_inventory_reservation_lines'] as const;
const snapshotPath = resolve('test-results/adelaide-upgrade-snapshot.json');
const phase = process.env.REMEDIATION_UPGRADE_PHASE;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type Snapshot = {
  rows: Record<string, Record<string, unknown>[]>;
  balances: Record<string, unknown>[];
  movements: Record<string, unknown>[];
  fixtures: { productId: string; mappingId: string; active: string; committed: string; released: string; order: Record<string, string>; commitRequestId: string; commitHash: string };
};

/** Every mapping, reservation and line row this test's client owns. */
function readRows(mappingId: string) {
  const reservations = `select id from public.adelaide_inventory_reservations where client_id='${CLIENT}'`;
  const scoped: Record<(typeof tables)[number], string> = {
    adelaide_product_mappings: `where t.id='${mappingId}' order by t.id`,
    adelaide_inventory_reservations: `where t.client_id='${CLIENT}' order by t.id`,
    adelaide_inventory_reservation_lines: `where t.reservation_id in (${reservations}) order by t.reservation_id, t.mapping_id`,
  };
  return Object.fromEntries(tables.map((table) => [table,
    JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (select * from public.${table} t ${scoped[table]}) t`)) as Record<string, unknown>[],
  ]));
}
const balancesFor = (productId: string) => JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(b) order by b.location_id), '[]'::jsonb) from public.inventory_balances b where b.product_id='${productId}'`)) as Record<string, unknown>[];
const movementsFor = (productId: string) => JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb) from public.inventory_movements m where m.product_id='${productId}'`)) as Record<string, unknown>[];

describe('Adelaide integration: populated schema upgrade preserves reservations, identities and balances', () => {
  it('seeds under the merged integration schema or verifies after the hardening migrations', async () => {
    expect(['seed', 'verify']).toContain(phase);
    const state = JSON.parse(readFileSync(resolve('test-results/upgrade-state.json'), 'utf8'));
    const service = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const regLocationId = state.locations.regLocationId as string;

    if (phase === 'seed') {
      expect(sql(`select to_regclass('public.adelaide_integration_requests')`)).toBe('');
      expect(sql(`select count(*) from information_schema.columns where table_name='adelaide_inventory_reservations' and column_name='paid_protected_at'`)).toBe('0');
      const admin = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      expect((await admin.auth.signInWithPassword({ email: state.users.adminEmail, password: PASSWORD })).error).toBeNull();
      const product = await admin.rpc('create_product_with_prices', {
        p_name: `${state.runTag} Adelaide 295/80R22.5`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 100, p_wholesale_price_incl_gst: 100,
        p_tyre_condition: 'new', p_tyre_brand: 'Upgrade Fixture', p_tyre_size: '295/80R22.5',
      });
      expect(product.error, JSON.stringify(product.error)).toBeNull();
      const productId = product.data as string;
      const stockIn = await admin.rpc('post_inventory_movement_with_notes', {
        p_request_id: randomUUID(), p_product_id: productId, p_location_id: regLocationId, p_quantity_delta: 12,
        p_movement_type: 'quick_stock_in', p_reason: null, p_inbound_unit_cost: 40, p_used_tyre_unit_id: null,
        p_source_type: null, p_source_id: null, p_supplier_name: null,
      p_notes: null });
      expect(stockIn.error, JSON.stringify(stockIn.error)).toBeNull();
      const mappingId = randomUUID();
      const mapped = await service.rpc('upsert_adelaide_product_mapping', { p_mapping_id: mappingId, p_website_product_id: `upgrade-${mappingId}`, p_inventory_product_id: productId });
      expect(mapped.error, JSON.stringify(mapped.error)).toBeNull();

      const order = { active: `UPG-A-${randomUUID().slice(0, 6)}`, committed: `UPG-C-${randomUUID().slice(0, 6)}`, released: `UPG-R-${randomUUID().slice(0, 6)}` };
      const reserve = async (reference: string, quantity: number) => {
        const result = await service.rpc('reserve_adelaide_inventory', {
          p_client_id: CLIENT, p_request_id: randomUUID(), p_request_hash: sha256(`reserve:${reference}`), p_order_reference: reference,
          p_location_id: regLocationId, p_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000 - 60_000).toISOString(),
          p_lines: [{ mapping_id: mappingId, quantity }],
        });
        expect(result.error, JSON.stringify(result.error)).toBeNull();
        return (result.data as { reservation_id: string }).reservation_id;
      };
      const active = await reserve(order.active, 2);
      const committed = await reserve(order.committed, 3);
      const released = await reserve(order.released, 1);
      const commitRequestId = randomUUID();
      const commitHash = sha256(`commit:${order.committed}`);
      const sale = await service.rpc('commit_adelaide_inventory_sale', { p_client_id: CLIENT, p_reservation_id: committed, p_request_id: commitRequestId, p_request_hash: commitHash, p_order_reference: order.committed });
      expect(sale.error, JSON.stringify(sale.error)).toBeNull();
      const release = await service.rpc('release_adelaide_inventory_reservation', { p_client_id: CLIENT, p_reservation_id: released, p_request_id: randomUUID(), p_reason: 'upgrade_release' });
      expect(release.error, JSON.stringify(release.error)).toBeNull();

      const snapshot: Snapshot = {
        rows: readRows(mappingId),
        balances: balancesFor(productId),
        movements: movementsFor(productId),
        fixtures: { productId, mappingId, active, committed, released, order, commitRequestId, commitHash },
      };
      expect(snapshot.rows.adelaide_inventory_reservations).toHaveLength(3);
      expect(snapshot.rows.adelaide_inventory_reservation_lines).toHaveLength(3);
      expect(snapshot.balances.find((b) => b.location_id === regLocationId)).toMatchObject({ on_hand: 9, reserved: 2 });
      writeFileSync(snapshotPath, JSON.stringify(snapshot));
      return;
    }

    const before = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;
    const f = before.fixtures;
    // 1. Every pre-upgrade field is byte-identical; only additive columns appeared.
    // The single deliberate exception is the committed hold's commit_request_hash,
    // re-keyed to the canonical identity so an older sale replays under the new protocol.
    const canonicalHash = commitIdempotencyHash({ reservationId: f.committed, orderReference: f.order.committed });
    const after = readRows(f.mappingId);
    for (const table of tables) {
      const keys = Object.keys(before.rows[table][0] ?? {}).sort().filter((key) => !(table === 'adelaide_inventory_reservations' && ['commit_request_hash', 'updated_at'].includes(key)));
      const canonical = (items: Record<string, unknown>[]) => items.map((row) => JSON.stringify(Object.fromEntries(keys.map((key) => [key, row[key]])))).sort();
      expect(canonical(after[table]), table).toEqual(canonical(before.rows[table]));
    }
    expect(balancesFor(f.productId)).toEqual(before.balances);
    expect(movementsFor(f.productId)).toEqual(before.movements);
    for (const row of after.adelaide_inventory_reservations) {
      expect(row).toMatchObject({ paid_protected_at: null, release_request_id: null, release_request_hash: null });
    }

    // 2. New relations exist and are unreachable by the application roles.
    for (const table of ['adelaide_integration_requests', 'adelaide_order_inventory_commits', 'adelaide_operation_runs', 'adelaide_website_products']) {
      expect(sql(`select relrowsecurity from pg_class where relname='${table}'`), table).toBe('t');
      expect(sql(`select count(*) from information_schema.role_table_grants where table_name='${table}' and grantee in ('anon','authenticated') and privilege_type<>'SELECT'`), table).toBe('0');
    }

    // 3. The committed sale keeps its request id and now carries the canonical hash: a replay under
    //    the new protocol (same id, canonical hash) converges; the stale raw-body hash and any foreign
    //    identity are refused; no new movement either way.
    expect(sql(`select commit_request_id||'|'||commit_request_hash from public.adelaide_inventory_reservations where id='${f.committed}'`)).toBe(`${f.commitRequestId}|${canonicalHash}`);
    expect(canonicalHash).not.toBe(f.commitHash);
    const replay = await service.rpc('commit_adelaide_inventory_sale', { p_client_id: CLIENT, p_reservation_id: f.committed, p_request_id: f.commitRequestId, p_request_hash: canonicalHash, p_order_reference: f.order.committed });
    expect(replay.error).toBeNull();
    expect((replay.data as { status: string }).status).toBe('committed');
    const stale = await service.rpc('commit_adelaide_inventory_sale', { p_client_id: CLIENT, p_reservation_id: f.committed, p_request_id: f.commitRequestId, p_request_hash: f.commitHash, p_order_reference: f.order.committed });
    expect(stale.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    const foreign = await service.rpc('commit_adelaide_inventory_sale', { p_client_id: CLIENT, p_reservation_id: f.committed, p_request_id: randomUUID(), p_request_hash: f.commitHash, p_order_reference: f.order.committed });
    expect(foreign.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(movementsFor(f.productId)).toEqual(before.movements);

    // 4. The still-active pre-upgrade hold is protected by the new paid handoff and then committed by the new queue.
    const registered = await service.rpc('register_adelaide_order_state', {
      p_client_id: CLIENT, p_request_id: randomUUID(), p_request_hash: sha256('state'), p_reservation_id: f.active,
      p_order_reference: f.order.active, p_payment_status: 'paid', p_order_status: 'confirmed', p_commit_request_id: randomUUID(),
    });
    expect(registered.error, JSON.stringify(registered.error)).toBeNull();
    expect(sql(`select paid_protected_at is not null from public.adelaide_inventory_reservations where id='${f.active}'`)).toBe('t');
    expect((await service.rpc('expire_adelaide_inventory_reservations', { p_client_id: CLIENT })).data).toBe(0);
    const processed = await service.rpc('process_adelaide_commit_queue', { p_client_id: CLIENT, p_limit: 25 });
    expect(processed.data).toMatchObject({ processed: 1, committed: 1, failed: 0 });
    expect(balancesFor(f.productId).find((b) => b.location_id === regLocationId)).toMatchObject({ on_hand: 7, reserved: 0 });
    expect(sql(`select status from public.adelaide_inventory_reservations where id='${f.released}'`)).toBe('released');
    // The released hold cannot be committed after the upgrade either.
    const dead = await service.rpc('commit_adelaide_inventory_sale', { p_client_id: CLIENT, p_reservation_id: f.released, p_request_id: randomUUID(), p_request_hash: sha256('x'), p_order_reference: f.order.released });
    expect(dead.error?.message).toContain('RESERVATION_NOT_ACTIVE');
  }, 60_000);
});
