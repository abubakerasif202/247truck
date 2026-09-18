// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { signedJson } from '../../lib/integrations/adelaide-route';
import { sha256, signingPayload } from '../../lib/integrations/adelaide-auth';

afterEach(() => vi.unstubAllEnvs());

it('cancels an oversized streaming body without waiting for its end', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(32 * 1024 + 1)); },
    cancel,
  });
  const request = new Request('http://localhost/integration', {
    method: 'POST', body: stream, duplex: 'half',
  } as RequestInit);
  await expect(signedJson(request, z.object({}))).rejects.toThrow('REQUEST_TOO_LARGE');
  expect(cancel).toHaveBeenCalledOnce();
});

it('preserves signed UTF-8 characters split across stream chunks', async () => {
  vi.stubEnv('AWT_INVENTORY_CLIENT_ID', 'test-client');
  vi.stubEnv('AWT_INVENTORY_CLIENT_SECRET', 'test-secret');
  const raw = JSON.stringify({ message: 'Tyre café 🚚' });
  const timestamp = String(Date.now());
  const requestId = randomUUID();
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const request = new Request('http://localhost/integration', {
    method: 'POST', body: stream, duplex: 'half',
    headers: {
      'x-awt-client-id': 'test-client', 'x-awt-timestamp': timestamp,
      'x-awt-request-id': requestId,
      'x-awt-signature': createHmac('sha256', 'test-secret')
        .update(signingPayload('POST', '/integration', timestamp, requestId, sha256(raw))).digest('hex'),
    },
  } as RequestInit);
  const result = await signedJson(request, z.object({ message: z.string() }));
  expect(result.value.message).toBe('Tyre café 🚚');
});
