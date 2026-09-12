import { describe, expect, it } from 'vitest';

import { friendlyTransferError } from '@/lib/transfers/errors';

describe('friendlyTransferError', () => {
  it('maps a known sentinel to its friendly message', () => {
    expect(friendlyTransferError('INSUFFICIENT_STOCK')).toBe(
      'The source branch does not have enough stock for this transfer.',
    );
  });

  it('maps a sentinel wrapped in extra Postgres context', () => {
    expect(friendlyTransferError('P0001: OVER_RECEIPT')).toBe(
      'Received quantity cannot exceed what was dispatched.',
    );
  });

  it('never leaks a raw, unmapped database error to the caller', () => {
    const raw = 'duplicate key value violates unique constraint "stock_transfer_actions_pkey"';
    const mapped = friendlyTransferError(raw);
    expect(mapped).toBe('The transfer action could not be completed.');
    expect(mapped).not.toContain('constraint');
    expect(mapped).not.toContain('stock_transfer_actions_pkey');
  });

  it('falls back to the generic message when no message is given', () => {
    expect(friendlyTransferError(undefined)).toBe('The transfer action could not be completed.');
  });
});
