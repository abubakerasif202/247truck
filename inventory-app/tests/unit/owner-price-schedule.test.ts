import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { allRows, classifyOwnerRow, decimalCents, parseSchedule, uniqueMap } from '../../scripts/owner-price-schedule-core.mjs';

const row = (price: string | null): Record<string, unknown> => ({ brand: 'Goodyear', pattern: 'G622', size: '11R22.5', quantity: '9', selling_price_aud: '649.00', source_quantity_text: '09', source_reference: 'owner-supplied', current: price });
const product = (price: string | null, extra = {}) => ({ id: 'p1', part_reference: 'SKU-1', selling_price_incl_gst: price, active: true, category_code: 'truck_tyre', tyre_condition: 'new', tyre_brand_id: 'b1', tyre_pattern_id: 'p1', tyre_size_id: 's1', ...extra });
const maps = { brandByName: new Map([['goodyear', 'b1']]), patternByIdentity: new Map([['b1|g622', 'p1']]), sizeByName: new Map([['11r22.5', 's1']]) };

describe('owner price reconciliation safety', () => {
  it('classifies NULL, matching and different prices without floating point arithmetic', () => {
    expect(classifyOwnerRow(row(null), maps, [product(null)]).match_status).toBe('price missing');
    expect(classifyOwnerRow(row('649.00'), maps, [product('649.00')]).match_status).toBe('already matching');
    expect(classifyOwnerRow(row('649.00'), maps, [product('650.00')]).match_status).toBe('price different');
    expect(decimalCents('649.10')).toBe(64910n);
  });

  it('classifies every owner schedule row as price missing when all 28 prices are NULL', async () => {
    const text = await readFile(resolve(process.cwd(), 'data/owner-price-schedule-2026-09-08.csv'), 'utf8');
    const parsed = parseSchedule(text, { headers: ['brand', 'pattern', 'size', 'source_quantity_text', 'quantity', 'selling_price_aud', 'source_reference'], rows: 28, referenceQuantity: 643n });
    const brands = new Map<string, string>();
    const patterns = new Map<string, string>();
    const sizes = new Map<string, string>();
    for (const item of parsed.rows) {
      const brandName = String(item.brand).toLowerCase();
      const brandId = brands.get(brandName) ?? `brand-${brands.size}`;
      brands.set(brandName, brandId);
      const patternKey = `${brandId}|${String(item.pattern).toLowerCase()}`;
      if (!patterns.has(patternKey)) patterns.set(patternKey, `pattern-${patterns.size}`);
      const sizeName = String(item.size).toLowerCase();
      if (!sizes.has(sizeName)) sizes.set(sizeName, `size-${sizes.size}`);
    }
    const products = parsed.rows.map((item, index) => {
      const brandId = brands.get(String(item.brand).toLowerCase());
      return { ...product(null), id: `product-${index}`, tyre_brand_id: brandId, tyre_pattern_id: patterns.get(`${brandId}|${String(item.pattern).toLowerCase()}`), tyre_size_id: sizes.get(String(item.size).toLowerCase()) };
    });
    const statuses = parsed.rows.map((item) => classifyOwnerRow(item, { brandByName: brands, patternByIdentity: patterns, sizeByName: sizes }, products).match_status);
    expect(statuses).toHaveLength(28);
    expect(statuses.every((status) => status === 'price missing')).toBe(true);
  });

  it('classifies missing, ambiguous and inactive identities', () => {
    expect(classifyOwnerRow(row('649.00'), maps, []).match_status).toBe('missing product');
    expect(classifyOwnerRow(row('649.00'), maps, [product('649.00'), product('650.00', { id: 'p2' })]).match_status).toBe('ambiguous identity');
    expect(classifyOwnerRow(row('649.00'), maps, [product('649.00', { active: false })]).match_status).toBe('inactive/unapproved product');
  });

  it('rejects duplicate schedule identities and supports the exact 28-row contract', () => {
    const text = ['brand,pattern,size,source_quantity_text,quantity,selling_price_aud,source_reference', 'Goodyear,G622,11R22.5,09,9,649.00,owner-supplied', 'Goodyear,G622,11R22.5,09,9,649.00,owner-supplied'].join('\n');
    expect(() => parseSchedule(text, { headers: ['brand', 'pattern', 'size', 'source_quantity_text', 'quantity', 'selling_price_aud', 'source_reference'], rows: 2, referenceQuantity: 18n })).toThrow('Duplicate owner schedule identity');
  });

  it('retrieves all pages and fails on an incomplete/error page', async () => {
    const calls: number[] = [];
    const client = { from: () => ({ select: () => ({ range: async (start: number) => { calls.push(start); return start === 0 ? { data: Array.from({ length: 2 }, (_, index) => ({ index })), error: null } : { data: [{ index: start }], error: null }; } }) }) };
    await expect(allRows(client, 'products', '*', 2)).resolves.toHaveLength(3);
    expect(calls).toEqual([0, 2]);
    const failing = { from: () => ({ select: () => ({ range: async () => ({ data: null, error: new Error('incomplete read') }) }) }) };
    await expect(allRows(failing, 'products', '*', 2)).rejects.toThrow('incomplete read');
  });

  it('rejects ambiguous lookup maps and the CLI apply mode', async () => {
    expect(() => uniqueMap([['same', '1'], ['same', '2']], 'brand')).toThrow('Ambiguous brand');
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => execFile(process.execPath, ['scripts/owner-price-schedule.mjs', '--target=local', '--output=.local/should-not-exist.json', '--apply'], (error) => error ? resolve() : reject(new Error('apply mode was accepted'))));
  });
});
