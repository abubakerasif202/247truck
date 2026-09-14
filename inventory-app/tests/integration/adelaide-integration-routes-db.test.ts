import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { commitIdempotencyHash, sha256, signingPayload } from '@/lib/integrations/adelaide-auth';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

/**
 * The Adelaide route handlers driven end to end: real HMAC-signed requests
 * into the real handlers, which record delivery identity and call the real
 * RPCs on the disposable local Supabase. This is where the raw-byte
 * signature, the recorded delivery identity and the reservation/commit
 * idempotency identities meet.
 */
const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) process.stderr.write(`[adelaide route+db] skipped: missing ${gap.join(', ')}\n`);

const CLIENT = 'awt-route-db-test';
const SECRET = 'route-db-test-secret-0123456789abcdef';
const BASE = 'https://inventory.test';

function sign(method: string, pathname: string, body: string, requestId = randomUUID(), timestamp = String(Date.now())) {
  const signature = createHmac('sha256', SECRET).update(signingPayload(method, pathname, timestamp, requestId, sha256(body))).digest('hex');
  return new Request(`${BASE}${pathname}`, {
    method,
    body,
    headers: {
      'content-type': 'application/json',
      'x-awt-client-id': CLIENT,
      'x-awt-timestamp': timestamp,
      'x-awt-request-id': requestId,
      'x-awt-signature': signature,
    },
  });
}

