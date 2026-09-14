import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { verifyAdelaideSignature } from './adelaide-auth';

const MAX_BODY_BYTES = 32 * 1024;

export async function signedJson<T>(request: Request, schema: ZodType<T>): Promise<{ signed: ReturnType<typeof verifyAdelaideSignature>; value: T }> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE');
  const signed = verifyAdelaideSignature(request, raw);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('MALFORMED_REQUEST'); }
  try { return { signed, value: schema.parse(parsed) }; }
  catch (error) { if (error instanceof ZodError) throw new Error('INVALID_REQUEST'); throw error; }
}

/** Maps an internal error code to a status. Only the bare code is ever returned. */
export function integrationStatus(code: string): number {
  if (/SIGNATURE|CLIENT_INVALID|TIMESTAMP|REQUEST_ID/.test(code)) return 401;
  if (code === 'REQUEST_TOO_LARGE') return 413;
  if (code === 'RATE_LIMITED') return 429;
  if (/INVALID|MALFORMED|DUPLICATE|UNKNOWN/.test(code)) return 400;
  if (/INSUFFICIENT|RESERVATION_|INACTIVE|IDEMPOTENCY|MISMATCH|PAID_ORDER|ORDER_NOT_PAID/.test(code)) return 409;
  return 500;
}

export function integrationError(error: unknown, requestId?: string) {
  // Only codes raised by our own RPC/route layer are echoed. Anything else
  // (driver errors, SQL text, stack traces) is collapsed to a generic code.
  const raw = error instanceof Error ? error.message : '';
  const code = /^[A-Z][A-Z0-9_]{2,60}$/.test(raw) ? raw : 'INTEGRATION_ERROR';
  const status = integrationStatus(code);
  if (status >= 500) console.error('[adelaide-integration] operation failed', { code, requestId });
  const safeRequestId = requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
    ? requestId
    : undefined;
  return NextResponse.json(
    { error: status >= 500 ? 'INTEGRATION_UNAVAILABLE' : code },
    { status, headers: safeRequestId ? { 'x-request-id': safeRequestId } : undefined },
  );
}
