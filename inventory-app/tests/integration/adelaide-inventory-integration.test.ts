import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

/**
 * Adelaide Wholesale Tyres ↔ 247 inventory integration, exercised directly at
 * the RPC boundary against the disposable local Supabase project.
 *
 * Every test provisions its own product, mapping and opening balance so tests
 * are independent of each other and of execution order. Nothing here relies on
 * a shared mutable balance.
 */
const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[adelaide integration] skipped: missing ${gap.join(', ')}\n`);
}

const CLIENT = 'awt-local-test';
const HASH = 'a'.repeat(64);
const HOLD_MS = 60_000;
/** Short real-time hold used by expiry tests; the RPC refuses holds in the past. */
const SHORT_HOLD_MS = 3_000;
const SHORT_HOLD_WAIT_MS = 6_000;

type Balance = { on_hand: number; reserved: number };
type Fixture = { productId: string; mappingId: string };
type ReservationResult = { reservation_id: string; status: string; expires_at: string; order_reference: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Expiry tests wait out a real short hold (plus Docker-on-Windows RPC latency).
vi.setConfig({ testTimeout: 20_000 });

suite('Adelaide external inventory RPCs', () => {
  let t: TestTenants;
  let seq = 0;

  const ref = () => `AWT-LOCAL-${randomUUID().slice(0, 8).toUpperCase()}`;
  // The database clock (Docker) can drift from the host clock by seconds after a
  // sleep/resume; hold expiries are expressed relative to the database clock.
  let clockSkewMs = 0;
  const expiresIn = (ms: number) => new Date(Date.now() + clockSkewMs + ms).toISOString();

  /** Isolated product + permanent mapping + opening stock at REG. */
  async function fixture(onHand: number, opts: { active?: boolean } = {}): Promise<Fixture> {
    seq += 1;
    const { data, error } = await t.admin.rpc('create_product', {
      p_name: `AWT Fixture ${seq} ${randomUUID().slice(0, 6)} 295/80R22.5`,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 100,
      p_tyre_condition: 'new',
      p_tyre_brand: 'AWT Fixture',
      p_tyre_size: '295/80R22.5',
    });
    if (error) throw error;
    const productId = data as string;
    const mappingId = randomUUID();
    const mapped = await t.service.rpc('upsert_adelaide_product_mapping', {
      p_mapping_id: mappingId,
      p_website_product_id: `fixture-${mappingId}`,
      p_inventory_product_id: productId,
    });
    if (mapped.error) throw mapped.error;
    if (onHand > 0) {
      const movement = await t.reg.rpc('post_inventory_movement', {
        p_request_id: randomUUID(),
        p_product_id: productId,
        p_location_id: t.regLocationId,
        p_quantity_delta: onHand,
        p_movement_type: 'quick_stock_in',
        p_reason: null,
        p_inbound_unit_cost: 50,
        p_used_tyre_unit_id: null,
        p_source_type: null,
        p_source_id: null,
      });
      if (movement.error) throw movement.error;
    }
    if (opts.active === false) {
      const deactivated = await t.admin.rpc('set_product_active', { p_product_id: productId, p_active: false });
      if (deactivated.error) throw deactivated.error;
    }
    return { productId, mappingId };
  }

  async function balance(productId: string, locationId = t.regLocationId): Promise<Balance> {
    const { data, error } = await t.service
      .from('inventory_balances')
      .select('on_hand,reserved')
      .eq('product_id', productId)
      .eq('location_id', locationId)
      .maybeSingle();
    if (error) throw error;
    return (data as Balance | null) ?? { on_hand: 0, reserved: 0 };
  }

  async function assertInvariants(productId: string) {
    const b = await balance(productId);
    expect(b.on_hand).toBeGreaterThanOrEqual(0);
    expect(b.reserved).toBeGreaterThanOrEqual(0);
    expect(b.reserved).toBeLessThanOrEqual(b.on_hand);
    expect(b.on_hand - b.reserved).toBeGreaterThanOrEqual(0);
    return b;
  }

  function reserve(args: {
    lines: { mapping_id: string; quantity: number }[];
    requestId?: string;
    hash?: string;
    order?: string;
    locationId?: string;
    expiresAt?: string;
    client?: string;
  }) {
    return t.service.rpc('reserve_adelaide_inventory', {
      p_client_id: args.client ?? CLIENT,
      p_request_id: args.requestId ?? randomUUID(),
      p_request_hash: args.hash ?? HASH,
      p_order_reference: args.order ?? ref(),
      p_location_id: args.locationId ?? t.regLocationId,
      p_expires_at: args.expiresAt ?? expiresIn(HOLD_MS),
      p_lines: args.lines,
    });
  }

  async function reserveOk(lines: { mapping_id: string; quantity: number }[], order = ref(), requestId = randomUUID()) {
    const result = await reserve({ lines, order, requestId });
    expect(result.error).toBeNull();
    return result.data as ReservationResult;
  }

  function commit(reservationId: string, order: string, requestId = randomUUID(), hash = HASH) {
    return t.service.rpc('commit_adelaide_inventory_sale', {
      p_client_id: CLIENT, p_reservation_id: reservationId, p_request_id: requestId, p_request_hash: hash, p_order_reference: order,
    });
  }

  function release(reservationId: string, requestId = randomUUID(), reason = 'test_release') {
    return t.service.rpc('release_adelaide_inventory_reservation', {
      p_client_id: CLIENT, p_reservation_id: reservationId, p_request_id: requestId, p_reason: reason,
    });
  }

  function availability(mappingIds: string[], locationId = t.regLocationId) {
    return t.service.rpc('adelaide_inventory_availability', { p_client_id: CLIENT, p_location_id: locationId, p_mapping_ids: mappingIds });
  }

  async function movements(reservationId: string) {
    const { data, error } = await t.service
      .from('inventory_movements')
      .select('request_id,product_id,location_id,quantity_delta,movement_type,source_type,source_id,actor_user_id,actor_type,integration_client_id,external_reservation_id')
      .eq('external_reservation_id', reservationId);
    if (error) throw error;
    return data ?? [];
  }

  async function reservationRow(reservationId: string) {
    const { data, error } = await t.service.from('adelaide_inventory_reservations').select('*').eq('id', reservationId).single();
    if (error) throw error;
    return data as { status: string; committed_at: string | null; released_at: string | null; release_reason: string | null };
  }

  beforeAll(async () => {
    t = await createTestTenants({ regPermissions: ['inventory.stock_in', 'inventory.stock_out'] });
    const probe = await fixture(1);
    const { data } = await t.service.from('inventory_balances').select('updated_at').eq('product_id', probe.productId).eq('location_id', t.regLocationId).single();
    clockSkewMs = Math.max(0, Date.parse((data as { updated_at: string }).updated_at) - Date.now());
  });
  afterAll(async () => { await t?.cleanup(); });

  // 1 -------------------------------------------------------------------------
  it('reports on_hand, reserved and available = on_hand - reserved', async () => {
    const f = await fixture(10);
    await reserveOk([{ mapping_id: f.mappingId, quantity: 3 }]);
    const { data, error } = await availability([f.mappingId]);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = (data as Record<string, unknown>[])[0];
    expect(row).toMatchObject({ mapping_id: f.mappingId, on_hand: 10, reserved: 3, available: 7 });
    // No cost or finance fields cross the boundary.
    expect(Object.keys(row).sort()).toEqual(['available', 'inventory_product_id', 'mapping_id', 'on_hand', 'reserved', 'updated_at']);
  });

  // 2 -------------------------------------------------------------------------
  it('creates an active reservation and increments reserved only', async () => {
    const f = await fixture(10);
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 4 }]);
    expect(made.status).toBe('active');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 4 });
    await assertInvariants(f.productId);
  });

  // 3 -------------------------------------------------------------------------
  it('rejects a reservation that exceeds available stock without a partial hold', async () => {
    const f = await fixture(3);
    const result = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 4 }] });
    expect(result.error?.message).toContain('INSUFFICIENT_STOCK');
    expect(await balance(f.productId)).toEqual({ on_hand: 3, reserved: 0 });
  });

  // 4 -------------------------------------------------------------------------
  it('fails a multi-line reservation atomically (A=10, B=1; request A=2, B=2)', async () => {
    const a = await fixture(10);
    const b = await fixture(1);
    const result = await reserve({ lines: [{ mapping_id: a.mappingId, quantity: 2 }, { mapping_id: b.mappingId, quantity: 2 }] });
    expect(result.error?.message).toContain('INSUFFICIENT_STOCK');
    expect(await balance(a.productId)).toEqual({ on_hand: 10, reserved: 0 });
    expect(await balance(b.productId)).toEqual({ on_hand: 1, reserved: 0 });
    const { count } = await t.service.from('adelaide_inventory_reservation_lines').select('*', { count: 'exact', head: true }).eq('mapping_id', a.mappingId);
    expect(count).toBe(0);
  });

  // 5 -------------------------------------------------------------------------
  it('lets exactly one of two simultaneous holds consume the final 4 units', async () => {
    const f = await fixture(4);
    const results = await Promise.all([
      reserve({ lines: [{ mapping_id: f.mappingId, quantity: 4 }] }),
      reserve({ lines: [{ mapping_id: f.mappingId, quantity: 4 }] }),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message.includes('INSUFFICIENT_STOCK'))).toHaveLength(1);
    const after = await assertInvariants(f.productId);
    expect(after).toEqual({ on_hand: 4, reserved: 4 });
  });

  it('never oversells under a burst of competing holds', async () => {
    const f = await fixture(5);
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve({ lines: [{ mapping_id: f.mappingId, quantity: 2 }] })));
    const succeeded = results.filter((r) => !r.error).length;
    expect(succeeded).toBe(2);
    expect(results.filter((r) => r.error?.message.includes('INSUFFICIENT_STOCK'))).toHaveLength(4);
    const after = await assertInvariants(f.productId);
    expect(after).toEqual({ on_hand: 5, reserved: 4 });
  });

  // 6 -------------------------------------------------------------------------
  it('returns the same reservation for the same request ID and payload without double holding', async () => {
    const f = await fixture(10);
    const requestId = randomUUID();
    const order = ref();
    const first = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 2 }], requestId, order });
    const replay = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 2 }], requestId, order, expiresAt: expiresIn(HOLD_MS + 5_000) });
    expect(first.error).toBeNull();
    expect(replay.error).toBeNull();
    expect((replay.data as ReservationResult).reservation_id).toBe((first.data as ReservationResult).reservation_id);
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 2 });
  });

  // 7 -------------------------------------------------------------------------
  it('rejects reuse of a request ID with a different payload hash', async () => {
    const f = await fixture(10);
    const requestId = randomUUID();
    const first = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 2 }], requestId, hash: 'b'.repeat(64) });
    expect(first.error).toBeNull();
    const misuse = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 5 }], requestId, hash: 'c'.repeat(64) });
    expect(misuse.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 2 });
  });

  // 8 & 9 ---------------------------------------------------------------------
  it('releases a hold and treats a duplicate release as a no-op', async () => {
    const f = await fixture(10);
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 3 }]);
    const released = await release(made.reservation_id);
    expect(released.error).toBeNull();
    expect((released.data as { status: string }).status).toBe('released');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
    const again = await release(made.reservation_id);
    expect(again.error).toBeNull();
    expect((again.data as { status: string }).status).toBe('released');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
    expect(await movements(made.reservation_id)).toHaveLength(0);
  });

  // 10, 11, 19, 20 --------------------------------------------------------------
  it('commits a sale once, attributes the movement, and ignores a duplicate commit', async () => {
    const f = await fixture(10);
    const order = ref();
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 2 }], order);
    const commitId = randomUUID();
    const committed = await commit(made.reservation_id, order, commitId);
    expect(committed.error).toBeNull();
    expect((committed.data as { status: string }).status).toBe('committed');
    expect(await balance(f.productId)).toEqual({ on_hand: 8, reserved: 0 });

    const replay = await commit(made.reservation_id, order, commitId);
    expect(replay.error).toBeNull();
    expect((replay.data as { status: string }).status).toBe('committed');
    expect(await balance(f.productId)).toEqual({ on_hand: 8, reserved: 0 });

    // A second commit with a *different* request ID must not deduct either.
    const other = await commit(made.reservation_id, order, randomUUID());
    expect(other.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(await balance(f.productId)).toEqual({ on_hand: 8, reserved: 0 });

    const rows = await movements(made.reservation_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      product_id: f.productId,
      location_id: t.regLocationId,
      quantity_delta: -2,
      movement_type: 'stock_out',
      source_type: 'adelaide_wholesale_tyres',
      source_id: order,
      actor_user_id: null,
      actor_type: 'integration',
      integration_client_id: CLIENT,
      external_reservation_id: made.reservation_id,
    });
    expect(rows[0].request_id).toMatch(/^[0-9a-f-]{36}$/);

    const audit = await t.service.from('audit_events').select('event_type,actor_type,integration_client_id,details')
      .eq('entity_id', made.reservation_id).eq('event_type', 'ADELAIDE_SALE_COMMITTED');
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(1);
    expect(audit.data![0]).toMatchObject({ actor_type: 'integration', integration_client_id: CLIENT });
    expect((audit.data![0].details as { order_reference: string; request_id: string })).toMatchObject({ order_reference: order, request_id: commitId });
  });

  it('rejects a commit whose order reference does not match the hold', async () => {
    const f = await fixture(5);
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 1 }], ref());
    const result = await commit(made.reservation_id, 'AWT-OTHER-ORDER');
    expect(result.error?.message).toContain('ORDER_REFERENCE_MISMATCH');
    expect(await balance(f.productId)).toEqual({ on_hand: 5, reserved: 1 });
  });

  // 12 --------------------------------------------------------------------------
  it('refuses to commit a released reservation', async () => {
    const f = await fixture(10);
    const order = ref();
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 2 }], order);
    expect((await release(made.reservation_id)).error).toBeNull();
    const result = await commit(made.reservation_id, order);
    expect(result.error?.message).toContain('RESERVATION_NOT_ACTIVE');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
    expect(await movements(made.reservation_id)).toHaveLength(0);
  });

  // 13 --------------------------------------------------------------------------
  it('never restocks a committed sale on a later release', async () => {
    const f = await fixture(10);
    const order = ref();
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 2 }], order);
    expect((await commit(made.reservation_id, order)).error).toBeNull();
    const released = await release(made.reservation_id);
    expect(released.error).toBeNull();
    expect((released.data as { status: string }).status).toBe('committed');
    expect(await balance(f.productId)).toEqual({ on_hand: 8, reserved: 0 });
    expect(await movements(made.reservation_id)).toHaveLength(1);
  });

  // 14 --------------------------------------------------------------------------
  it('expires stale holds and returns their quantity to available', async () => {
    const f = await fixture(10);
    const made = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 4 }], expiresAt: expiresIn(SHORT_HOLD_MS) });
    expect(made.error).toBeNull();
    const reservationId = (made.data as ReservationResult).reservation_id;
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 4 });
    await sleep(SHORT_HOLD_WAIT_MS);
    const expired = await t.service.rpc('expire_adelaide_inventory_reservations', { p_client_id: CLIENT });
    expect(expired.error).toBeNull();
    expect(Number(expired.data)).toBeGreaterThanOrEqual(1);
    expect(await assertInvariants(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
    expect((await reservationRow(reservationId)).status).toBe('expired');
    expect(await movements(reservationId)).toHaveLength(0);
    // Expiry is a terminal state: a later commit is refused and a release is a no-op.
    const late = await commit(reservationId, (made.data as ReservationResult).order_reference);
    expect(late.error?.message).toContain('RESERVATION_NOT_ACTIVE');
    expect((await release(reservationId)).error).toBeNull();
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
  });

  it('availability queries expire stale holds inline', async () => {
    const f = await fixture(6);
    const short = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 2 }], expiresAt: expiresIn(SHORT_HOLD_MS) });
    expect(short.error).toBeNull();
    expect(await balance(f.productId)).toEqual({ on_hand: 6, reserved: 2 });
    await sleep(SHORT_HOLD_WAIT_MS);
    const { data } = await availability([f.mappingId]);
    expect((data as Record<string, unknown>[])[0]).toMatchObject({ on_hand: 6, reserved: 0, available: 6 });
  });

  // 15 --------------------------------------------------------------------------
  it('resolves an expiry/commit race into exactly one safe terminal state', async () => {
    const f = await fixture(10);
    const order = ref();
    const made = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 3 }], order, expiresAt: expiresIn(SHORT_HOLD_MS) });
    expect(made.error).toBeNull();
    const reservationId = (made.data as ReservationResult).reservation_id;
    await sleep(SHORT_HOLD_WAIT_MS);

    const [expired, committed] = await Promise.all([
      t.service.rpc('expire_adelaide_inventory_reservations', { p_client_id: CLIENT }),
      commit(reservationId, order),
    ]);
    expect(expired.error).toBeNull();
    // Either the sweep expired it first (commit refused: NOT_ACTIVE) or the commit
    // itself expired the stale hold durably and reported it (status expired).
    if (committed.error) expect(committed.error.message).toContain('RESERVATION_NOT_ACTIVE');
    else expect((committed.data as { status: string }).status).toBe('expired');

    const row = await reservationRow(reservationId);
    expect(row.status).toBe('expired');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
    expect(await movements(reservationId)).toHaveLength(0);
  });

  it('resolves a concurrent commit/release of an active hold into one terminal state', async () => {
    const f = await fixture(10);
    const order = ref();
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 3 }], order);
    const [committed, released] = await Promise.all([commit(made.reservation_id, order), release(made.reservation_id)]);
    // Release of a committed hold is a no-op; commit of a released hold is refused.
    expect(released.error).toBeNull();
    const row = await reservationRow(made.reservation_id);
    expect(['committed', 'released']).toContain(row.status);
    const b = await assertInvariants(f.productId);
    if (row.status === 'committed') {
      expect(committed.error).toBeNull();
      expect(b).toEqual({ on_hand: 7, reserved: 0 });
      expect(await movements(made.reservation_id)).toHaveLength(1);
    } else {
      expect(committed.error?.message).toContain('RESERVATION_NOT_ACTIVE');
      expect(b).toEqual({ on_hand: 10, reserved: 0 });
      expect(await movements(made.reservation_id)).toHaveLength(0);
    }
  });

  // 16 --------------------------------------------------------------------------
  it('rejects a reservation against a location that does not hold the product', async () => {
    const f = await fixture(10);
    const result = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 1 }], locationId: t.lonLocationId });
    expect(result.error?.message).toContain('INSUFFICIENT_STOCK');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
    expect(await balance(f.productId, t.lonLocationId)).toEqual({ on_hand: 0, reserved: 0 });
    const { count } = await t.service.from('adelaide_inventory_reservation_lines').select('*', { count: 'exact', head: true }).eq('mapping_id', f.mappingId);
    expect(count).toBe(0);
    const other = await availability([f.mappingId], t.lonLocationId);
    // Every location carries a balance row; the other branch simply has nothing sellable.
    expect((other.data as Record<string, unknown>[])[0]).toMatchObject({ on_hand: 0, reserved: 0, available: 0 });
  });

  // 17 --------------------------------------------------------------------------
  it('rejects unknown mappings and never holds a different tyre', async () => {
    const f = await fixture(10);
    const result = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 1 }, { mapping_id: randomUUID(), quantity: 1 }] });
    expect(result.error?.message).toContain('UNKNOWN_PRODUCT_MAPPING');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
    const unknownOnly = await availability([randomUUID()]);
    expect(unknownOnly.error).toBeNull();
    expect(unknownOnly.data).toEqual([]);
  });

  // 18 --------------------------------------------------------------------------
  it('hides inactive products from availability and refuses to reserve them', async () => {
    const f = await fixture(10, { active: false });
    const { data } = await availability([f.mappingId]);
    expect(data).toEqual([]);
    const result = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 1 }] });
    expect(result.error?.message).toContain('PRODUCT_INACTIVE');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
  });

  it('validates line shapes before touching inventory', async () => {
    const f = await fixture(10);
    for (const lines of [
      [{ mapping_id: f.mappingId, quantity: 0 }],
      [{ mapping_id: f.mappingId, quantity: -1 }],
      [{ mapping_id: f.mappingId, quantity: 1.5 }],
      [{ mapping_id: f.mappingId, quantity: 1001 }],
      [{ mapping_id: 'not-a-uuid', quantity: 1 }],
      [{ mapping_id: f.mappingId }],
      [],
    ] as unknown as { mapping_id: string; quantity: number }[][]) {
      const result = await reserve({ lines });
      expect(result.error?.message, JSON.stringify(lines)).toContain('INVALID_RESERVATION_LINES');
    }
    const duplicate = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 1 }, { mapping_id: f.mappingId, quantity: 1 }] });
    expect(duplicate.error?.message).toContain('DUPLICATE_RESERVATION_PRODUCT');
    const tooLong = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 1 }], expiresAt: expiresIn(3 * 60 * 60 * 1000) });
    expect(tooLong.error?.message).toContain('INVALID_RESERVATION_EXPIRY');
    const past = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 1 }], expiresAt: expiresIn(-30_000) });
    expect(past.error?.message).toContain('INVALID_RESERVATION_EXPIRY');
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 0 });
  });

  it('keeps internal 247 stock-outs visible to the next availability query', async () => {
    const f = await fixture(10);
    const internal = await t.reg.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: f.productId, p_location_id: t.regLocationId,
      p_quantity_delta: -3, p_movement_type: 'stock_out', p_reason: 'POS sale', p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null,
    });
    expect(internal.error).toBeNull();
    const { data } = await availability([f.mappingId]);
    expect((data as Record<string, unknown>[])[0]).toMatchObject({ on_hand: 7, reserved: 0, available: 7 });
    const tooMany = await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 8 }] });
    expect(tooMany.error?.message).toContain('INSUFFICIENT_STOCK');
    expect((await reserve({ lines: [{ mapping_id: f.mappingId, quantity: 7 }] })).error).toBeNull();
  });

  it('protects a web hold from an internal stock-out that would breach it', async () => {
    const f = await fixture(5);
    await reserveOk([{ mapping_id: f.mappingId, quantity: 4 }]);
    const breach = await t.reg.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: f.productId, p_location_id: t.regLocationId,
      p_quantity_delta: -2, p_movement_type: 'stock_out', p_reason: 'POS sale', p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null,
    });
    expect(breach.error).not.toBeNull();
    expect(await assertInvariants(f.productId)).toEqual({ on_hand: 5, reserved: 4 });
  });

  it('does not let a website product be re-pointed to another tyre by a different mapping id', async () => {
    const f = await fixture(1);
    const other = await fixture(1);
    const result = await t.service.rpc('upsert_adelaide_product_mapping', {
      p_mapping_id: randomUUID(), p_website_product_id: `fixture-${f.mappingId}`, p_inventory_product_id: other.productId,
    });
    expect(result.error?.message).toContain('MAPPING_CONFLICT');
  });

  it('protects a paid order from expiry and durably commits it through the retry queue', async () => {
    const f = await fixture(6);
    const order = ref();
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 2 }], order);
    const stateRequestId = randomUUID();
    const registered = await t.service.rpc('register_adelaide_order_state', {
      p_client_id: CLIENT,
      p_request_id: stateRequestId,
      p_request_hash: 'd'.repeat(64),
      p_reservation_id: made.reservation_id,
      p_order_reference: order,
      p_payment_status: 'paid',
      p_order_status: 'confirmed',
    });
    expect(registered.error).toBeNull();
    expect((registered.data as { inventory_state: string }).inventory_state).toBe('commit_pending');

    const expired = await t.service.rpc('expire_adelaide_inventory_reservations', { p_client_id: CLIENT });
    expect(expired.error).toBeNull();
    expect((await reservationRow(made.reservation_id)).status).toBe('active');

    const processed = await t.service.rpc('process_adelaide_commit_queue', { p_client_id: CLIENT, p_limit: 25 });
    expect(processed.error).toBeNull();
    expect(processed.data).toMatchObject({ processed: 1, committed: 1, failed: 0 });
    expect((await reservationRow(made.reservation_id)).status).toBe('committed');
    expect(await balance(f.productId)).toEqual({ on_hand: 4, reserved: 0 });
    expect(await movements(made.reservation_id)).toHaveLength(1);

    const duplicateWorker = await t.service.rpc('process_adelaide_commit_queue', { p_client_id: CLIENT, p_limit: 25 });
    expect(duplicateWorker.error).toBeNull();
    expect(duplicateWorker.data).toMatchObject({ processed: 0, committed: 0, failed: 0 });
    expect(await movements(made.reservation_id)).toHaveLength(1);
  });

  it('rejects release request-id reuse with a changed payload but accepts a new terminal-status query', async () => {
    const f = await fixture(5);
    const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 1 }]);
    const requestId = randomUUID();
    expect((await release(made.reservation_id, requestId, 'customer_cancelled')).error).toBeNull();
    const changed = await release(made.reservation_id, requestId, 'fraud_review');
    expect(changed.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    const terminal = await release(made.reservation_id, randomUUID(), 'status_retry');
    expect(terminal.error).toBeNull();
    expect((terminal.data as { status: string }).status).toBe('released');
    expect(await balance(f.productId)).toEqual({ on_hand: 5, reserved: 0 });
  });

  it('persists request replay identity and rejects changed method, path, or payload', async () => {
    const requestId = randomUUID();
    const input = { p_client_id: CLIENT, p_request_id: requestId, p_method: 'POST', p_pathname: '/api/integrations/adelaide/orders/state', p_body_hash: 'e'.repeat(64) };
    expect((await t.service.rpc('record_adelaide_integration_request', input)).data).toBe(1);
    expect((await t.service.rpc('record_adelaide_integration_request', input)).data).toBe(2);
    for (const changed of [
      { ...input, p_method: 'DELETE' },
      { ...input, p_pathname: '/api/integrations/adelaide/reservations' },
      { ...input, p_body_hash: 'f'.repeat(64) },
    ]) {
      expect((await t.service.rpc('record_adelaide_integration_request', changed)).error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
    }
  });

  it('reports the registered missing sellable mapping instead of silently skipping it', async () => {
    const { data, error } = await t.service.rpc('adelaide_integration_reconciliation');
    expect(error).toBeNull();
    expect(data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'critical',
        discrepancy_type: 'product_mapping_invalid',
        external_order_reference: 'greforce-g-pilot-x1-29580r225',
      }),
    ]));
  });

  // Security boundary --------------------------------------------------------
  describe('privileged mutation is unreachable outside the service boundary', () => {
    const actors = () => [
      ['anon', t.anon()],
      ['authenticated manager', t.reg],
      ['authenticated admin', t.admin],
    ] as const;

    it('denies execute on every integration RPC to anon and authenticated roles', async () => {
      const f = await fixture(5);
      for (const [label, client] of actors()) {
        const calls = [
          client.rpc('adelaide_inventory_availability', { p_client_id: CLIENT, p_location_id: t.regLocationId, p_mapping_ids: [f.mappingId] }),
          client.rpc('reserve_adelaide_inventory', { p_client_id: CLIENT, p_request_id: randomUUID(), p_request_hash: HASH, p_order_reference: ref(), p_location_id: t.regLocationId, p_expires_at: expiresIn(HOLD_MS), p_lines: [{ mapping_id: f.mappingId, quantity: 1 }] }),
          client.rpc('release_adelaide_inventory_reservation', { p_client_id: CLIENT, p_reservation_id: randomUUID(), p_request_id: randomUUID(), p_reason: null }),
          client.rpc('commit_adelaide_inventory_sale', { p_client_id: CLIENT, p_reservation_id: randomUUID(), p_request_id: randomUUID(), p_request_hash: HASH, p_order_reference: ref() }),
          client.rpc('adelaide_inventory_reservation_status', { p_client_id: CLIENT, p_reservation_id: randomUUID() }),
          client.rpc('expire_adelaide_inventory_reservations', { p_client_id: CLIENT }),
          client.rpc('upsert_adelaide_product_mapping', { p_mapping_id: randomUUID(), p_website_product_id: 'evil', p_inventory_product_id: f.productId }),
          client.rpc('record_adelaide_integration_request', { p_client_id: CLIENT, p_request_id: randomUUID(), p_method: 'POST', p_pathname: '/api/integrations/adelaide/reservations', p_body_hash: HASH }),
          client.rpc('register_adelaide_order_state', { p_client_id: CLIENT, p_request_id: randomUUID(), p_request_hash: HASH, p_reservation_id: randomUUID(), p_order_reference: ref(), p_payment_status: 'paid', p_order_status: 'confirmed' }),
          client.rpc('process_adelaide_commit_queue', { p_client_id: CLIENT, p_limit: 1 }),
        ];
        for (const result of await Promise.all(calls)) {
          expect(result.error, label).not.toBeNull();
          expect(result.error!.message, label).toMatch(/permission denied|not find the function|does not exist/i);
        }
      }
      expect(await balance(f.productId)).toEqual({ on_hand: 5, reserved: 0 });
    });

    it('denies direct table access to the integration relations and the ledger', async () => {
      const f = await fixture(5);
      await reserveOk([{ mapping_id: f.mappingId, quantity: 1 }]);
      for (const [label, client] of actors()) {
        for (const table of ['adelaide_product_mappings', 'adelaide_website_products', 'adelaide_inventory_reservations', 'adelaide_inventory_reservation_lines', 'adelaide_order_inventory_commits', 'adelaide_integration_requests', 'adelaide_operation_runs']) {
          const read = await client.from(table).select('*').limit(1);
          expect(read.data ?? [], `${label} select ${table}`).toEqual([]);
          const write = await client.from(table).delete().neq('id', randomUUID());
          expect(write.error, `${label} delete ${table}`).not.toBeNull();
        }
        const balances = await client.from('inventory_balances').update({ reserved: 0 }).eq('product_id', f.productId);
        expect(balances.error, `${label} update balances`).not.toBeNull();
        const movementInsert = await client.from('inventory_movements').insert({
          request_id: randomUUID(), product_id: f.productId, location_id: t.regLocationId, quantity_delta: -1,
          movement_type: 'stock_out', cost_snapshot: 0, actor_type: 'integration',
        });
        expect(movementInsert.error, `${label} insert movement`).not.toBeNull();
      }
      expect(await balance(f.productId)).toEqual({ on_hand: 5, reserved: 1 });
    });

    it('service role cannot write the reservation relations except through the RPCs', async () => {
      const f = await fixture(5);
      const made = await reserveOk([{ mapping_id: f.mappingId, quantity: 1 }]);
      const direct = await t.service.from('adelaide_inventory_reservations').update({ status: 'committed' }).eq('id', made.reservation_id);
      expect(direct.error).not.toBeNull();
      const insert = await t.service.from('adelaide_product_mappings').insert({ id: randomUUID(), website_product_id: 'evil', inventory_product_id: f.productId });
      expect(insert.error).not.toBeNull();
      expect((await reservationRow(made.reservation_id)).status).toBe('active');
    });
  });
});
