import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockForm } from '../../components/stock/stock-form';
import type { InventorySummaryRow } from '../../lib/inventory/queries';
import type { AccessSnapshot } from '../../lib/auth/permissions';
import type { ActionResult } from '../../lib/action-result';
import type { InventoryMutationResult } from '../../lib/inventory/types';

const searchStockProductsAction = vi.fn();

vi.mock('../../app/(protected)/stock/search-actions', () => ({
  searchStockProductsAction: (...args: unknown[]) => searchStockProductsAction(...args),
}));

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
  beforeEach(() => {
    searchStockProductsAction.mockReset();
    searchStockProductsAction.mockResolvedValue({ ok: true, rows: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('searches the server for a product beyond the initial page and merges its balance', async () => {
    const foundRow = row({
      productId: 'p2',
      name: 'Bridgestone R150',
      brandName: 'Bridgestone',
      onHand: 5,
      reserved: 1,
      available: 4,
    });
    searchStockProductsAction.mockResolvedValue({ ok: true, rows: [foundRow] });

    renderForm();
    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'Bridgestone' },
    });

    await waitFor(() => {
      expect(searchStockProductsAction).toHaveBeenCalledWith('Bridgestone', 'in');
    });
    const match = await screen.findByRole('button', { name: /Bridgestone R150/ });
    fireEvent.click(match);

    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('shows a searching state while the debounced lookup is in flight', async () => {
    let resolveSearch: (value: { ok: true; rows: InventorySummaryRow[] }) => void = () => {};
    searchStockProductsAction.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'Bridge' },
    });

    expect((await screen.findAllByText('Searching…')).length).toBeGreaterThan(0);
    resolveSearch({ ok: true, rows: [] });
    await waitFor(() => {
      expect(screen.queryAllByText('Searching…')).toHaveLength(0);
    });
  });

  it('shows an error state when the search action fails', async () => {
    searchStockProductsAction.mockResolvedValue({ ok: false, error: 'boom' });

    renderForm();
    fireEvent.change(screen.getByLabelText('Search products'), {
      target: { value: 'zz' },
    });

    expect(
      await screen.findByText('Could not search products. Try again.'),
    ).toBeInTheDocument();
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
