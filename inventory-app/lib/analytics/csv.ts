import 'server-only';

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

/** Quotes a single CSV field per RFC 4180: wrap and double-up embedded quotes
 * whenever the value contains a comma, quote, or newline. */
function csvField(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => csvField(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvField(c.value(row))).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

/** Safe filename fragment: lowercase, hyphenated, no path separators. */
export function csvFilename(parts: (string | number)[]): string {
  const slug = parts
    .map((p) => String(p).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, ''))
    .filter(Boolean)
    .join('_');
  return `${slug}.csv`;
}
