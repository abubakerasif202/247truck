'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import type { StockSearchMode } from '@/app/(protected)/stock/search-actions';
import { searchStockProductsAction } from '@/app/(protected)/stock/search-actions';
import type { InventorySummaryRow } from '@/lib/inventory/queries';

export type PickerProduct = {
  id: string;
  name: string;
  subtitle?: string | null;
};

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Searchable product selector. Renders a filter box plus a native list; the
 * chosen id is submitted via a hidden input named `productId`.
 *
 * With an empty term it shows the initial (already-loaded) product list.
 * Once the user types, it debounces a server-side search over the full
 * catalog (not just the first page loaded on the page) so products beyond
 * the initial page are still reachable, and reports fetched rows back to the
 * parent so its balance lookups (on-hand/reserved/available) stay correct
 * for products the initial page never loaded.
 */
export function ProductPicker({
  products,
  value,
  onChange,
  mode,
  onRowsFetched,
}: {
  products: PickerProduct[];
  value: string | null;
  onChange: (id: string) => void;
  mode: StockSearchMode;
  onRowsFetched: (rows: InventorySummaryRow[]) => void;
}) {
  const [term, setTerm] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [searchResults, setSearchResults] = useState<PickerProduct[] | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const trimmed = term.trim();
    if (!trimmed) {
      // Nothing to fetch: leave prior search state alone. It is never
      // rendered for an empty term (see `filtered` and the status banners
      // below), so there is nothing to reset synchronously here.
      return;
    }

    let cancelled = false;
    const seq = ++requestSeq.current;

    const timer = setTimeout(() => {
      if (cancelled) return;
      setSearchStatus('loading');
      searchStockProductsAction(trimmed, mode)
        .then((result) => {
          if (cancelled || requestSeq.current !== seq) return;
          if (!result.ok) {
            setSearchStatus('error');
            setSearchResults([]);
            return;
          }
          onRowsFetched(result.rows);
          const seen = new Map<string, PickerProduct>();
          for (const row of result.rows) {
            if (!seen.has(row.productId)) {
              seen.set(row.productId, {
                id: row.productId,
                name: row.name,
                subtitle: [row.brandName, row.sizeName, row.categoryCode]
                  .filter(Boolean)
                  .join(' · '),
              });
            }
          }
          setSearchResults([...seen.values()]);
          setSearchStatus('idle');
        })
        .catch(() => {
          if (cancelled || requestSeq.current !== seq) return;
          setSearchStatus('error');
          setSearchResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onRowsFetched is stable per render cycle of the parent form
  }, [term, mode]);

  const isSearching = term.trim() !== '';
  const filtered = useMemo(() => {
    if (!isSearching) return products.slice(0, 30);
    return searchResults ?? [];
  }, [products, isSearching, searchResults]);

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
      {isSearching && searchStatus === 'loading' ? (
        <p className="text-xs text-muted-foreground">Searching…</p>
      ) : null}
      {isSearching && searchStatus === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          Could not search products. Try again.
        </p>
      ) : null}
      <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">
            {isSearching && searchStatus === 'loading' ? 'Searching…' : 'No matches.'}
          </li>
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
