export function exactText(value: unknown): string;
export function decimalCents(value: unknown): bigint | null;
export function parseSchedule(text: string, expected: { headers: string[]; rows: number; referenceQuantity: bigint }): { rows: Array<Record<string, string>>; referenceQuantity: bigint };
export function allRows<T = Record<string, unknown>>(client: unknown, table: string, columns: string, pageSize?: number): Promise<T[]>;
export function uniqueMap(values: Array<[string, unknown]>, label: string): Map<string, unknown>;
export function classifyOwnerRow(row: Record<string, unknown>, maps: { brandByName: Map<string, string>; patternByIdentity: Map<string, string>; sizeByName: Map<string, string> }, products: Array<Record<string, unknown>>): Record<string, unknown>;
