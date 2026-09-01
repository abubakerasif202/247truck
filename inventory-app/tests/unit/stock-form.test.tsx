import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StockForm } from '../../components/stock/stock-form';
import type { InventorySummaryRow } from '../../lib/inventory/queries';
import type { AccessSnapshot } from '../../lib/auth/permissions';
import type { ActionResult } from '../../lib/action-result';
import type { InventoryMutationResult } from '../../lib/inventory/types';

const noop = async (): Promise<ActionResult<InventoryMutationResult>> => ({
  ok: false,
  error: 'x',
});

function row(overrides: Partial<InventorySummaryRow> = {}): InventorySummaryRow {
  return {
    productId: 'p1',
    name: 'Michelin X Line',
    categoryCode: 'truck_tyre',
    partReference: null,
    sellingPriceInclGst: 700,
    tyreCondition: 'new',
    brandName: 'Michelin',
    patternName: 'X Line',
    sizeName: '315/80R22.5',
    locationCode: 'LON',
    locationName: 'Lonsdale',
    onHand: 12,
    reserved: 2,
    available: 10,
    weightedAverageCost: 450,
    minimumStock: 6,
    reorderQuantity: 12,
    lowStock: false,
    ...overrides,
  };
}

const manager: AccessSnapshot = {
  userId: 'm1',
  role: 'manager',
  locationId: 'l-lon',
  locationCode: 'LON',
  permissions: ['inventory.view', 'inventory.stock_in', 'inventory.stock_out'],
};

const admin: AccessSnapshot = {
  userId: 'a1',
  role: 'admin',
  locationId: null,
  locationCode: null,
  permissions: [],
};

const locationIds = { LON: 'l-lon', REG: 'l-reg' } as const;

function renderForm(props: Partial<Parameters<typeof StockForm>[0]> = {}) {
  return render(
    <StockForm
      mode="in"
      action={noop}
      rows={[row()]}
      access={manager}
      canViewCost
      locationIds={locationIds}
      {...props}
    />,
  );
}

describe('StockForm', () => {
  it('pins a Manager to their branch with no branch selector', () => {
    renderForm();
    expect(screen.getByText('Lonsdale')).toBeInTheDocument();
    expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
  });

  it('gives an Admin a branch selector', () => {
    renderForm({ access: admin, canViewCost: false });
    expect(screen.getByLabelText('Branch')).toBeInTheDocument();
  });

  it('renders stock-out reasons and no barcode/QR control', () => {
    renderForm({ mode: 'out', canViewCost: false });
    expect(screen.getByText('Damaged')).toBeInTheDocument();
    expect(screen.getByText('Warranty return')).toBeInTheDocument();
    expect(screen.queryByText(/barcode/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scan/i)).not.toBeInTheDocument();
  });

  it('shows the balance preview once a product is chosen, with WAC only when permitted', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /Michelin X Line/ }));
    expect(screen.getByText('Weighted avg cost')).toBeInTheDocument();
  });

  it('never shows WAC to a user without inventory.view_cost', () => {
    renderForm({ canViewCost: false });
    fireEvent.click(screen.getByRole('button', { name: /Michelin X Line/ }));
    expect(screen.queryByText('Weighted avg cost')).not.toBeInTheDocument();
  });

  it('blocks a stock-out above available stock', () => {
    renderForm({ mode: 'out', canViewCost: false });
    fireEvent.click(screen.getByRole('button', { name: /Michelin X Line/ }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '25' } });
    expect(screen.getByText(/Only 10 available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove stock' })).toBeDisabled();
  });

  it('only offers used tyres in used-intake mode', () => {
    render(
      <StockForm
        mode="used-intake"
        action={noop}
        rows={[row({ tyreCondition: 'new' })]}
        access={manager}
        canViewCost={false}
        locationIds={locationIds}
      />,
    );
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });
});
