import { describe, expect, it } from 'vitest';

import { csvFilename, toCsv } from '@/lib/analytics/csv';

type Row = { name: string; count: number; note: string | null };

describe('toCsv', () => {
  it('quotes fields containing commas, quotes, or newlines per RFC 4180', () => {
    const csv = toCsv<Row>(
      [{ name: 'Michelin, X Line "Pro"', count: 1, note: 'line1\nline2' }],
      [
        { header: 'Name', value: (r) => r.name },
        { header: 'Count', value: (r) => r.count },
        { header: 'Note', value: (r) => r.note },
      ],
    );
    expect(csv).toContain('"Michelin, X Line ""Pro"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it('renders null/undefined as an empty field', () => {
    const csv = toCsv<Row>([{ name: 'X', count: 1, note: null }], [{ header: 'Note', value: (r) => r.note }]);
    expect(csv).toBe('Note\r\n\r\n');
  });

  it('neutralises a string field that opens with =, +, -, @ so it cannot execute as a spreadsheet formula', () => {
    const dangerous = ['=1+1', '+1+1', '-2+3', '@SUM(A1:A9)'];
    for (const value of dangerous) {
      const csv = toCsv<Row>([{ name: value, count: 1, note: null }], [{ header: 'Name', value: (r) => r.name }]);
      const dataLine = csv.split('\r\n')[1];
      // A leading single quote forces text interpretation in Excel/Sheets --
      // the raw line has no reason to need RFC 4180 quote-wrapping here
      // (no comma/quote/newline in the value), so this is the literal cell text.
      expect(dataLine.startsWith("'")).toBe(true);
      expect(dataLine).toBe(`'${value}`);
    }
  });

  it('neutralises a formula-opening value even when it ALSO needs RFC 4180 quote-wrapping', () => {
    // Cell value after any CSV parser un-escapes the wrapping quotes must
    // still start with the neutralising `'`, not the raw `=`.
    const csv = toCsv<Row>(
      [{ name: '=cmd|"/c calc"!A1', count: 1, note: null }],
      [{ header: 'Name', value: (r) => r.name }],
    );
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine.startsWith('"')).toBe(true); // RFC 4180 wrapper, because the value contains a quote
    const unescaped = dataLine.slice(1, -1).replaceAll('""', '"'); // undo CSV quote escaping, as a real parser would
    expect(unescaped.startsWith("'")).toBe(true);
    expect(unescaped).toBe('\'=cmd|"/c calc"!A1');
  });

  it('does NOT prefix a genuinely negative numeric value with a quote (must stay a real number in the spreadsheet)', () => {
    const csv = toCsv<Row>([{ name: 'X', count: -5, note: null }], [{ header: 'Count', value: (r) => r.count }]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe('-5');
  });

  it('does not mistake a plain product name for a formula', () => {
    const csv = toCsv<Row>([{ name: 'Michelin X Line 315/80R22.5', count: 1, note: null }], [{ header: 'Name', value: (r) => r.name }]);
    expect(csv.split('\r\n')[1]).toBe('Michelin X Line 315/80R22.5');
  });
});

describe('csvFilename', () => {
  it('slugifies and joins parts with underscores', () => {
    expect(csvFilename(['Replenishment', 'REG'])).toBe('replenishment_reg.csv');
  });

  it('produces no path separators even from unusual input', () => {
    const name = csvFilename(['../../etc/passwd', 'REG']);
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });
});
