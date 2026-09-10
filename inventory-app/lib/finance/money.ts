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

export type InvoiceMoneyInput = {
  quantity: string;
  price: string | null;
  /** Legacy percentage discount. Prefer discountType/value for new invoices. */
  discount?: string;
  discountType?: 'percent' | 'fixed';
  discountValue?: string;
  pricingBasis?: 'inclusive' | 'exclusive';
  gstTreatment?: 'taxable' | 'gst_free';
};

export function calculateInvoice(inputs: readonly InvoiceMoneyInput[]) {
  if (!inputs.length) throw new Error('INVOICE_LINES_REQUIRED');
  let pending = false;
  const lines = inputs.map((input, position) => {
    const quantity = decimalUnits(input.quantity, 3, 12);
    const discountType = input.discountType ?? 'percent';
    const discount = decimalUnits(input.discountValue ?? input.discount ?? '0', 2, discountType === 'percent' ? 5 : 14);
    if (quantity === 0n || (discountType === 'percent' && discount > 10000n)) throw new Error('INVALID_FINANCE_LINE');
    if (input.price === null) {
      pending = true;
      return null;
    }
    const base = rounded(quantity * decimalUnits(input.price, 2, 14), 1000n);
    if (base >= 10n ** 14n) throw new Error('MONEY_OUT_OF_RANGE');
    const discountAmount = discountType === 'percent' ? rounded(base * discount, 10000n) : discount;
    if (discountAmount > base) throw new Error('INVALID_FINANCE_LINE');
    const discounted = base - discountAmount;
    const taxable = (input.gstTreatment ?? 'taxable') === 'taxable';
    const exclusive = (input.pricingBasis ?? 'inclusive') === 'exclusive';
    const gst = taxable ? (exclusive ? rounded(discounted, 10n) : input.pricingBasis ? rounded(discounted, 11n) : discounted / 11n) : 0n;
    const total = exclusive ? discounted + gst : discounted;
    return {
      position, base, discountAmount, total, gst,
      exGst: exclusive ? discounted : discounted - gst,
      remainder: taxable && !exclusive ? discounted % 11n : 0n,
      allocateInclusiveGst: taxable && !exclusive && input.pricingBasis == null,
    };
  });
  if (pending) return null;
  const priced = lines.filter((line) => line !== null);
  const total = priced.reduce((sum, line) => sum + line.total, 0n);
  if (total >= 10n ** 14n) throw new Error('MONEY_OUT_OF_RANGE');
  const inclusive = priced.filter((line) => line.allocateInclusiveGst);
  const inclusiveTotal = inclusive.reduce((sum, line) => sum + line.total, 0n);
  const targetInclusiveGst = rounded(inclusiveTotal, 11n);
  let remainder = targetInclusiveGst - inclusive.reduce((sum, line) => sum + line.gst, 0n);
  const ordered = [...inclusive].sort((a, b) => a.remainder === b.remainder
    ? a.position - b.position : a.remainder > b.remainder ? -1 : 1);
  for (const line of ordered) {
    if (remainder === 0n) break;
    line.gst += 1n;
    remainder -= 1n;
  }
  const gst = priced.reduce((sum, line) => sum + line.gst, 0n);
  const discountTotal = priced.reduce((sum, line) => sum + line.discountAmount, 0n);
  return { total, gst, exGst: total - gst, subtotal: total - gst, discountTotal, lines: priced };
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
