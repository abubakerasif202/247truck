import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseOrderForm } from '../../components/purchasing/purchase-order-form';

vi.mock('../../app/(protected)/purchasing/purchase-orders/actions', () => ({
  createPurchaseOrderAction: vi.fn(async () => ({ ok: true, purchaseOrderId: 'po-1' })),
  updatePurchaseOrderAction: vi.fn(async () => ({ ok: true, purchaseOrderId: 'po-1' })),
}));

const locations = [
  { id: 'lon-id', code: 'LON' as const, name: 'Lonsdale' },
  { id: 'reg-id', code: 'REG' as const, name: 'Regency Park' },
];

const suppliers = [
  {
    id: 'supplier-1',
    name: 'Supplier One',
    abn: null,
    contactName: null,
    phone: null,
    email: null,
    address: null,
    paymentTerms: null,
    accountReference: null,
    notes: null,
    active: true,
  },
];

const products = [
  { id: 'product-1', name: '11R22.5 Steer Tyre', partReference: 'TYRE-001' },
];

describe('PurchaseOrderForm', () => {
  it('renders the create workflow with line controls', () => {
    render(
      <PurchaseOrderForm
        locations={locations}
        suppliers={suppliers}
        products={products}
        fixedLocationId="lon-id"
      />,
    );

    expect(screen.getByLabelText('Location')).toHaveValue('lon-id');
    expect(screen.getByLabelText('Supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Supplier reference')).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase order notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Product 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity 1')).toHaveValue(1);
    expect(screen.getByLabelText('Unit cost 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeInTheDocument();
  });

  it('renders an editable existing draft without allowing its location to change', () => {
    render(
      <PurchaseOrderForm
        locations={locations}
        suppliers={suppliers}
        products={products}
        fixedLocationId="lon-id"
        purchaseOrder={{
          id: 'po-1',
          supplierId: 'supplier-1',
          supplierReference: 'SUP-42',
          notes: 'Rear loading bay',
          lines: [
            {
              productId: 'product-1',
              orderedQuantity: 4,
              unitCost: 125.5,
              notes: 'Steer axle',
            },
          ],
        }}
      />,
    );

    expect(screen.getByLabelText('Location')).toBeDisabled();
    expect(screen.getByLabelText('Supplier reference')).toHaveValue('SUP-42');
    expect(screen.getByLabelText('Purchase order notes')).toHaveValue('Rear loading bay');
    expect(screen.getByLabelText('Quantity 1')).toHaveValue(4);
    expect(screen.getByLabelText('Unit cost 1')).toHaveValue(125.5);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
  });

  it('renders identical initial-line element ids across separate mounts (hydration-safe)', () => {
    // The first line's id/htmlFor must be deterministic given the same props,
    // because Next.js renders this Client Component on the server and then
    // hydrates it in the browser. A random id here would mismatch between the
    // server-rendered HTML and the client render and break hydration.
    const props = { locations, suppliers, products, fixedLocationId: 'lon-id' };

    const first = render(<PurchaseOrderForm {...props} />);
    const firstId = first.getByLabelText('Product 1').id;
    first.unmount();

    const second = render(<PurchaseOrderForm {...props} />);
    const secondId = second.getByLabelText('Product 1').id;
    second.unmount();

    expect(firstId).toBe(secondId);
  });
});
