import 'server-only';

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

/**
 * Neutralises CSV/spreadsheet formula injection (OWASP): product, brand,
 * size, and supplier names are staff-entered strings that end up in these
 * exports, and a value opening with =, +, -, @, or a tab is interpreted as a
 * formula by Excel/Sheets on open. Prefixing with a single quote forces text
 * interpretation -- visible in the raw CSV, invisible once opened in a
 * spreadsheet. Only applied to genuine string values: a numeric column (a
 * negative quantity, a dollar figure) legitimately starts with "-" and must
 * stay a real number in the opened spreadsheet, not become quoted text.
 */
function neutraliseFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Quotes a single CSV field per RFC 4180: wrap and double-up embedded quotes
 * whenever the value contains a comma, quote, or newline. */
function csvField(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safeText = typeof value === 'string' ? neutraliseFormula(text) : text;
  if (/[",\r\n]/.test(safeText)) {
    return `"${safeText.replaceAll('"', '""')}"`;
  }
  return safeText;
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
