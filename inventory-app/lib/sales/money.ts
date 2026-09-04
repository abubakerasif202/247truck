import type { DocumentTotals } from './types';

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function decimalToScaledInteger(value: string, scale: number): number {
  const normalized = value.trim();
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > scale) {
    throw new Error('INVALID_DECIMAL');
  }
  const fraction = (match[2] ?? '').padEnd(scale, '0');
  const result = Number(`${match[1]}${fraction}`);
  if (!Number.isSafeInteger(result)) throw new Error('MONEY_OUT_OF_RANGE');
  return result;
}

export function calculateLineTotalCents(
  quantity: string,
  unitPriceInclGst: string | null,
): number | null {
  if (unitPriceInclGst === null) return null;
  const quantityThousandths = decimalToScaledInteger(quantity, 3);
  const unitCents = decimalToScaledInteger(unitPriceInclGst, 2);
  const product = quantityThousandths * unitCents;
  if (!Number.isSafeInteger(product)) throw new Error('MONEY_OUT_OF_RANGE');
  const result = Math.round(product / 1000);
  if (!Number.isSafeInteger(result)) throw new Error('MONEY_OUT_OF_RANGE');
  return result;
}

export function calculateDocumentTotals(
  lineTotalsCents: readonly (number | null)[],
): DocumentTotals | null {
  if (lineTotalsCents.some((total) => total === null)) return null;
  const totalInclGstCents = lineTotalsCents.reduce<number>(
    (sum, total) => sum + (total ?? 0),
    0,
  );
  const gstCents = Math.round(totalInclGstCents / 11);
  return {
    subtotalExGstCents: totalInclGstCents - gstCents,
    gstCents,
    totalInclGstCents,
  };
}

export function formatCentsAud(cents: number | null): string {
  return cents === null ? 'PRICE PENDING' : AUD.format(cents / 100);
}
