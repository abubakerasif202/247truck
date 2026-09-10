/** Display/test helper for the PostgreSQL T/C/G/A/R projection. It deliberately
 * rejects invalid ledgers instead of clamping them. PostgreSQL remains authoritative. */
export function refundAlgebra(input: { total: bigint; credits: bigint; grossPaid: bigint; reversed: bigint; authorised: bigint; refunded: bigint }) {
  const g = input.grossPaid - input.reversed;
  const e = input.total - input.credits;
  const appliedToSale = g - input.authorised;
  const balance = e - appliedToSale;
  const refundDue = input.authorised - input.refunded;
  if ([input.total, input.credits, g, input.authorised, input.refunded, e, appliedToSale, balance, refundDue].some((value) => value < 0n)
    || input.credits > input.total || input.authorised > input.credits || input.authorised > g || input.refunded > input.authorised || appliedToSale > e) {
    throw new Error('FINANCE_INVARIANT_VIOLATION');
  }
  return { adjustedSale: e, appliedToSale, balance, refundDue, actualNetCash: g - input.refunded };
}
