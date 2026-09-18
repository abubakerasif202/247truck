import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(protected)/invoices/actions', () => ({
  createManualInvoiceAction: vi.fn(async () => ({ ok: true })),
}));

import { ManualInvoiceForm } from '@/components/finance/manual-invoice-form';

const customer = {
  id: 'customer-1',
  customerNumber: 'C-100',
  displayName: 'Acme Fleet',
  paymentTerms: '30_days',
};

const formProps = {
  branches: [{ id: 'location-1', code: 'LON', label: 'Lonsdale' }],
  customerId: null,
  initialBrandOptions: {
    default_brand: '247' as const,
    can_override: false,
    brands: [{
      brand: '247' as const,
      business_name: '24/7 Truck Tyre Services',
      abn: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      logo_asset_path: null,
      primary_colour: null,
      accent_colour: null,
      bank_instructions: null,
      invoice_footer: null,
    }],
  },
};

function response(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body } as Response);
}

describe('ManualInvoiceForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/customers?')) return response({ customers: [customer] });
      return response({ vehicles: [] });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function showCustomerResults() {
    fireEvent.change(screen.getByRole('combobox', { name: 'Customer' }), { target: { value: 'Ac' } });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole('option', { name: 'C-100 · Acme Fleet' })).toBeInTheDocument();
  }

  it('applies a selected customer payment term and resets it when the customer changes', async () => {
    render(<ManualInvoiceForm {...formProps} />);

    await showCustomerResults();
    fireEvent.click(screen.getByRole('option', { name: 'C-100 · Acme Fleet' }));
    expect(screen.getByLabelText('Payment terms')).toHaveValue('30_days');

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('Payment terms')).toHaveValue('7_days');
  });

  it('selects the active customer result with the keyboard', async () => {
    render(<ManualInvoiceForm {...formProps} />);

    await showCustomerResults();
    const search = screen.getByRole('combobox', { name: 'Customer' });
    expect(search).toHaveAttribute('aria-activedescendant', 'invoice-customer-result-customer-1');
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(screen.getByText('C-100 · Acme Fleet')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('ignores a stale vehicle response after the customer selection is cleared', async () => {
    let resolveVehicles: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes('/customers?')) return response({ customers: [customer] });
      return new Promise<Response>((resolve) => { resolveVehicles = resolve; });
    });
    render(<ManualInvoiceForm {...formProps} />);

    await showCustomerResults();
    fireEvent.click(screen.getByRole('option', { name: 'C-100 · Acme Fleet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await act(async () => { resolveVehicles?.({ ok: true, json: async () => ({ vehicles: [{ id: 'vehicle-1', registration: 'S123ABC', fleet_number: null }] }) } as Response); });

    expect(screen.getByLabelText('Customer vehicle (optional)')).not.toHaveTextContent('S123ABC');
  });
});
