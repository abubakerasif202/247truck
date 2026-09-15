import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SaleDraftForm } from '../../components/sales/sale-draft-form';

const locations = [
  { id: 'loc-lon', code: 'LON' },
  { id: 'loc-reg', code: 'REG' },
];

describe('SaleDraftForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders no branch selector and posts the fixed branch when locationId is pinned', () => {
    const { container } = render(
      <SaleDraftForm action={() => {}} locationId="loc-lon" requestId="req-1" />,
    );
    expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
    const hidden = container.querySelector('input[name="location_id"]') as HTMLInputElement;
    expect(hidden.value).toBe('loc-lon');
  });

  it('requires an explicit branch choice — and disables submit until one is made — when no branch is pinned', () => {
    // This is the regression case for the bug where an Admin's sale always
    // silently defaulted to Lonsdale regardless of their selected branch
    // scope: when the page cannot resolve a single fixed branch, the form
    // must force an explicit choice rather than guess one.
    render(
      <SaleDraftForm
        action={() => {}}
        locationId=""
        locations={locations}
        requestId="req-2"
        actionLabel="Finalise POS sale"
      />,
    );
    const select = screen.getByLabelText('Branch') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('button', { name: 'Finalise POS sale' })).toBeDisabled();

    fireEvent.change(select, { target: { value: 'loc-reg' } });
    expect(select.value).toBe('loc-reg');
    // Still disabled: no lines added yet.
    expect(screen.getByRole('button', { name: 'Finalise POS sale' })).toBeDisabled();
  });

  it('never falls back to an empty idempotency key', () => {
    const { container } = render(
      <SaleDraftForm action={() => {}} locationId="loc-lon" requestId="req-3" />,
    );
    const hidden = container.querySelector('input[name="request_id"]') as HTMLInputElement;
    expect(hidden.value).toBe('req-3');
  });

  it.each([
    ['loc-reg', 'loc-lon'],
    ['loc-lon', 'loc-reg'],
  ])('locks branch %s after adding inventory and cannot switch to %s', async (from, to) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ products: [{
      productId: 'product-1', name: 'Branch tyre', brandName: 'Brand', sizeName: '11R22.5',
      tyreCondition: 'new', retailPriceInclGst: 330, wholesalePriceInclGst: 300,
      sellingPriceInclGst: 330, available: 4,
    }] }))));
    const { container } = render(<SaleDraftForm action={() => {}} locations={locations} requestId="req-branch" />);
    const branch = screen.getByLabelText('Branch') as HTMLSelectElement;
    fireEvent.change(branch, { target: { value: from } });
    fireEvent.change(screen.getByLabelText('Search product'), { target: { value: 'branch tyre' } });
    fireEvent.click(await screen.findByRole('option', { name: /Branch tyre/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));

    expect(branch).toBeDisabled();
    fireEvent.change(branch, { target: { value: to } });
    expect(branch.value).toBe(from);
    expect(screen.getByText('Remove all inventory lines before changing branch.')).toBeInTheDocument();
    const lines = JSON.parse((container.querySelector('input[name="lines"]') as HTMLInputElement).value);
    expect(lines).toEqual([expect.objectContaining({ product_id: 'product-1', validated_location_id: from })]);
  });

  it('clears a selected used tyre and all product search state when branch changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/sales/used-units')) {
        return new Response(JSON.stringify({ units: [{ id: 'unit-1', internal_unit_code: 'USED-1', condition: 'good', tread_depth_mm: 8, location_id: 'loc-reg', status: 'available' }] }));
      }
      return new Response(JSON.stringify({ products: [{
        productId: 'used-product', name: 'Used tyre', brandName: 'Brand', sizeName: '11R22.5',
        tyreCondition: 'used', retailPriceInclGst: 110, wholesalePriceInclGst: 100,
        sellingPriceInclGst: 110, available: 1,
      }] }));
    }));
    render(<SaleDraftForm action={() => {}} locations={locations} requestId="req-used" />);
    const branch = screen.getByLabelText('Branch') as HTMLSelectElement;
    const search = screen.getByLabelText('Search product') as HTMLInputElement;
    fireEvent.change(branch, { target: { value: 'loc-reg' } });
    fireEvent.change(search, { target: { value: 'used tyre' } });
    fireEvent.click(await screen.findByRole('option', { name: /Used tyre/ }));
    expect(await screen.findByLabelText('Used tyre unit')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Used tyre unit'), { target: { value: 'unit-1' } });

    fireEvent.change(branch, { target: { value: 'loc-lon' } });
    expect(branch.value).toBe('loc-lon');
    expect(search.value).toBe('');
    expect(screen.queryByLabelText('Used tyre unit')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Used tyre/ })).not.toBeInTheDocument();
  });
});
