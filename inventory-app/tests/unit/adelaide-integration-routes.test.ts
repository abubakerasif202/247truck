// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservationIdempotencyHash, sha256, signingPayload } from '../../lib/integrations/adelaide-auth';

const service = {
  availability: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  commit: vi.fn(),
  status: vi.fn(),
  expire: vi.fn(),
  recordRequest: vi.fn(),
  recordOrderState: vi.fn(),
  runOperation: vi.fn(),
  health: vi.fn(),
};
vi.mock('../../lib/integrations/adelaide-service', () => service);
vi.mock('@/lib/integrations/adelaide-service', () => service);

const CLIENT_ID = 'awt-route-client';
const SECRET = 'route-test-secret-never-real';
const BASE = 'https://inventory.example.test';

function sign(method: string, path: string, raw: string, requestId = randomUUID(), clientId = CLIENT_ID, secret = SECRET) {
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secret)
    .update(signingPayload(method, path, timestamp, requestId, sha256(raw)))
    .digest('hex');
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-awt-client-id': clientId,
      'x-awt-timestamp': timestamp,
      'x-awt-request-id': requestId,
      'x-awt-signature': signature,
    },
    body: raw,
  });
}

describe('Adelaide integration route handlers', () => {
  beforeEach(() => {
    vi.stubEnv('AWT_INVENTORY_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('AWT_INVENTORY_CLIENT_SECRET', SECRET);
    vi.stubEnv('AWT_INVENTORY_LOCATION_ID', randomUUID());
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    for (const fn of Object.values(service)) fn.mockReset();
    service.recordRequest.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects an unsigned availability request before touching the database', async () => {
    const { POST } = await import('../../app/api/integrations/adelaide/availability/route');
    const response = await POST(new Request(`${BASE}/api/integrations/adelaide/availability`, { method: 'POST', body: '{}' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'INTEGRATION_TIMESTAMP_INVALID' });
    expect(service.availability).not.toHaveBeenCalled();
  });

  it('serves a signed availability request and returns only the exposed fields', async () => {
    const { POST } = await import('../../app/api/integrations/adelaide/availability/route');
    const mappingId = randomUUID();
    service.availability.mockResolvedValue([{ inventoryMappingId: mappingId, onHand: 10, reserved: 2, available: 8, updatedAt: 'now' }]);
    const raw = JSON.stringify({ items: [{ inventoryMappingId: mappingId }] });
    const response = await POST(sign('POST', '/api/integrations/adelaide/availability', raw));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ items: [{ inventoryMappingId: mappingId, onHand: 10, reserved: 2, available: 8, updatedAt: 'now' }] });
    expect(JSON.stringify(body)).not.toMatch(/cost|wac|supplier/i);
    expect(service.availability).toHaveBeenCalledWith(CLIENT_ID, [mappingId]);
  });

  it('passes the canonical idempotency hash (not the raw body hash) to the reservation RPC', async () => {
    const { POST } = await import('../../app/api/integrations/adelaide/reservations/route');
    const requestId = randomUUID();
    const body = { orderReference: 'AWT-2026-ABCD1234', expiresAt: new Date(Date.now() + 60_000).toISOString(), items: [{ inventoryMappingId: randomUUID(), quantity: 2 }] };
    service.reserve.mockResolvedValue({ reservation_id: randomUUID(), status: 'active' });
    const response = await POST(sign('POST', '/api/integrations/adelaide/reservations', JSON.stringify(body), requestId));
    expect(response.status).toBe(201);
    expect(service.reserve).toHaveBeenCalledWith(CLIENT_ID, requestId, reservationIdempotencyHash(body), body);
    expect(service.reserve.mock.calls[0][2]).not.toBe(sha256(JSON.stringify(body)));
  });

  it('rejects a reservation whose signed body was tampered in flight', async () => {
    const { POST } = await import('../../app/api/integrations/adelaide/reservations/route');
    const good = JSON.stringify({ orderReference: 'AWT-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), items: [{ inventoryMappingId: randomUUID(), quantity: 1 }] });
    const signed = sign('POST', '/api/integrations/adelaide/reservations', good);
    const tampered = new Request(signed.url, { method: 'POST', headers: signed.headers, body: good.replace('"quantity":1', '"quantity":100') });
    const response = await POST(tampered);
    expect(response.status).toBe(401);
    expect(service.reserve).not.toHaveBeenCalled();
  });

  it('rejects a reservation from the wrong client id', async () => {
    const { POST } = await import('../../app/api/integrations/adelaide/reservations/route');
    const raw = JSON.stringify({ orderReference: 'AWT-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), items: [{ inventoryMappingId: randomUUID(), quantity: 1 }] });
    const response = await POST(sign('POST', '/api/integrations/adelaide/reservations', raw, randomUUID(), 'other-client'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'INTEGRATION_CLIENT_INVALID' });
  });

  it('turns RPC conflicts into 409 codes and database failures into an opaque 500', async () => {
    const { POST } = await import('../../app/api/integrations/adelaide/sales/commit/route');
    const raw = JSON.stringify({ reservationId: randomUUID(), orderReference: 'AWT-1' });
    service.commit.mockRejectedValueOnce(new Error('RESERVATION_NOT_ACTIVE'));
    const conflict = await POST(sign('POST', '/api/integrations/adelaide/sales/commit', raw));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'RESERVATION_NOT_ACTIVE' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.commit.mockRejectedValueOnce(new Error('connection to server at "db.internal" (10.0.0.4), port 5432 failed'));
    const failure = await POST(sign('POST', '/api/integrations/adelaide/sales/commit', raw));
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: 'INTEGRATION_UNAVAILABLE' });
    spy.mockRestore();
  });

  it('binds the method: a POST-signed payload cannot be replayed as DELETE', async () => {
    const { DELETE, POST } = await import('../../app/api/integrations/adelaide/reservations/[reservationId]/route');
    const reservationId = randomUUID();
    const path = `/api/integrations/adelaide/reservations/${reservationId}`;
    const raw = JSON.stringify({ reason: 'customer_cancelled' });
    const asPost = sign('POST', path, raw);
    const replayed = new Request(asPost.url, { method: 'DELETE', headers: asPost.headers, body: raw });
    const response = await DELETE(replayed, { params: Promise.resolve({ reservationId }) });
    expect(response.status).toBe(401);
    expect(service.release).not.toHaveBeenCalled();

    service.status.mockResolvedValue({ reservation_id: reservationId, status: 'active' });
    const status = await POST(sign('POST', path, raw), { params: Promise.resolve({ reservationId }) });
    expect(status.status).toBe(200);
    expect(service.release).not.toHaveBeenCalled();

    service.release.mockResolvedValue({ reservation_id: reservationId, status: 'released' });
    const requestId = randomUUID();
    const released = await DELETE(sign('DELETE', path, raw, requestId), { params: Promise.resolve({ reservationId }) });
    expect(released.status).toBe(200);
    expect(service.release).toHaveBeenCalledWith(CLIENT_ID, reservationId, requestId, 'customer_cancelled');
  });

  it('rejects a malformed reservation id in the path', async () => {
    const { DELETE } = await import('../../app/api/integrations/adelaide/reservations/[reservationId]/route');
    const path = '/api/integrations/adelaide/reservations/not-a-uuid';
    const response = await DELETE(sign('DELETE', path, '{}'), { params: Promise.resolve({ reservationId: 'not-a-uuid' }) });
    expect(response.status).toBe(400);
    expect(service.release).not.toHaveBeenCalled();
  });

  it('protects the cron expiry endpoint with the CRON_SECRET bearer token', async () => {
    const { GET } = await import('../../app/api/integrations/adelaide/expire/route');
    service.runOperation.mockResolvedValue({ expired: 3, run_id: randomUUID() });
    const denied = await GET(new Request(`${BASE}/api/integrations/adelaide/expire`));
    expect(denied.status).toBe(401);
    const wrong = await GET(new Request(`${BASE}/api/integrations/adelaide/expire`, { headers: { authorization: 'Bearer nope' } }));
    expect(wrong.status).toBe(401);
    expect(service.expire).not.toHaveBeenCalled();
    const allowed = await GET(new Request(`${BASE}/api/integrations/adelaide/expire`, { headers: { authorization: 'Bearer cron-test-secret' } }));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ expired: 3 });
    expect(service.runOperation).toHaveBeenCalledWith(CLIENT_ID, 'expiry');
  });

  it('records a paid order state with the signed stable request identity', async () => {
    const { POST } = await import('../../app/api/integrations/adelaide/orders/state/route');
    const requestId = randomUUID();
    const body = { reservationId: randomUUID(), orderReference: 'AWT-PAID-1', paymentStatus: 'paid', orderStatus: 'confirmed' } as const;
    service.recordOrderState.mockResolvedValue({ inventory_state: 'commit_pending' });
    const response = await POST(sign('POST', '/api/integrations/adelaide/orders/state', JSON.stringify(body), requestId));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(requestId);
    expect(service.recordOrderState).toHaveBeenCalledWith(CLIENT_ID, requestId, expect.stringMatching(/^[0-9a-f]{64}$/), body);
    expect(service.recordRequest).toHaveBeenCalled();
  });

  it('protects health and commit-retry operations with the cron secret', async () => {
    const healthRoute = await import('../../app/api/integrations/adelaide/health/route');
    const processRoute = await import('../../app/api/integrations/adelaide/process/route');
    expect((await healthRoute.GET(new Request(`${BASE}/api/integrations/adelaide/health`))).status).toBe(401);
    expect((await processRoute.GET(new Request(`${BASE}/api/integrations/adelaide/process`))).status).toBe(401);
    service.health.mockResolvedValue({ status: 'action_required' });
    service.runOperation.mockResolvedValue({ processed: 1, committed: 1, failed: 0 });
    const headers = { authorization: 'Bearer cron-test-secret' };
    expect((await healthRoute.GET(new Request(`${BASE}/api/integrations/adelaide/health`, { headers }))).status).toBe(503);
    expect((await processRoute.GET(new Request(`${BASE}/api/integrations/adelaide/process`, { headers }))).status).toBe(200);
  });
});
