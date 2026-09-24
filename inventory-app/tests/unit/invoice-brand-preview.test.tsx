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

  it('shows the updated 24/7 logo in the invoice preview', () => {
    render(<InvoiceBrandPreview brand="247" brands={[{ brand: '247', business_name: '24/7 Truck Tyre Services', abn: null, address: null, phone: null, email: null, website: null, logo_asset_path: '/brand/logo-247-invoice-2026.png', primary_colour: '#c91f2c', accent_colour: '#8f1721', bank_instructions: null, invoice_footer: null }]} />);
    expect(screen.getByAltText('24/7 Truck Tyre Services logo')).toHaveAttribute('src', expect.stringContaining('logo-247-invoice-2026.png'));
  });
});
