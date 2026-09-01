/**
 * Maps a database sentinel (raised as the exception message by the ledger RPCs)
 * to an operational, user-facing message. Native Postgres errors — which the
 * RPCs are written to avoid surfacing — fall through to the generic message.
 */
const FRIENDLY: Record<string, string> = {
  INSUFFICIENT_STOCK: 'Cannot remove this quantity. Available stock has changed.',
  ACCESS_DENIED: 'You do not have permission for this stock action.',
  NO_STOCK_CHANGE: 'The counted quantity is already correct.',
  REASON_REQUIRED: 'A reason is required for this change.',
  INBOUND_COST_REQUIRED: 'Enter a valid unit cost for incoming stock.',
  INVALID_COUNT: 'Enter a valid counted quantity.',
  INVALID_MOVEMENT_DIRECTION: 'That stock movement is going the wrong way.',
  INVALID_MOVEMENT_TYPE: 'That stock movement type is not recognised.',
  INVALID_TREAD_DEPTH: 'Enter a valid tread depth.',
  INVALID_CONDITION: 'Choose a valid tyre condition.',
  INVALID_COST: 'Enter a valid cost.',
  NOT_A_USED_TYRE: 'Individual units can only be added to used truck tyres.',
  PRODUCT_NOT_FOUND: 'That product could not be found.',
  BALANCE_NOT_FOUND: 'No stock record exists for that product and location.',
};

const GENERIC = 'The stock action could not be completed.';

export function friendlyInventoryError(message: string | undefined): string {
  if (!message) return GENERIC;
  // Exact match first (the RPC message is exactly the sentinel).
  if (message in FRIENDLY) return FRIENDLY[message];
  // Then a bounded substring check for sentinels wrapped in extra context.
  for (const [code, friendly] of Object.entries(FRIENDLY)) {
    if (message.includes(code)) return friendly;
  }
  return GENERIC;
}
