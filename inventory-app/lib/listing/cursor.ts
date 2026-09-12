/**
 * Opaque keyset cursor shared by the quotes, jobs and purchase-order listings.
 *
 * The RPCs page on the (timestamp, id) pair so rows that share a timestamp are
 * never skipped across a page boundary. The two parts travel in one URL
 * parameter as `<timestamptz>|<uuid>`; anything that does not parse is
 * treated as "no cursor" so a tampered or stale link lands on page one instead
 * of surfacing a database cast error.
 */
export type ListCursor = { at: string; id: string };

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeListCursor(cursor: ListCursor): string {
  return `${cursor.at}|${cursor.id}`;
}

export function parseListCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw) return null;
  const separator = raw.indexOf('|');
  if (separator < 0) return null;
  const at = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!TIMESTAMP_RE.test(at) || !UUID_RE.test(id) || Number.isNaN(Date.parse(at))) return null;
  return { at, id };
}

/** Returns the raw cursor when it is well-formed, otherwise null (first page). */
export function normalizeListCursor(raw: string | null | undefined): string | null {
  return parseListCursor(raw) ? (raw as string) : null;
}

/** Builds the encoded next-page cursor from an RPC page envelope, or null on the last page. */
export function nextListCursor(result: { has_more?: boolean; next_cursor?: unknown; next_cursor_id?: unknown } | null): string | null {
  if (!result?.has_more || typeof result.next_cursor !== 'string' || typeof result.next_cursor_id !== 'string') return null;
  return encodeListCursor({ at: result.next_cursor, id: result.next_cursor_id });
}
