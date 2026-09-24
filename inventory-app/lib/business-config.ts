import 'server-only';

/** Public issuer data for new documents. Issued revisions retain their stored snapshots. */
export const BUSINESS_CONFIG = {
  '247': {
    brand: '247', business_name: '24/7 Truck Tyre Services', legal_name: 'AGGY TEK PTY LTD',
    abn: '85640190996', phone: '+61 452 636 802',
    email: 'admin@247trucktyreservices.com.au', reply_to_address: 'admin@247trucktyreservices.com.au',
    email_sender_name: '24/7 Truck Tyre Services', website: 'https://247trucktyreservices.com.au',
    address: { street_address: '1/55 Plymouth Road', suburb: 'Wingfield', state: 'SA', postcode: '5013', country: 'Australia' },
    bank_instructions: { bank_name: 'ANZ', account_name: '24/7 Truck Tyre Service', bsb: '065122', account_number: '11293981', payment_reference: 'Invoice number', instructions: 'Please quote the invoice number as the payment reference.' },
    invoice_footer: 'Please note wheels require re-tensioning within 50 km of fitting. All parts and tyres remain the property of 24/7 Truck Tyre Services until the invoice is paid in full.',
    primary_colour: '#c91f2c', accent_colour: '#8f1721', logo_asset_path: '/brand/logo-247-invoice-2026.png',
  },
  awt: {
    brand: 'awt', business_name: 'Adelaide Wholesale Tyres',
    abn: '47690275588', phone: '+61 478 827 017',
    email: 'admin@adelaidewholesaletyres.com.au', reply_to_address: 'admin@adelaidewholesaletyres.com.au',
    email_sender_name: 'Adelaide Wholesale Tyres', website: 'https://adelaidewholesaletyres.com.au',
    address: { street_address: '4 Birralee Rd', suburb: 'Regency Park', state: 'SA', postcode: '5010', country: 'Australia' },
    bank_instructions: { bank_name: 'ANZ', account_name: 'Adelaide Wholesale Tyres', bsb: '065122', account_number: '11293981', payment_reference: 'Invoice number', instructions: 'Please quote the invoice number as the payment reference.' },
    invoice_footer: 'Thank you for choosing Adelaide Wholesale Tyres. Please quote the invoice number with payment.',
    primary_colour: '#ef1d27', accent_colour: '#17191c', logo_asset_path: '/invoice-templates/awt-logo.png',
  },
} as const;

export type BusinessBrand = keyof typeof BUSINESS_CONFIG;
