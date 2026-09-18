import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OpeningStockForm } from '../../components/inventory/opening-stock-form';
import type { InventorySummaryRow } from '../../lib/inventory/queries';

const searchStockProductsAction = vi.fn();
vi.mock('../../app/(protected)/stock/search-actions', () => ({
  searchStockProductsAction: (...args: unknown[]) => searchStockProductsAction(...args),
}));

const row: InventorySummaryRow = {
  productId: '11111111-1111-4111-8111-111111111111', name: 'Opening tyre', categoryCode: 'truck_tyre',
  partReference: null, sellingPriceInclGst: null, retailPriceInclGst: null, wholesalePriceInclGst: null,
  tyreCondition: 'new', brandName: 'Test', patternName: 'Opening', sizeName: '11R22.5',
  locationCode: 'REG', locationName: 'Regency Park', onHand: 0, reserved: 0, available: 0,
  weightedAverageCost: null, minimumStock: 0, reorderQuantity: 0, lowStock: false,
};

describe('OpeningStockForm', () => {
  it('posts one selected product through the dedicated manual action and keeps a stable retry id', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: { movementId: 'm1', onHand: 3, reserved: 0, available: 3, weightedAverageCost: null } });
    searchStockProductsAction.mockResolvedValue({ ok: true, rows: [row] });
    const { container } = render(<OpeningStockForm action={action} rows={[row]} locationIds={{ LON: 'lon', REG: 'reg' }} />);
    fireEvent.click(screen.getByRole('option', { name: /Opening tyre/ }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Opening unit cost (optional)'), { target: { value: '120.50' } });
    fireEvent.change(screen.getByLabelText('Notes / reference (optional)'), { target: { value: 'count sheet' } });
    const requestId = (container.querySelector('input[name="requestId"]') as HTMLInputElement).value;
    fireEvent.submit(container.querySelector('form')!);
    await screen.findByText('Opening stock added. On hand is now 3.');
    const form = action.mock.calls[0][1] as FormData;
    expect(form.get('productId')).toBe(row.productId);
    expect(form.get('locationCode')).toBe('REG');
    expect(form.get('quantity')).toBe('3');
    expect(form.get('unitCost')).toBe('120.50');
    expect(form.get('reference')).toBe('count sheet');
    expect(form.get('requestId')).toBe(requestId);
    expect(searchStockProductsAction).toHaveBeenCalledWith('', 'opening-stock', row.productId);
  });

  it('shows the correct LON user-facing label without changing its submitted code', () => {
    render(<OpeningStockForm action={vi.fn()} rows={[row]} locationIds={{ LON: 'lon', REG: 'reg' }} />);
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'LON' } });
    expect(screen.getByRole('option', { name: 'AWT Tyres Website' })).toBeInTheDocument();
    expect((screen.getByLabelText('Location') as HTMLSelectElement).value).toBe('LON');
  });

  it('leaves the optional cost blank rather than substituting zero', () => {
    render(<OpeningStockForm action={vi.fn()} rows={[row]} locationIds={{ LON: 'lon', REG: 'reg' }} />);
    expect(screen.getByText(/not treated as \$0/)).toBeInTheDocument();
    expect(screen.getByLabelText('Opening unit cost (optional)')).toHaveValue(null);
  });
});
