import { describe, expect, it } from 'vitest';

import { mapPurchasingDashboardCounts } from '../../lib/purchasing/queries';

describe('purchasing dashboard counts', () => {
  it('counts only submitted and awaiting-receipt statuses', () => {
    expect(mapPurchasingDashboardCounts([
      { status: 'submitted' },
      { status: 'draft' },
      { status: 'approved' },
      { status: 'sent' },
      { status: 'partially_received' },
      { status: 'received' },
      { status: 'rejected' },
      { status: 'cancelled' },
      { status: 'closed' },
    ])).toEqual({ pendingApproval: 1, approvedAwaitingReceipt: 3 });
  });

  it('returns counts only and does not map cost-bearing fields', () => {
    expect(mapPurchasingDashboardCounts([{ status: 'submitted', ordered_total: 999 }])).toEqual({
      pendingApproval: 1,
      approvedAwaitingReceipt: 0,
    });
  });
});
