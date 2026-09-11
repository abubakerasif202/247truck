import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentAccess = vi.fn();
const rpc = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/access', () => ({ getCurrentAccess: (...args: unknown[]) => getCurrentAccess(...args) }));
vi.mock('@/lib/finance/queries', () => ({ getInvoiceDetail: vi.fn() }));
vi.mock('@/lib/documents/render-invoice-pdf', () => ({ renderInvoicePdf: vi.fn() }));
vi.mock('@/lib/email/invoice-email', () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(async () => ({ rpc })) }));

import { cancelInvoiceAction } from '../../app/(protected)/invoices/actions';

const INVOICE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const access = { userId: 'admin-1', role: 'admin', locationId: null, locationCode: null, permissions: new Set(['invoices.cancel', 'invoices.view']) };

function form(reason: string) {
  const data = new FormData();
  data.set('reason', reason);
  data.set('request_id', REQUEST_ID);
  return data;
}

describe('cancelInvoiceAction reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentAccess.mockResolvedValue(access);
  });

  it('reports the recorded outcome instead of a generic error when a request id is reused with different details', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'IDEMPOTENCY_KEY_REUSED' } })
      .mockResolvedValueOnce({ data: { found: true, action: 'cancel_invoice', invoice_number: 'LON-INV-000042', invoice_status: 'issued', result: { cancellation_pending: true } }, error: null });

    const result = await cancelInvoiceAction(INVOICE_ID, 3, undefined, form('Changed reason'));

    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenNthCalledWith(2, 'finance_request_outcome', { p_request_id: REQUEST_ID });
    expect(result).toMatchObject({ error: expect.stringContaining('LON-INV-000042') });
    expect(result).toMatchObject({ error: expect.stringContaining('cancellation pending a refund payout') });
    expect(result).toMatchObject({ error: expect.stringContaining('Do not submit another cancellation') });
  });

  it('falls back to the generic idempotency message when the recorded outcome cannot be read', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'IDEMPOTENCY_KEY_REUSED' } })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'ACCESS_DENIED' } });

    const result = await cancelInvoiceAction(INVOICE_ID, 3, undefined, form('Changed reason'));

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already used with different details') });
  });

  it('returns the replayed result for an identical retry without any reconciliation lookup', async () => {
    rpc.mockResolvedValueOnce({ data: { invoice_id: INVOICE_ID, status: 'cancelled', version: 4 }, error: null });

    const result = await cancelInvoiceAction(INVOICE_ID, 3, undefined, form('Customer cancellation'));

    expect(result).toMatchObject({ ok: true, data: { status: 'cancelled', version: 4 } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
