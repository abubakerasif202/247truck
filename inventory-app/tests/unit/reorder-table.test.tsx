import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReorderTable } from '../../components/purchasing/reorder-table';

vi.mock('../../app/(protected)/purchasing/purchase-orders/actions', () => ({
  createDraftPurchaseOrdersFromReorderAction: vi.fn(),
  setInventoryReorderSettingsAction: vi.fn(),
}));

const suggestions = [
  {
    productId: 'product-1', productName: 'Tyre A', locationCode: 'LON' as const,
    available: 2, minimumStock: 5, reorderQuantity: 8,
    preferredSupplierId: 'supplier-1', preferredSupplierName: 'Supplier A',
  },
  {
    productId: 'product-2', productName: 'Valve B', locationCode: 'LON' as const,
    available: 0, minimumStock: 2, reorderQuantity: 4,
    preferredSupplierId: null, preferredSupplierName: null,
  },
];

const suppliers = [{
  id: 'supplier-1', name: 'Supplier A', active: true, abn: null,
  contactName: null, phone: null, email: null, address: null,
  paymentTerms: null, accountReference: null, notes: null,
}];

describe('ReorderTable', () => {
  it('disables missing-supplier rows and the create button until selection', () => {
    render(<ReorderTable locationId="location-lon" suggestions={suggestions} suppliers={suppliers} canEdit />);
    expect(screen.getAllByRole('checkbox', { name: 'Select Valve B' })[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create draft POs' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Tyre A' })[0]);
    expect(screen.getByRole('button', { name: 'Create draft POs' })).toBeEnabled();
  });

  it('renders a location-locked read-only table without settings controls', () => {
    render(<ReorderTable locationId="location-lon" suggestions={suggestions} suppliers={suppliers} canEdit={false} />);
    expect(screen.getAllByText('Supplier A')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: 'Select Tyre A' })[0]).toBeDisabled();
  });
});
