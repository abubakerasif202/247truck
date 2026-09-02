'use client';

import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';

export type PickerProduct = {
  id: string;
  name: string;
  subtitle?: string | null;
};

/**
 * Searchable product selector. Renders a filter box plus a native list; the
 * chosen id is submitted via a hidden input named `productId`.
 */
export function ProductPicker({
  products,
  value,
  onChange,
}: {
  products: PickerProduct[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [term, setTerm] = useState('');

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return products.slice(0, 30);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(t) ||
          (p.subtitle ?? '').toLowerCase().includes(t),
      )
      .slice(0, 30);
  }, [products, term]);

  const selected = products.find((p) => p.id === value) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="productId" value={value ?? ''} />
      <Input
        placeholder="Search product name, brand, or size"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        className="h-11"
        aria-label="Search products"
      />
      {selected ? (
        <p className="text-sm">
          Selected: <span className="font-medium">{selected.name}</span>
        </p>
      ) : null}
      <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">No matches.</li>
        ) : (
          filtered.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onChange(product.id)}
                className={`flex w-full flex-col items-start gap-0.5 min-h-11 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 ${
                  product.id === value ? 'bg-secondary' : 'hover:bg-secondary/50'
                }`}
              >
                <span className="font-medium">{product.name}</span>
                {product.subtitle ? (
                  <span className="text-xs text-muted-foreground">
                    {product.subtitle}
                  </span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
