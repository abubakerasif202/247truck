import { normalizeLookup } from '@/lib/products/validation';

import type { OpeningStockRow } from './types';

export const OPENING_STOCK_HEADER = [
  'Brand',
  'Pattern',
  'Size',
  'Quantity',
  'Condition',
  'Category',
  'Location',
  'Cost Price',
  'Selling Price',
  'Minimum Stock',
  'Reorder Quantity',
  'Supplier',
  'Tracking Mode',
  'Notes',
] as const;

export type ParsedOpeningStockRow = Omit<OpeningStockRow, 'requestId'>;

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length !== 0) {
        throw new Error('Malformed CSV: quote started inside an unquoted field.');
      }
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      record.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      record.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      records.push(record);
      record = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field.');
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    records.push(record);
  }

  while (
    records.length > 0 &&
    records[records.length - 1]!.every((value) => value === '')
  ) {
    records.pop();
  }

  return records;
}

function requireNonBlank(value: string, label: string, rowNumber: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Row ${rowNumber}: ${label} is required.`);
  }
  return trimmed;
}

export function parseOpeningStockCsv(input: string): ParsedOpeningStockRow[] {
  const records = parseCsvRecords(input);
  if (records.length === 0) throw new Error('Opening stock CSV is empty.');

  const header = records[0]!;
  if (
    header.length !== OPENING_STOCK_HEADER.length ||
    header.some((value, index) => value !== OPENING_STOCK_HEADER[index])
  ) {
    throw new Error('Opening stock CSV header does not match the approved source format.');
  }

  const rows: ParsedOpeningStockRow[] = [];

  for (let index = 1; index < records.length; index += 1) {
    const values = records[index]!;
    const rowNumber = index + 1;

    if (values.length !== OPENING_STOCK_HEADER.length) {
      throw new Error(
        `Row ${rowNumber}: expected ${OPENING_STOCK_HEADER.length} columns, received ${values.length}.`,
      );
    }

    const brand = requireNonBlank(values[0]!, 'Brand', rowNumber);
    const pattern = requireNonBlank(values[1]!, 'Pattern', rowNumber);
    const size = requireNonBlank(values[2]!, 'Size', rowNumber);
    const quantityText = values[3]!.trim();
    const conditionText = values[4]!.trim();
    const categoryText = values[5]!.trim();
    const locationText = values[6]!.trim();
    const costPriceText = values[7]!.trim();
    const sellingPriceText = values[8]!.trim();

    if (!/^\d+$/.test(quantityText) || Number(quantityText) <= 0) {
      throw new Error(`Row ${rowNumber}: Quantity must be a positive integer.`);
    }
    const quantity = Number(quantityText);

    if (conditionText.toLowerCase() !== 'new') {
      throw new Error(`Row ${rowNumber}: Condition must be New.`);
    }
    if (categoryText !== 'Truck Tyre') {
      throw new Error(`Row ${rowNumber}: Category must be Truck Tyre.`);
    }
    if (locationText !== 'Regency Park') {
      throw new Error(`Row ${rowNumber}: Location must be Regency Park.`);
    }
    if (costPriceText !== '') {
      throw new Error(`Row ${rowNumber}: Cost Price must be blank for this opening stock source.`);
    }
    if (sellingPriceText !== '') {
      throw new Error(`Row ${rowNumber}: Selling Price must be blank for this opening stock source.`);
    }

    const rowKey = [brand, pattern, size, 'new'].map(normalizeLookup).join('|');

    rows.push({
      rowNumber,
      brand,
      pattern,
      size,
      quantity,
      condition: 'new',
      category: 'truck_tyre',
      location: 'REG',
      costPrice: null,
      sellingPrice: null,
      rowKey,
    });
  }

  return rows;
}
