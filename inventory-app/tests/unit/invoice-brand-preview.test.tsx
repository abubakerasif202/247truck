// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InvoiceBrandPreview } from '@/components/finance/invoice-brand-preview';

describe('invoice brand preview', () => {
  it('shows the supplied AWT visual identity and invoice sections', () => {
    render(<InvoiceBrandPreview brand="awt" brands={[{ brand: 'awt', business_name: 'Adelaide Wholesale Tyres', abn: null, address: null, phone: null, email: null, website: null, logo_asset_path: null, primary_colour: '#ef1d27', accent_colour: '#17191c', bank_instructions: null, invoice_footer: null }]} />);
    expect(screen.getByAltText('Adelaide Wholesale Tyres logo')).toHaveAttribute('src', expect.stringContaining('awt-logo.png'));
    expect(screen.getByText('TAX INVOICE')).toBeInTheDocument();
    expect(screen.getByText('BILL TO')).toBeInTheDocument();
    expect(screen.getByText('PAYMENT DETAILS & NOTES')).toBeInTheDocument();
    expect(screen.getByText('BALANCE DUE')).toBeInTheDocument();
  });
});
