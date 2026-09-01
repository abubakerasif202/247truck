import Link from 'next/link';

import { formatAud, formatTyreMeta } from '@/lib/format';
import {
  PRODUCT_CATEGORY_LABELS,
  type ProductSummary,
} from '@/lib/products/types';

function meta(product: ProductSummary): string {
  return formatTyreMeta({
    condition: product.tyreCondition,
    brand: product.brandName,
    pattern: product.patternName,
    size: product.sizeName,
  });
}

export function ProductTable({ products }: { products: ProductSummary[] }) {
  if (products.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        No products match these filters.
      </p>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Category / tyre</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 text-right font-medium">Sell price</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link
                    href={`/inventory/${product.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {PRODUCT_CATEGORY_LABELS[product.categoryCode]} · {meta(product)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {product.partReference ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatAud(product.sellingPriceInclGst)}
                </td>
                <td className="px-3 py-2">
                  {product.active ? 'Active' : 'Archived'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {products.map((product) => (
          <li
            key={product.id}
            className="rounded-lg border border-border bg-card p-3"
          >
            <Link
              href={`/inventory/${product.id}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {product.name}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {PRODUCT_CATEGORY_LABELS[product.categoryCode]} · {meta(product)}
            </p>
            <p className="mt-1 text-sm">
              {formatAud(product.sellingPriceInclGst)}
              {product.active ? '' : ' · Archived'}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
