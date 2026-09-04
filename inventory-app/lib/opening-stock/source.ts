import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseOpeningStockCsv } from './parse';
import type { OpeningStockSource } from './types';

const SOURCE_PATH = resolve(
  process.cwd(),
  'data',
  'opening-stock-2026-09-04.csv',
);

export function deterministicUuid(input: string): string {
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 32);
  const chars = hex.split('');
  chars[12] = '5';
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16]!, 16) & 3]!;
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function buildOpeningStockSource(input: string): OpeningStockSource {
  const sha256 = createHash('sha256').update(input, 'utf8').digest('hex');
  const datasetKey = `opening-stock-2026-09-04:${sha256}`;
  const parsed = parseOpeningStockCsv(input);

  const seen = new Set<string>();
  for (const row of parsed) {
    if (seen.has(row.rowKey)) {
      throw new Error(`Duplicate normalized opening-stock row: ${row.rowKey}.`);
    }
    seen.add(row.rowKey);
  }

  const rows = parsed.map((row) => ({
    ...row,
    requestId: deterministicUuid(`${datasetKey}:${row.rowKey}`),
  }));
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);

  return {
    datasetKey,
    sha256,
    rows,
    totalQuantity,
  };
}

export async function loadOpeningStockSource(): Promise<OpeningStockSource> {
  const input = await readFile(SOURCE_PATH, 'utf8');
  const source = buildOpeningStockSource(input);

  if (source.rows.length !== 53) {
    throw new Error(
      `Opening stock source must contain exactly 53 product lines; found ${source.rows.length}.`,
    );
  }
  if (source.totalQuantity !== 725) {
    throw new Error(
      `Opening stock source must total exactly 725 tyres; found ${source.totalQuantity}.`,
    );
  }

  return source;
}
