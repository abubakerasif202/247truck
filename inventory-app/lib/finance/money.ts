/** Exact display/test arithmetic. Database NUMERIC remains the write authority. */
export function decimalUnits(value: string, scale: number, precision: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > scale) throw new Error('INVALID_DECIMAL');
  const units = BigInt(match[1] + (match[2] ?? '').padEnd(scale, '0'));
  if (units >= 10n ** BigInt(precision)) throw new Error('MONEY_OUT_OF_RANGE');
  return units;
}

function rounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export type InvoiceMoneyInput = { quantity: string; price: string | null; discount: string };

export function calculateInvoice(inputs: readonly InvoiceMoneyInput[]) {
  if (!inputs.length) throw new Error('INVOICE_LINES_REQUIRED');
  let pending = false;
  const lines = inputs.map((input, position) => {
    const quantity = decimalUnits(input.quantity, 3, 12);
    const discount = decimalUnits(input.discount, 2, 5);
    if (quantity === 0n || discount > 10000n) throw new Error('INVALID_FINANCE_LINE');
    if (input.price === null) {
      pending = true;
      return null;
    }
    const base = rounded(quantity * decimalUnits(input.price, 2, 14), 1000n);
    if (base >= 10n ** 14n) throw new Error('MONEY_OUT_OF_RANGE');
    const discountAmount = rounded(base * discount, 10000n);
    const total = base - discountAmount;
    return { position, base, discountAmount, total, gst: total / 11n, remainder: total % 11n };
  });
  if (pending) return null;
  const priced = lines.filter((line) => line !== null);
  const total = priced.reduce((sum, line) => sum + line.total, 0n);
  if (total >= 10n ** 14n) throw new Error('MONEY_OUT_OF_RANGE');
  const gst = rounded(total, 11n);
  let remainder = gst - priced.reduce((sum, line) => sum + line.gst, 0n);
  const ordered = [...priced].sort((a, b) => a.remainder === b.remainder
    ? a.position - b.position : a.remainder > b.remainder ? -1 : 1);
  for (const line of ordered) {
    if (remainder === 0n) break;
    line.gst += 1n;
    remainder -= 1n;
  }
  return { total, gst, exGst: total - gst, lines: priced.map((line) => ({ ...line, exGst: line.total - line.gst })) };
}

/** Pure future ledger algebra; never queries tables belonging to later slices. */
export function financeBalances(T: bigint, C: bigint, G: bigint, A: bigint, R: bigint) {
  const adjustedSale = T - C;
  const appliedToSale = G - A;
  if (!(0n <= R && R <= A && A <= G && 0n <= A && A <= C && C <= T
    && 0n <= appliedToSale && appliedToSale <= adjustedSale)) {
    throw new Error('INVALID_FINANCIAL_STATE');
  }
  return { adjustedSale, appliedToSale, balance: adjustedSale - appliedToSale, refundDue: A - R, actualNetCash: G - R };
}
