import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ rpc })),
}));

import { buildInvoiceSummaryRpcArgs, listInvoices, listReceivables } from '@/lib/finance/queries';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invoice summary query contract', () => {
  it('passes the validated source filter to the paginated RPC', () => {
    const result = buildInvoiceSummaryRpcArgs({ sourceType: 'manual', page: 3, limit: 10 });
    expect(result.args).toMatchObject({ p_source_type: 'manual', p_offset: 20, p_limit: 10 });
    expect(result.page).toBe(3);
  });

  it('does not pass unsupported source values', () => {
    expect(buildInvoiceSummaryRpcArgs({ sourceType: 'job;drop table invoices' }).args.p_source_type).toBeNull();
  });

  it('forwards locationId as p_location_id', () => {
    expect(buildInvoiceSummaryRpcArgs({ locationId: 'location-1' }).args.p_location_id).toBe('location-1');
    expect(buildInvoiceSummaryRpcArgs({}).args.p_location_id).toBeNull();
  });
});

describe('listInvoices', () => {
  it('returns ok:false (not an empty list) when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'ACCESS_DENIED' } });
    const result = await listInvoices({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Invoices could not be loaded. Please retry.');
    }
  });

  it('returns ok:true with empty rows when data is empty', async () => {
    rpc.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
    const result = await listInvoices({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    }
  });
});

describe('listReceivables', () => {
  it('forwards a null-due-date cursor with an invoice id unchanged and surfaces has_more/next_cursor', async () => {
    rpc.mockResolvedValue({
      data: {
        rows: [],
        has_more: true,
        next_cursor: { due_date: null, invoice_id: '11111111-1111-1111-1111-111111111111' },
      },
      error: null,
    });
    const result = await listReceivables({
      cursorDueDate: null,
      cursorInvoiceId: '00000000-0000-0000-0000-000000000000',
    });
    expect(rpc).toHaveBeenCalledWith('customer_receivables_v2', expect.objectContaining({
      p_cursor_due_date: null,
      p_cursor_invoice_id: '00000000-0000-0000-0000-000000000000',
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toEqual({ dueDate: null, invoiceId: '11111111-1111-1111-1111-111111111111' });
    }
  });

  it('rejects a due-date cursor without an invoice id', async () => {
    const result = await listReceivables({ cursorDueDate: '2026-01-01', cursorInvoiceId: null });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns ok:false when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_RECEIVABLE_FILTER' } });
    const result = await listReceivables({});
    expect(result.ok).toBe(false);
  });
});
