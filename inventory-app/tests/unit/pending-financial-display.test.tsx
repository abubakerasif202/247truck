import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { InventoryView } from '../../components/inventory/inventory-view';
import { formatAudOrPending } from '../../lib/format';
import type { InventorySummaryRow } from '../../lib/inventory/queries';

function row(overrides: Partial<InventorySummaryRow> = {}): InventorySummaryRow {
  return {
    productId: 'pending-product',
    name: 'Ralson RMR61 295/80R22.5',
    categoryCode: 'truck_tyre',
    partReference: null,
    sellingPriceInclGst: null,
    tyreCondition: 'new',
    brandName: 'Ralson',
    patternName: 'RMR61',
    sizeName: '295/80R22.5',
    locationCode: 'REG',
    locationName: 'Regency Park',
    onHand: 51,
    reserved: 0,
    available: 51,
    weightedAverageCost: null,
    minimumStock: 0,
    reorderQuantity: 0,
    lowStock: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe('pending financial display', () => {
  it('shows Price Pending and Cost Pending for positive unknown-cost stock', () => {
    render(
      <InventoryView
        rows={[row()]}
        scope={{ kind: 'location', code: 'REG' }}
        canViewCost
      />,
    );

    expect(screen.getAllByText('Price Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cost Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders a real numeric zero as $0.00 rather than pending', () => {
    render(
      <InventoryView
        rows={[row({ sellingPriceInclGst: 0, weightedAverageCost: 0 })]}
        scope={{ kind: 'location', code: 'REG' }}
        canViewCost
      />,
    );

    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('Price Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Cost Pending')).not.toBeInTheDocument();
    expect(formatAudOrPending(0)).toBe('$0.00');
    expect(formatAudOrPending(null)).toBe('—');
  });

  it('does not expose cost-pending state when cost permission is absent', () => {
    render(
      <InventoryView
        rows={[row()]}
        scope={{ kind: 'location', code: 'REG' }}
        canViewCost={false}
      />,
    );

    expect(screen.getAllByText('Price Pending').length).toBeGreaterThan(0);
    expect(screen.queryByText('Cost Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('WAC:')).not.toBeInTheDocument();
  });
});
