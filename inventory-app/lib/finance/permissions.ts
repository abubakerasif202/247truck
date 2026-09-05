import { decimalUnits } from './money';

/** UI hint only. The DB repeats current permission, cap, reason and source checks. */
export function validateDiscount(input: {
  role: 'admin' | 'manager'; granted: boolean; mutationAllowed: boolean;
  cap: string | null; percent: string; reason: string | null;
}): boolean {
  try {
    if (!input.mutationAllowed) return false;
    const percent = decimalUnits(input.percent, 2, 5);
    if (percent > 10000n) return false;
    if (percent === 0n) return true;
    if (!input.reason?.trim() || input.reason.length > 500) return false;
    if (input.role === 'admin') return true;
    return input.granted && input.cap !== null && percent <= decimalUnits(input.cap, 2, 5);
  } catch {
    return false;
  }
}
