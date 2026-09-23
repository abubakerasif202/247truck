import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUSINESS_CONFIG } from '@/lib/business-config';

describe('fixed issuer identity', () => {
  it('keeps each issuer separate and uses the supplied shared bank account', () => {
    const truck = BUSINESS_CONFIG['247'];
    const awt = BUSINESS_CONFIG.awt;
    expect(truck).toMatchObject({ business_name: '24/7 Truck Tyre Services', abn: '85640190996', email: 'admin@247trucktyreservices.com.au', website: 'https://247trucktyreservices.com.au' });
    expect(awt).toMatchObject({ business_name: 'Adelaide Wholesale Tyres', abn: '47690275588', email: 'admin@adelaidewholesaletyres.com.au', website: 'https://adelaidewholesaletyres.com.au' });
    expect(truck.address).toMatchObject({ street_address: '1/55 Plymouth Road', suburb: 'Wingfield', postcode: '5013' });
    expect(awt.address).toMatchObject({ street_address: '4 Birralee Rd', suburb: 'Regency Park', postcode: '5010' });
    expect(truck.bank_instructions).toMatchObject({ bsb: '065122', account_number: '11293981', account_name: '24/7 Truck Tyre Service' });
    expect(awt.bank_instructions).toMatchObject({ bsb: '065122', account_number: '11293981', account_name: 'Adelaide Wholesale Tyres' });
    expect(truck.invoice_footer).toContain('re-tensioning within 50 km');
    expect(awt.invoice_footer).toContain('Thank you for choosing Adelaide Wholesale Tyres');
    expect(readFileSync(resolve('public', truck.logo_asset_path.slice(1))).length).toBeGreaterThan(0);
    expect(readFileSync(resolve('public', awt.logo_asset_path.slice(1))).length).toBeGreaterThan(0);
  });
});
