/**
 * Maps a database sentinel (raised as the exception message by the transfer
 * RPCs) to an operational, user-facing message. Native Postgres errors —
 * which the RPCs are written to avoid surfacing — fall through to the
 * generic message rather than being shown to the user verbatim.
 */
const FRIENDLY: Record<string, string> = {
  ACCESS_DENIED: 'You do not have permission for this transfer action.',
  TRANSFER_NOT_FOUND: 'That transfer could not be found.',
  INVALID_TRANSFER_TRANSITION: 'That transfer is not in a state that allows this action.',
  INVALID_LOCATIONS: 'Choose two different branches for this transfer.',
  TRANSFER_LINES_REQUIRED: 'Add at least one product line to this transfer.',
  INVALID_TRANSFER_LINE: 'Check the product and quantity on each transfer line.',
  INSUFFICIENT_STOCK: 'The source branch does not have enough stock for this transfer.',
  OVER_RECEIPT: 'Received quantity cannot exceed what was dispatched.',
  UNKNOWN_OR_MISSING_RECEIPT_LINE: 'Every dispatched line must be accounted for in the receipt.',
  INVALID_RECEIPT_LINES: 'The receipt lines are not valid. Reload and try again.',
  DUPLICATE_RECEIPT_LINE: 'Each product can only appear once in a receipt.',
  IDEMPOTENCY_KEY_REUSED: 'This action was already submitted. Reload to see the current status.',
  IDEMPOTENCY_RECONCILIATION_REQUIRED:
    'This receipt needs administrator reconciliation before it can be retried.',
};

const GENERIC = 'The transfer action could not be completed.';

export function friendlyTransferError(message: string | undefined): string {
  if (!message) return GENERIC;
  if (message in FRIENDLY) return FRIENDLY[message];
  for (const [code, friendly] of Object.entries(FRIENDLY)) {
    if (message.includes(code)) return friendly;
  }
  return GENERIC;
}
