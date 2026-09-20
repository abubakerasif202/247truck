import 'server-only';

import OpenAI from 'openai';

let cached: { key: string; client: OpenAI } | null = null;

/** Lazily creates (and reuses) the server-only OpenAI client for one API
 * key. Never imported from a `use client` component -- the `server-only`
 * import above makes that a build-time error, not just a convention. */
export function getOpenAiClient(apiKey: string): OpenAI {
  if (cached && cached.key === apiKey) return cached.client;
  const client = new OpenAI({ apiKey, timeout: 30_000 });
  cached = { key: apiKey, client };
  return client;
}
