type SaleLine = Record<string, unknown>;

/**
 * Reject inventory lines selected for a different branch and remove the UI
 * provenance field before calling the database RPC. The database remains the
 * authority for branch access, availability, pricing, and locking.
 */
export function validateSaleLineLocations(lines: unknown[], locationId: string): unknown[] {
  return lines.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return line;

    const saleLine = line as SaleLine;
    if (saleLine.line_type !== 'product') return line;
    if (saleLine.validated_location_id !== locationId) {
      throw new Error('SALE_LINE_LOCATION_MISMATCH');
    }

    const { validated_location_id: _validatedLocationId, ...rpcLine } = saleLine;
    return rpcLine;
  });
}
