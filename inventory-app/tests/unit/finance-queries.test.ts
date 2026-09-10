import { describe, expect, it } from 'vitest';

import { buildInvoiceSummaryRpcArgs } from '@/lib/finance/queries';

describe('invoice summary query contract', () => {
  it('passes the validated source filter to the paginated RPC', () => {
    const result = buildInvoiceSummaryRpcArgs({ sourceType: 'manual', page: 3, limit: 10 });
    expect(result.args).toMatchObject({ p_source_type: 'manual', p_offset: 20, p_limit: 10 });
    expect(result.page).toBe(3);
  });

  it('does not pass unsupported source values', () => {
    expect(buildInvoiceSummaryRpcArgs({ sourceType: 'job;drop table invoices' }).args.p_source_type).toBeNull();
  });
});
