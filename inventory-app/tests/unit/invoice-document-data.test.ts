import { describe, expect, it } from 'vitest';

import { invoiceDocumentFromDetail } from '@/lib/documents/invoice-types';

describe('invoice document snapshot mapping', () => {
  it('maps the authoritative ex-GST line amount into the PDF', () => {
    const invoice = invoiceDocumentFromDetail({ id: 'i', current_revision_id: 'r', revisions: [{ id: 'r', business_snapshot: { address: { street_address: '1 Test Street' } }, lines: [
      { unit_price_ex_gst: '390', quantity: '8', subtotal_ex_gst: '3120', total_incl_gst: '3432' },
    ] }] });
    expect(invoice.lines[0]).toMatchObject({ unitPrice: '390', amount: '3120', total: '3432' });
    expect(invoice.business.street_address).toBe('1 Test Street');
  });
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
  it('keeps the issuer brand from the requested historical revision snapshot', () => {
    const invoice = invoiceDocumentFromDetail({
      id: 'invoice-id', invoice_number: 'INV-8', brand: 'awt', status: 'issued', current_revision_id: 'r2',
      revisions: [
        { id: 'r1', revision_number: 1, business_snapshot: { brand: '247', business_name: '24/7 Truck Tyre Services' }, lines: [] },
        { id: 'r2', revision_number: 2, business_snapshot: { brand: 'awt', business_name: 'AWT Tyres' }, lines: [] },
      ],
    }, 'r1');
    expect(invoice.business).toMatchObject({ brand: '247', business_name: '24/7 Truck Tyre Services' });
    expect(invoice.brand).toBe('247');
  });
});
