// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  reservationIdempotencyHash,
  sha256,
  signingPayload,
  verifyAdelaideSignature,
} from '../../lib/integrations/adelaide-auth';
import { integrationError, integrationStatus, signedJson } from '../../lib/integrations/adelaide-route';
import { availabilityRequestSchema, commitRequestSchema, reserveRequestSchema } from '../../lib/integrations/adelaide-schema';

const CLIENT_ID = 'awt-unit-client';
const SECRET = 'unit-test-secret-never-real';
const BASE = 'https://inventory.example.test';

type SignOptions = {
  method?: string;
  path?: string;
  body?: string;
  clientId?: string;
  secret?: string;
  timestamp?: string;
  requestId?: string;
  signature?: string;
  omit?: string[];
  signedPath?: string;
  signedMethod?: string;
  signedBody?: string;
};

function signedRequest(options: SignOptions = {}): { request: Request; raw: string } {
  const method = options.method ?? 'POST';
  const path = options.path ?? '/api/integrations/adelaide/availability';
  const raw = options.body ?? JSON.stringify({ items: [{ inventoryMappingId: randomUUID() }] });
  const timestamp = options.timestamp ?? String(Date.now());
  const requestId = options.requestId ?? randomUUID();
  const bodyHash = sha256(options.signedBody ?? raw);
  const signature = options.signature ?? createHmac('sha256', options.secret ?? SECRET)
    .update(signingPayload(options.signedMethod ?? method, options.signedPath ?? path, timestamp, requestId, bodyHash))
    .digest('hex');
  const headers = new Headers({
    'content-type': 'application/json',
    'x-awt-client-id': options.clientId ?? CLIENT_ID,
    'x-awt-timestamp': timestamp,
    'x-awt-request-id': requestId,
    'x-awt-signature': signature,
  });
  for (const name of options.omit ?? []) headers.delete(name);
  const request = new Request(`${BASE}${path}`, { method, headers, body: method === 'GET' ? undefined : raw });
  return { request, raw };
}

