import type { InvoiceDocumentData } from './invoice-types';

/** Development/test-only sample. It is never persisted or delivered. */
export const invoice10602Fixture: InvoiceDocumentData = {
  invoiceId: 'fixture-10602', revisionId: 'fixture-10602-r1', invoiceNumber: '10602', revisionNumber: 1,
  status: 'issued', issueDate: '2026-08-17', dueDate: '2026-08-24', paymentTerms: '7_days', paymentMethod: 'bank_transfer',
  customerReference: null, customerNotes: null,
  business: { business_name: '24/7 Truck Tyre Services', abn: null, phone: null, shared_email: null,
    bank_instructions: null,
    invoice_footer: 'Please note wheels require retention within 50kms of fitting\nAll parts and tyres remain the property of 24/7 Truck tyre until this invoice is paid in full.' },
  branch: {}, customer: { display_name: 'Lakhnoor Singh' }, billingContact: null,
  vehicle: { registration: 'XS66KY', odometer_km: 958010, service_date: '2026-08-17', tyre_position: 'Drive set tyres' },
  job: { odometer_km: 958010, service_date: '2026-08-17', tyre_position: 'Drive set tyres' },
  lines: [
    { id: '1', description: 'Greforce HD02 11R 22.5 Drive', quantity: '8', unitPrice: '390.00', discountPercent: '0', discountAmount: '0.00', gstAmount: '312.00', amount: '3120.00', tyre: { brand: 'Greforce', model: 'HD02', size: '11R 22.5', position: 'Drive', quantity_fitted: 8 } },
    { id: '2', description: 'Steers rotation', quantity: '2', unitPrice: '20.00', discountPercent: '0', discountAmount: '0.00', gstAmount: '4.00', amount: '40.00' },
  ],
  subtotal: '3160.00', gst: '316.00', total: '3476.00', amountPaid: '0.00', balanceDue: '3476.00',
};
