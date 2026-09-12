import { describe, expect, it } from 'vitest';

import { encodeListCursor, nextListCursor, normalizeListCursor, parseListCursor } from '@/lib/listing/cursor';

const AT = '2026-09-13T01:59:11.123456+00:00';
const ID = '3f2b6e6a-5b6c-4d2e-9f1a-0c1d2e3f4a5b';

describe('listing keyset cursor codec', () => {
  it('round-trips a (timestamp, id) pair through one URL parameter', () => {
    const encoded = encodeListCursor({ at: AT, id: ID });
    expect(encoded).toBe(`${AT}|${ID}`);
    expect(parseListCursor(encoded)).toEqual({ at: AT, id: ID });
    expect(normalizeListCursor(encoded)).toBe(encoded);
  });

  it('accepts the timestamp forms Postgres emits in jsonb', () => {
    for (const at of ['2026-09-13T01:59:11+00:00', '2026-09-13T01:59:11.5Z', '2026-09-13 01:59:11.123456+10']) {
      expect(parseListCursor(`${at}|${ID}`)).toEqual({ at, id: ID });
    }
  });

  it('treats anything malformed as no cursor so the page falls back to page one', () => {
    const bad = [
      '', 'not-a-cursor', `${AT}`, `${ID}`, `${AT}|`, `|${ID}`, `${AT}|not-a-uuid`, `2026-13-45T99:99:99Z|${ID}`,
      `${AT}|${ID}; drop table quotes`, `${AT}'|${ID}`, 'null', 'undefined',
    ];
    for (const raw of bad) {
      expect(parseListCursor(raw), raw).toBeNull();
      expect(normalizeListCursor(raw), raw).toBeNull();
    }
    expect(parseListCursor(null)).toBeNull();
    expect(parseListCursor(undefined)).toBeNull();
  });

  it('builds the next cursor only when the RPC reports another page with both halves', () => {
    expect(nextListCursor({ has_more: true, next_cursor: AT, next_cursor_id: ID })).toBe(`${AT}|${ID}`);
    expect(nextListCursor({ has_more: false, next_cursor: null, next_cursor_id: null })).toBeNull();
    expect(nextListCursor({ has_more: true, next_cursor: AT, next_cursor_id: null })).toBeNull();
    expect(nextListCursor({ has_more: true, next_cursor: null, next_cursor_id: ID })).toBeNull();
    expect(nextListCursor(null)).toBeNull();
  });
});
