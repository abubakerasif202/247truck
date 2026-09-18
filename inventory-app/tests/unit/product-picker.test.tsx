import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(protected)/stock/search-actions', () => ({
  searchStockProductsAction: vi.fn(async () => ({ ok: true, rows: [] })),
}));

import { ProductPicker } from '@/components/stock/product-picker';

const products = [
  { id: 'product-1', name: 'Michelin X Line', subtitle: '315/80R22.5' },
  { id: 'product-2', name: 'Bridgestone R150', subtitle: '295/80R22.5' },
];

/**
 * Regression: this combobox had no arrow-key navigation, unlike the customer
 * picker in components/finance/manual-invoice-form.tsx, which was fixed to
 * support it earlier. Every result was still reachable via Tab (each is a
 * real <button>, no keyboard trap), but arrow-key selection -- the expected
 * combobox interaction pattern -- did not work.
 */
describe('ProductPicker keyboard navigation', () => {
  function setup() {
    const onChange = vi.fn();
    render(
      <ProductPicker
        products={products}
        value={null}
        onChange={onChange}
        mode="in"
        onRowsFetched={() => {}}
      />,
    );
    return { onChange };
  }

  it('exposes combobox semantics and moves aria-activedescendant with arrow keys', () => {
    setup();
    const search = screen.getByRole('combobox', { name: 'Search products' });
    expect(search).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search).toHaveAttribute('aria-activedescendant', 'product-picker-result-product-1');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search).toHaveAttribute('aria-activedescendant', 'product-picker-result-product-2');

    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(search).toHaveAttribute('aria-activedescendant', 'product-picker-result-product-1');
  });

  it('selects the active result on Enter', () => {
    const { onChange } = setup();
    const search = screen.getByRole('combobox', { name: 'Search products' });

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('product-2');
  });

  it('clears the active descendant on Escape', () => {
    setup();
    const search = screen.getByRole('combobox', { name: 'Search products' });

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search).toHaveAttribute('aria-activedescendant', 'product-picker-result-product-1');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).not.toHaveAttribute('aria-activedescendant');
  });

  it('every result remains directly clickable and reachable without a keyboard trap', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('option', { name: /Bridgestone R150/ }));
    expect(onChange).toHaveBeenCalledWith('product-2');
  });
});
