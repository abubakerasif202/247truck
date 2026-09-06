import { describe, expect, it } from 'vitest';

import { primaryNavItems } from '../../components/shell/nav';
import type { AccessSnapshot } from '../../lib/auth/permissions';
import { financeError } from '../../lib/finance/errors';
import {
  CreateManualInvoiceSchema,
  ReviseInvoiceSchema,
  UpdateInvoiceDraftSchema,
} from '../../lib/finance/invoice-schemas';

const manager = (permissions: string[]): AccessSnapshot => ({
  userId: 'm',
  role: 'manager',
  locationId: 'lon',
  locationCode: 'LON',
  permissions: permissions as never,
});
const admin: AccessSnapshot = {
  userId: 'a',
  role: 'admin',
  locationId: null,
  locationCode: null,
  permissions: [],
};

describe('Phase 4B invoice policy', () => {
  it('shows the Invoices nav item only with invoices.view', () => {
    expect(primaryNavItems(manager([])).some((i) => i.href === '/invoices')).toBe(false);
    expect(primaryNavItems(manager(['invoices.view'])).some((i) => i.href === '/invoices')).toBe(true);
    expect(primaryNavItems(admin).some((i) => i.href === '/invoices')).toBe(true);
  });

  it('accepts a valid manual service invoice payload', () => {
    const parsed = CreateManualInvoiceSchema.safeParse({
      customer_id: '11111111-1111-4111-8111-111111111111',
      payment_terms: '7_days',
      lines: [{ description: 'Callout', quantity: '1', unit_price_incl_gst: '110' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a product line, a bad decimal and an empty description on a manual invoice', () => {
    for (const line of [
      { line_type: 'product', product_id: 'x', description: 'Tyre', quantity: '1' },
      { description: 'Bad price', quantity: '1', unit_price_incl_gst: '10.999' },
      { description: '   ', quantity: '1' },
    ]) {
      expect(CreateManualInvoiceSchema.safeParse({ lines: [line] }).success).toBe(false);
    }
  });

  it('requires a revision reason and forwards only allowlisted fields', () => {
    expect(ReviseInvoiceSchema.safeParse({ expected_version: 2 }).success).toBe(false);
    const ok = ReviseInvoiceSchema.safeParse({ expected_version: 2, revision_reason: 'Wording fix' });
    expect(ok.success).toBe(true);
    // unknown keys are stripped / rejected
    expect(
      UpdateInvoiceDraftSchema.safeParse({ expected_version: 1, total_incl_gst: '999', lines: [{ description: 'x', quantity: '1' }] })
        .success,
    ).toBe(false);
  });

  it('maps 4B sentinels to safe copy and hides raw database errors', () => {
    expect(financeError({ message: 'JOB_CONSUMPTION_UNVERIFIED' })).toContain('could not be verified');
    expect(financeError({ message: 'ISSUED_CANCELLATION_NOT_AVAILABLE' })).toContain('cannot be cancelled yet');
    expect(financeError({ message: 'INVOICE_VERSION_CONFLICT' })).toContain('reload');
    expect(financeError({ message: 'duplicate key value violates unique constraint "pg_class"' })).not.toContain('pg_class');
  });
});
