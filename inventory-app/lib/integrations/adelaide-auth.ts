import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type AdelaideSignedRequest = {
  clientId: string;
  requestId: string;
  bodyHash: string;
};

function configuredClient() {
  const clientId = process.env.AWT_INVENTORY_CLIENT_ID;
  const secret = process.env.AWT_INVENTORY_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error('Adelaide inventory integration is not configured.');
  return { clientId, secret };
}

export function integrationLocationId(): string {
  const locationId = process.env.AWT_INVENTORY_LOCATION_ID;
  if (!locationId) throw new Error('AWT_INVENTORY_LOCATION_ID is not configured.');
  return locationId;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function signingPayload(method: string, pathname: string, timestamp: string, requestId: string, bodyHash: string): string {
  return `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${requestId}\n${bodyHash}`;
}

/** Validates the raw request before its JSON body is trusted. */
export function verifyAdelaideSignature(request: Request, rawBody: string): AdelaideSignedRequest {
  const timestamp = request.headers.get('x-awt-timestamp') ?? '';
  const requestId = request.headers.get('x-awt-request-id') ?? '';
  const clientId = request.headers.get('x-awt-client-id') ?? '';
  const signature = request.headers.get('x-awt-signature') ?? '';
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    throw new Error('INTEGRATION_TIMESTAMP_INVALID');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('INTEGRATION_REQUEST_ID_INVALID');
  }
  if (!/^[0-9a-f]{64}$/i.test(signature)) throw new Error('INTEGRATION_SIGNATURE_INVALID');

  const configured = configuredClient();
  if (clientId !== configured.clientId) throw new Error('INTEGRATION_CLIENT_INVALID');
  const bodyHash = sha256(rawBody);
  const expected = createHmac('sha256', configured.secret)
    .update(signingPayload(request.method, new URL(request.url).pathname, timestamp, requestId, bodyHash))
    .digest('hex');
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
    throw new Error('INTEGRATION_SIGNATURE_INVALID');
  }
  return { clientId, requestId, bodyHash };
}

/**
 * Idempotency identity of a reservation: what is held and for which order. The
 * hold expiry is a retry parameter, not part of the identity, so a legitimate
 * retry of the same request ID (Adelaide timed out after 247 committed the
 * hold) converges on the same reservation instead of being rejected.
 */
export function reservationIdempotencyHash(input: {
  orderReference: string;
  items: { inventoryMappingId: string; quantity: number }[];
}): string {
  const items = input.items
    .map((item) => ({ m: item.inventoryMappingId.toLowerCase(), q: item.quantity }))
    .sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));
  return sha256(JSON.stringify({ orderReference: input.orderReference.trim(), items }));
}

/**
 * Idempotency identity of a sale commit: which hold, for which order. It is
 * reproducible from the durable order record on both sides of the boundary
 * (the website worker and 247's own paid-commit queue), so whichever side
 * commits first, the other converges on the same committed sale instead of
 * tripping IDEMPOTENCY_KEY_REUSED. Mirrors the SQL in
 * process_adelaide_commit_queue: sha256(lower(reservation_id) || E'\n' || order_reference).
 */
export function commitIdempotencyHash(input: { reservationId: string; orderReference: string }): string {
  return sha256(`${input.reservationId.toLowerCase()}\n${input.orderReference.trim()}`);
}
