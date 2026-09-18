import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccess: vi.fn(),
  getPurchaseOrderDetail: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/access', () => ({ getCurrentAccess: mocks.getCurrentAccess }));
vi.mock('@/lib/purchasing/queries', () => ({ getPurchaseOrderDetail: mocks.getPurchaseOrderDetail }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { receivePurchaseOrderAction } from '@/app/(protected)/purchasing/purchase-orders/actions';

const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const LINE_ID = '11111111-1111-4111-8111-111111111111';

function form() {
  const data = new FormData();
  data.set('requestId', REQUEST_ID);
  data.set('lines', JSON.stringify([{ purchaseOrderLineId: LINE_ID, receiveNow: 5, outstandingQuantity: 10 }]));
  return data;
}

/**
 * Regression: receivePurchaseOrderAction used to call
 * `p_request_id: randomUUID()` -- a fresh key minted server-side on every
 * invocation -- instead of a key supplied by the client. A lost response
 * (timeout, reload) then retried with a brand new request ID, silently
 * bypassing receive_purchase_order's `unique (received_by, location_id,
 * request_id)` replay guard: a partial receipt could be posted twice,
 * double-counting stock and cost. The fix threads a client-generated,
 * validated requestId through parseReceiptForm into the RPC call, so an
 * identical retry reuses the same key the database guard is keyed on.
 */
describe('receivePurchaseOrderAction request-id stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccess.mockResolvedValue({
      role: 'manager', locationId: 'lon', locationCode: 'LON',
      permissions: new Set(['purchasing.view', 'purchasing.receive_po']),
    });
    mocks.getPurchaseOrderDetail.mockResolvedValue({
      id: 'po-1',
      actions: { canReceive: true },
      lines: [{ id: LINE_ID, orderedQuantity: 10, receivedQuantity: 0 }],
    });
    mocks.rpc.mockResolvedValue({ data: { purchase_order_id: 'po-1' }, error: null });
  });

  it('sends the exact same p_request_id on a retry of the same form submission', async () => {
    const formData = form();

    await receivePurchaseOrderAction('po-1', undefined, formData);
    await receivePurchaseOrderAction('po-1', undefined, formData);

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    const firstArgs = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
    const secondArgs = mocks.rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(firstArgs.p_request_id).toBe(REQUEST_ID);
    expect(secondArgs.p_request_id).toBe(REQUEST_ID);
  });

  it('rejects a receipt with no request ID rather than silently minting one', async () => {
    const formData = form();
    formData.delete('requestId');

    const result = await receivePurchaseOrderAction('po-1', undefined, formData);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('refresh and retry') });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
