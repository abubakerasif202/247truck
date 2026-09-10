import { describe, expect, it } from 'vitest';

import { invoiceDocumentFromDetail } from '@/lib/documents/invoice-types';

describe('invoice document snapshot mapping', () => {
  it('uses the requested immutable revision and payment projection', () => {
    const invoice = invoiceDocumentFromDetail({
      id: 'invoice-id', invoice_number: 'INV-7', status: 'issued', current_revision_id: 'r2',
      financials: { effective_paid: '100.00', balance: '10.00' },
      revisions: [
        { id: 'r1', revision_number: 1, payment_method: 'bank_transfer', business_snapshot: { business_name: 'Original Pty Ltd' }, customer_snapshot: { display_name: 'Original Customer' }, lines: [], subtotal_ex_gst: '100', gst_amount: '10', total_incl_gst: '110' },
        { id: 'r2', revision_number: 2, business_snapshot: { business_name: 'Current Pty Ltd' }, customer_snapshot: { display_name: 'Current Customer' }, lines: [], subtotal_ex_gst: '100', gst_amount: '10', total_incl_gst: '110' },
      ],
    }, 'r1');
    expect(invoice.revisionId).toBe('r1');
    expect(invoice.business.business_name).toBe('Original Pty Ltd');
    expect(invoice.customer.display_name).toBe('Original Customer');
    expect(invoice.amountPaid).toBe('100.00');
    expect(invoice.balanceDue).toBe('10.00');
    expect(invoice.paymentMethod).toBe('bank_transfer');
  });
});