suite('Adelaide route handlers against the database', () => {
  let t: TestTenants;
  let seq = 0;
  const ref = () => `AWT-ROUTE-${randomUUID().slice(0, 8).toUpperCase()}`;

  async function fixture(onHand: number) {
    seq += 1;
    const { data, error } = await t.admin.rpc('create_product', {
      p_name: `AWT Route Fixture ${seq} ${randomUUID().slice(0, 6)} 295/80R22.5`,
      p_category_code: 'truck_tyre', p_selling_price_incl_gst: 100, p_tyre_condition: 'new',
      p_tyre_brand: 'AWT Fixture', p_tyre_size: '295/80R22.5',
    });
    if (error) throw error;
    const productId = data as string;
    const mappingId = randomUUID();
    const mapped = await t.service.rpc('upsert_adelaide_product_mapping', {
      p_mapping_id: mappingId, p_website_product_id: `route-fixture-${mappingId}`, p_inventory_product_id: productId,
    });
    if (mapped.error) throw mapped.error;
    const movement = await t.reg.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.regLocationId, p_quantity_delta: onHand,
      p_movement_type: 'quick_stock_in', p_reason: null, p_inbound_unit_cost: 50, p_used_tyre_unit_id: null, p_source_type: null, p_source_id: null,
    });
    if (movement.error) throw movement.error;
    return { productId, mappingId };
  }

  async function balance(productId: string) {
    const { data } = await t.service.from('inventory_balances').select('on_hand,reserved').eq('product_id', productId).eq('location_id', t.regLocationId).single();
    return data as { on_hand: number; reserved: number };
  }

  async function movements(reservationId: string) {
    const { data } = await t.service.from('inventory_movements').select('id').eq('external_reservation_id', reservationId);
    return data ?? [];
  }

  const ENV_KEYS = ['AWT_INVENTORY_CLIENT_ID', 'AWT_INVENTORY_CLIENT_SECRET', 'AWT_INVENTORY_LOCATION_ID'] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeAll(async () => {
    t = await createTestTenants({ regPermissions: ['inventory.stock_in'] });
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.AWT_INVENTORY_CLIENT_ID = CLIENT;
    process.env.AWT_INVENTORY_CLIENT_SECRET = SECRET;
    process.env.AWT_INVENTORY_LOCATION_ID = t.regLocationId;
  });
  afterAll(async () => {
    // Files run serially against one process; never leak this file's client/location into the next.
    for (const key of ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
    await t?.cleanup();
  });

  it('replays an equivalent reservation (fresh expiry, same attempt) onto the same hold and rejects a changed payload', async () => {
    const { POST } = await import('@/app/api/integrations/adelaide/reservations/route');
    const f = await fixture(10);
    const order = ref();
    const attemptId = randomUUID();
    const path = '/api/integrations/adelaide/reservations';
    const body = (expiresInMs: number, quantity = 2) => JSON.stringify({ orderReference: order, expiresAt: new Date(Date.now() + expiresInMs).toISOString(), items: [{ inventoryMappingId: f.mappingId, quantity }] });

    const first = await POST(sign('POST', path, body(60_000), attemptId));
    expect(first.status).toBe(201);
    const made = (await first.json()) as { reservation_id: string };

    // Adelaide timed out and retried the same checkout attempt: the raw bytes
    // differ (new expiresAt) so the signature is fresh, but the identity is equal.
    const replay = await POST(sign('POST', path, body(90_000), attemptId));
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { reservation_id: string }).reservation_id).toBe(made.reservation_id);
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 2 });

    // The same attempt id with materially different lines is a different operation.
    const misuse = await POST(sign('POST', path, body(60_000, 5), attemptId));
    expect(misuse.status).toBe(409);
    expect(await misuse.json()).toEqual({ error: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 2 });

    // Delivery identity was recorded once with the canonical hash and replayed once.
    // The request relation is unreadable even to service_role; read it as the DB owner.
    const [bodyHash, deliveryCount] = sql(`select body_hash, delivery_count from public.adelaide_integration_requests where client_id='${CLIENT}' and request_id='${attemptId}'`).split('|');
    expect(Number(deliveryCount)).toBe(2);
    expect(bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bodyHash).not.toBe(sha256(body(60_000)));

    // A tampered body under the original signature never reaches the database.
    const tampered = sign('POST', path, body(60_000), randomUUID());
    const forged = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: body(60_000, 9) });
    const rejected = await POST(forged);
    expect(rejected.status).toBe(401);
    expect(await balance(f.productId)).toEqual({ on_hand: 10, reserved: 2 });
  });

  it('protects a paid hold through the state handoff and commits it once under the website identity', async () => {
    const reservations = await import('@/app/api/integrations/adelaide/reservations/route');
    const state = await import('@/app/api/integrations/adelaide/orders/state/route');
    const sales = await import('@/app/api/integrations/adelaide/sales/commit/route');
    const f = await fixture(6);
    const order = ref();
    // A hold that is already past its checkout window, as after a long 247 outage.
    const reserved = await reservations.POST(sign('POST', '/api/integrations/adelaide/reservations', JSON.stringify({ orderReference: order, expiresAt: new Date(Date.now() + 2_000).toISOString(), items: [{ inventoryMappingId: f.mappingId, quantity: 2 }] })));
    expect(reserved.status).toBe(201);
    const { reservation_id: reservationId } = (await reserved.json()) as { reservation_id: string };
    const commitRequestId = randomUUID();
    const stateRequestId = randomUUID();
    const stateBody = JSON.stringify({ reservationId, orderReference: order, paymentStatus: 'paid', orderStatus: 'confirmed', commitRequestId });

    const registered = await state.POST(sign('POST', '/api/integrations/adelaide/orders/state', stateBody, stateRequestId));
    expect(registered.status).toBe(200);
    expect(await registered.json()).toMatchObject({ inventory_state: 'commit_pending', commit_request_id: commitRequestId });
    const again = await state.POST(sign('POST', '/api/integrations/adelaide/orders/state', stateBody, stateRequestId));
    expect(again.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect((await t.service.rpc('expire_adelaide_inventory_reservations', { p_client_id: CLIENT })).data).toBe(0);

    const commitBody = JSON.stringify({ reservationId, orderReference: order });
    const committed = await sales.POST(sign('POST', '/api/integrations/adelaide/sales/commit', commitBody, commitRequestId));
    expect(committed.status).toBe(200);
    expect(await committed.json()).toMatchObject({ status: 'committed' });
    const replay = await sales.POST(sign('POST', '/api/integrations/adelaide/sales/commit', commitBody, commitRequestId));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ status: 'committed' });
    expect(await movements(reservationId)).toHaveLength(1);
    expect(await balance(f.productId)).toEqual({ on_hand: 4, reserved: 0 });

    const { data: row } = await t.service.from('adelaide_inventory_reservations').select('commit_request_id,commit_request_hash').eq('id', reservationId).single();
    expect(row).toEqual({ commit_request_id: commitRequestId, commit_request_hash: commitIdempotencyHash({ reservationId, orderReference: order }) });
    // 247's own queue finds nothing left to do.
    expect((await t.service.rpc('process_adelaide_commit_queue', { p_client_id: CLIENT, p_limit: 25 })).data).toMatchObject({ processed: 0 });
  }, 20_000);
});