describe('Adelaide HMAC verification', () => {
  beforeEach(() => {
    vi.stubEnv('AWT_INVENTORY_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('AWT_INVENTORY_CLIENT_SECRET', SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('accepts a correctly signed request and returns its identity', () => {
    const requestId = randomUUID();
    const { request, raw } = signedRequest({ requestId });
    const signed = verifyAdelaideSignature(request, raw);
    expect(signed).toEqual({ clientId: CLIENT_ID, requestId, bodyHash: sha256(raw) });
  });

  it('binds the signature to method, path, timestamp, request id and SHA-256 body hash', () => {
    const payload = signingPayload('post', '/api/integrations/adelaide/reservations', '1700000000000', 'rid', 'hash');
    expect(payload).toBe('POST\n/api/integrations/adelaide/reservations\n1700000000000\nrid\nhash');
    expect(sha256('{}')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it.each([
    ['missing signature', { omit: ['x-awt-signature'] }, 'INTEGRATION_SIGNATURE_INVALID'],
    ['malformed signature', { signature: 'zz'.repeat(32) }, 'INTEGRATION_SIGNATURE_INVALID'],
    ['wrong signature', { signature: 'ab'.repeat(32) }, 'INTEGRATION_SIGNATURE_INVALID'],
    ['wrong secret', { secret: 'a-different-secret' }, 'INTEGRATION_SIGNATURE_INVALID'],
    ['wrong client', { clientId: 'someone-else' }, 'INTEGRATION_CLIENT_INVALID'],
    ['missing client', { omit: ['x-awt-client-id'] }, 'INTEGRATION_CLIENT_INVALID'],
    ['changed body', { signedBody: '{"items":[]}' }, 'INTEGRATION_SIGNATURE_INVALID'],
    ['changed method', { signedMethod: 'DELETE' }, 'INTEGRATION_SIGNATURE_INVALID'],
    ['changed path', { signedPath: '/api/integrations/adelaide/sales/commit' }, 'INTEGRATION_SIGNATURE_INVALID'],
    ['malformed request id', { requestId: 'not-a-uuid' }, 'INTEGRATION_REQUEST_ID_INVALID'],
    ['missing request id', { omit: ['x-awt-request-id'] }, 'INTEGRATION_REQUEST_ID_INVALID'],
    ['non-numeric timestamp', { timestamp: 'yesterday' }, 'INTEGRATION_TIMESTAMP_INVALID'],
    ['missing timestamp', { omit: ['x-awt-timestamp'] }, 'INTEGRATION_TIMESTAMP_INVALID'],
    ['expired timestamp', { timestamp: String(Date.now() - 6 * 60 * 1000) }, 'INTEGRATION_TIMESTAMP_INVALID'],
    ['future timestamp beyond tolerance', { timestamp: String(Date.now() + 6 * 60 * 1000) }, 'INTEGRATION_TIMESTAMP_INVALID'],
  ] as const)('rejects %s', (_label, options, code) => {
    const { request, raw } = signedRequest(options as SignOptions);
    expect(() => verifyAdelaideSignature(request, raw)).toThrowError(code);
  });

  it('tolerates modest clock skew in either direction', () => {
    for (const offset of [-4 * 60 * 1000, 4 * 60 * 1000]) {
      const { request, raw } = signedRequest({ timestamp: String(Date.now() + offset) });
      expect(() => verifyAdelaideSignature(request, raw)).not.toThrow();
    }
  });

  it('fails closed when the integration is not configured', () => {
    vi.stubEnv('AWT_INVENTORY_CLIENT_SECRET', '');
    const { request, raw } = signedRequest();
    expect(() => verifyAdelaideSignature(request, raw)).toThrowError(/not configured/);
  });

  it('never accepts a signature for a different client even with the right secret', () => {
    const { request, raw } = signedRequest({ clientId: 'other-client' });
    expect(() => verifyAdelaideSignature(request, raw)).toThrowError('INTEGRATION_CLIENT_INVALID');
  });
});

describe('signedJson route boundary', () => {
  beforeEach(() => {
    vi.stubEnv('AWT_INVENTORY_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('AWT_INVENTORY_CLIENT_SECRET', SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  const reservePath = '/api/integrations/adelaide/reservations';
  const validReserve = () => ({
    orderReference: 'AWT-2026-ABCD1234',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    items: [{ inventoryMappingId: randomUUID(), quantity: 2 }],
  });

  it('verifies the signature before parsing the body', async () => {
    const { request } = signedRequest({ path: reservePath, body: 'not json', signature: 'ab'.repeat(32) });
    await expect(signedJson(request, reserveRequestSchema)).rejects.toThrowError('INTEGRATION_SIGNATURE_INVALID');
  });

  it('rejects invalid JSON after a valid signature', async () => {
    const { request } = signedRequest({ path: reservePath, body: '{"items": [' });
    await expect(signedJson(request, reserveRequestSchema)).rejects.toThrowError('MALFORMED_REQUEST');
  });

  it('rejects oversized bodies', async () => {
    const { request } = signedRequest({ path: reservePath, body: JSON.stringify({ pad: 'x'.repeat(33 * 1024) }) });
    await expect(signedJson(request, reserveRequestSchema)).rejects.toThrowError('REQUEST_TOO_LARGE');
  });

  it.each([
    ['zero quantity', (body: ReturnType<typeof validReserve>) => { body.items[0].quantity = 0; }],
    ['negative quantity', (body: ReturnType<typeof validReserve>) => { body.items[0].quantity = -2; }],
    ['non-integer quantity', (body: ReturnType<typeof validReserve>) => { body.items[0].quantity = 1.5; }],
    ['extreme quantity', (body: ReturnType<typeof validReserve>) => { body.items[0].quantity = 1_000_001; }],
    ['string quantity', (body: ReturnType<typeof validReserve>) => { (body.items[0] as { quantity: unknown }).quantity = '2'; }],
    ['non-uuid mapping', (body: ReturnType<typeof validReserve>) => { (body.items[0] as { inventoryMappingId: string }).inventoryMappingId = 'ralson-rmr61'; }],
    ['empty items', (body: ReturnType<typeof validReserve>) => { body.items = []; }],
    ['too many items', (body: ReturnType<typeof validReserve>) => { body.items = Array.from({ length: 26 }, () => ({ inventoryMappingId: randomUUID(), quantity: 1 })); }],
    ['blank order reference', (body: ReturnType<typeof validReserve>) => { body.orderReference = '   '; }],
    ['invalid expiry', (body: ReturnType<typeof validReserve>) => { body.expiresAt = 'soon'; }],
    ['unexpected field', (body: ReturnType<typeof validReserve>) => { (body as Record<string, unknown>).locationId = randomUUID(); }],
    ['browser-supplied price', (body: ReturnType<typeof validReserve>) => { (body.items[0] as Record<string, unknown>).price = 1; }],
  ])('rejects %s with INVALID_REQUEST', async (_label, mutate) => {
    const body = validReserve();
    mutate(body);
    const { request } = signedRequest({ path: reservePath, body: JSON.stringify(body) });
    await expect(signedJson(request, reserveRequestSchema)).rejects.toThrowError('INVALID_REQUEST');
  });

  it('accepts a valid reservation body and returns the verified identity', async () => {
    const body = validReserve();
    const requestId = randomUUID();
    const { request } = signedRequest({ path: reservePath, body: JSON.stringify(body), requestId });
    const result = await signedJson(request, reserveRequestSchema);
    expect(result.value).toEqual(body);
    expect(result.signed.requestId).toBe(requestId);
  });

  it('validates availability and commit schemas strictly', () => {
    expect(availabilityRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(availabilityRequestSchema.safeParse({ items: [{ inventoryMappingId: randomUUID() }] }).success).toBe(true);
    expect(commitRequestSchema.safeParse({ reservationId: randomUUID(), orderReference: 'AWT-1' }).success).toBe(true);
    expect(commitRequestSchema.safeParse({ reservationId: 'nope', orderReference: 'AWT-1' }).success).toBe(false);
    expect(commitRequestSchema.safeParse({ reservationId: randomUUID(), orderReference: '' }).success).toBe(false);
  });
});

describe('reservation idempotency identity', () => {
  it('is stable across retries that only differ by expiry, item order and mapping id case', () => {
    const a = randomUUID();
    const b = randomUUID();
    const first = reservationIdempotencyHash({ orderReference: 'AWT-1', items: [{ inventoryMappingId: a, quantity: 1 }, { inventoryMappingId: b, quantity: 2 }] });
    const retry = reservationIdempotencyHash({ orderReference: ' AWT-1 ', items: [{ inventoryMappingId: b.toUpperCase(), quantity: 2 }, { inventoryMappingId: a, quantity: 1 }] });
    expect(retry).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the held quantity, product or order changes', () => {
    const a = randomUUID();
    const base = { orderReference: 'AWT-1', items: [{ inventoryMappingId: a, quantity: 1 }] };
    expect(reservationIdempotencyHash({ ...base, items: [{ inventoryMappingId: a, quantity: 2 }] })).not.toBe(reservationIdempotencyHash(base));
    expect(reservationIdempotencyHash({ ...base, items: [{ inventoryMappingId: randomUUID(), quantity: 1 }] })).not.toBe(reservationIdempotencyHash(base));
    expect(reservationIdempotencyHash({ ...base, orderReference: 'AWT-2' })).not.toBe(reservationIdempotencyHash(base));
  });
});

describe('integration error responses', () => {
  it('maps internal codes to statuses without leaking anything else', async () => {
    expect(integrationStatus('INTEGRATION_SIGNATURE_INVALID')).toBe(401);
    expect(integrationStatus('INTEGRATION_CLIENT_INVALID')).toBe(401);
    expect(integrationStatus('INTEGRATION_TIMESTAMP_INVALID')).toBe(401);
    expect(integrationStatus('REQUEST_TOO_LARGE')).toBe(413);
    expect(integrationStatus('INVALID_REQUEST')).toBe(400);
    expect(integrationStatus('MALFORMED_REQUEST')).toBe(400);
    expect(integrationStatus('UNKNOWN_PRODUCT_MAPPING')).toBe(400);
    expect(integrationStatus('DUPLICATE_RESERVATION_PRODUCT')).toBe(400);
    expect(integrationStatus('INSUFFICIENT_STOCK')).toBe(409);
    expect(integrationStatus('RESERVATION_NOT_ACTIVE')).toBe(409);
    expect(integrationStatus('RESERVATION_EXPIRED')).toBe(409);
    expect(integrationStatus('PRODUCT_INACTIVE')).toBe(409);
    expect(integrationStatus('IDEMPOTENCY_KEY_REUSED')).toBe(409);
    expect(integrationStatus('ORDER_REFERENCE_MISMATCH')).toBe(409);
    expect(integrationStatus('INTEGRATION_DATABASE_ERROR')).toBe(500);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leaky = integrationError(new Error('relation "public.inventory_balances" does not exist at character 15\nSTACK TRACE'));
    expect(leaky.status).toBe(500);
    expect(await leaky.json()).toEqual({ error: 'INTEGRATION_UNAVAILABLE' });
    const sql = integrationError(new Error('syntax error at or near "select"'));
    expect(await sql.json()).toEqual({ error: 'INTEGRATION_UNAVAILABLE' });
    const conflict = integrationError(new Error('INSUFFICIENT_STOCK'));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'INSUFFICIENT_STOCK' });
    const unknown = integrationError('a string, not an error');
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: 'INTEGRATION_UNAVAILABLE' });
    spy.mockRestore();
  });

  it('never echoes a zod error message', async () => {
    const schema = z.object({ a: z.string() }).strict();
    vi.stubEnv('AWT_INVENTORY_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('AWT_INVENTORY_CLIENT_SECRET', SECRET);
    const { request } = signedRequest({ body: JSON.stringify({ a: 1, secretField: 'x' }) });
    const response = await signedJson(request, schema).catch(integrationError);
    expect((response as Response).status).toBe(400);
    expect(await (response as Response).json()).toEqual({ error: 'INVALID_REQUEST' });
    vi.unstubAllEnvs();
  });
});

describe('mapping id shape', () => {
  it('accepts md5-derived permanent mapping ids that are not RFC 4122 variants', () => {
    // md5('adelaide-wholesale-tyres:ralson-rmr61-29580r225')::uuid
    const mappingId = '605b90ca-7297-3425-32da-ba5fb59328f2';
    expect(availabilityRequestSchema.safeParse({ items: [{ inventoryMappingId: mappingId }] }).success).toBe(true);
    expect(reserveRequestSchema.safeParse({ orderReference: 'AWT-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), items: [{ inventoryMappingId: mappingId, quantity: 1 }] }).success).toBe(true);
    expect(availabilityRequestSchema.safeParse({ items: [{ inventoryMappingId: '605b90ca-7297-3425-32da' }] }).success).toBe(false);
  });
});
