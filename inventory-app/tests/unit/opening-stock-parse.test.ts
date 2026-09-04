import { describe, expect, it } from 'vitest';

import { OPENING_STOCK_HEADER, parseOpeningStockCsv } from '../../lib/opening-stock/parse';
import {
  buildOpeningStockSource,
  deterministicUuid,
  loadOpeningStockSource,
} from '../../lib/opening-stock/source';

const header = OPENING_STOCK_HEADER.join(',');

function row(overrides: Partial<Record<(typeof OPENING_STOCK_HEADER)[number], string>> = {}) {
  const values: Record<(typeof OPENING_STOCK_HEADER)[number], string> = {
    Brand: 'Ralson',
    Pattern: 'RMR61',
    Size: '295/80r22.5',
    Quantity: '5',
    Condition: 'New',
    Category: 'Truck Tyre',
    Location: 'Regency Park',
    'Cost Price': '',
    'Selling Price': '',
    'Minimum Stock': '',
    'Reorder Quantity': '',
    Supplier: '',
    'Tracking Mode': 'Quantity',
    Notes: '',
    ...overrides,
  };
  return OPENING_STOCK_HEADER.map((name) => values[name]).join(',');
}

describe('opening stock source contract', () => {
  it('loads the committed source as exactly 53 lines and 725 tyres', async () => {
    const source = await loadOpeningStockSource();
    expect(source.rows).toHaveLength(53);
    expect(source.totalQuantity).toBe(725);
    expect(source.rows.reduce((sum, item) => sum + item.quantity, 0)).toBe(725);
    expect(new Set(source.rows.map((item) => item.location))).toEqual(new Set(['REG']));
    expect(new Set(source.rows.map((item) => item.condition))).toEqual(new Set(['new']));
    expect(source.rows.every((item) => item.costPrice === null)).toBe(true);
    expect(source.rows.every((item) => item.sellingPrice === null)).toBe(true);
    expect(source.datasetKey).toBe(`opening-stock-2026-09-04:${source.sha256}`);
    expect(new Set(source.rows.map((item) => item.requestId)).size).toBe(53);
  });

  it('creates stable UUID-shaped request ids', () => {
    const first = deterministicUuid('dataset:row');
    const second = deterministicUuid('dataset:row');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('supports quoted CSV fields and doubled quotes', () => {
    const input = `${header}\n${row({ Notes: '"Roadside, says ""urgent"""' })}\n`;
    const parsed = parseOpeningStockCsv(input);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.brand).toBe('Ralson');
  });

  it('rejects duplicate normalized row keys', () => {
    const input = `${header}\n${row()}\n${row({ Brand: ' ralson ', Pattern: 'rmr61', Size: '295/80R22.5' })}\n`;
    expect(() => buildOpeningStockSource(input)).toThrow(/Duplicate normalized opening-stock row/);
  });

  it('rejects a wrong header', () => {
    const badHeader: string[] = [...OPENING_STOCK_HEADER];
    badHeader[0] = 'Maker';
    expect(() => parseOpeningStockCsv(`${badHeader.join(',')}\n${row()}\n`)).toThrow(/header/);
  });

  it('rejects malformed quantities', () => {
    for (const quantity of ['', '0', '-1', '1.5', 'five']) {
      expect(() => parseOpeningStockCsv(`${header}\n${row({ Quantity: quantity })}\n`)).toThrow(/Quantity/);
    }
  });

  it('rejects any branch other than Regency Park', () => {
    expect(() => parseOpeningStockCsv(`${header}\n${row({ Location: 'Lonsdale' })}\n`)).toThrow(/Location must be Regency Park/);
  });

  it('rejects non-new condition', () => {
    expect(() => parseOpeningStockCsv(`${header}\n${row({ Condition: 'Used' })}\n`)).toThrow(/Condition must be New/);
  });

  it('rejects unexpected cost or selling price', () => {
    expect(() => parseOpeningStockCsv(`${header}\n${row({ 'Cost Price': '400' })}\n`)).toThrow(/Cost Price must be blank/);
    expect(() => parseOpeningStockCsv(`${header}\n${row({ 'Selling Price': '650' })}\n`)).toThrow(/Selling Price must be blank/);
  });

  it('rejects unterminated quotes', () => {
    expect(() => parseOpeningStockCsv(`${header}\n"Ralson,RMR61,295/80r22.5,5,New,Truck Tyre,Regency Park,,,,,,Quantity,`)).toThrow(/unterminated/);
  });
});
