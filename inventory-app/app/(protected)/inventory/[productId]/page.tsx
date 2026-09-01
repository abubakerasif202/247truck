import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArchiveToggle } from '@/components/inventory/archive-toggle';
import { getCurrentAccess } from '@/lib/auth/access';
import { formatAud, formatTyreMeta } from '@/lib/format';
import { PRODUCT_CATEGORY_LABELS } from '@/lib/products/types';
import { getProduct } from '@/lib/products/repository';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type UsedUnitRow = {
  id: string;
  internal_unit_code: string;
  tread_depth_mm: number;
  condition: string;
  status: string;
  locations: { code: string } | null;
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const access = await getCurrentAccess();
  const supabase = await createServerSupabaseClient();

  const product = await getProduct(supabase, productId);
  if (!product) notFound();

  const { data: unitsData } = await supabase
    .from('used_tyre_units')
    .select('id, internal_unit_code, tread_depth_mm, condition, status, locations(code)')
    .eq('product_id', productId)
    .order('internal_unit_code')
    .returns<UsedUnitRow[]>();

  const units = unitsData ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <Link
        href="/inventory"
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        ← Inventory
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{product.name}</h1>
          <p className="text-sm text-muted-foreground">
            {PRODUCT_CATEGORY_LABELS[product.categoryCode]}
            {product.active ? '' : ' · Archived'}
          </p>
        </div>
        {access.role === 'admin' ? (
          <ArchiveToggle productId={product.id} active={product.active} />
        ) : null}
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Selling price (GST incl.)</dt>
          <dd>{formatAud(product.sellingPriceInclGst)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Part / reference</dt>
          <dd>{product.partReference ?? '—'}</dd>
        </div>
        {product.tyreCondition ? (
          <div>
            <dt className="text-muted-foreground">Tyre</dt>
            <dd>
              {formatTyreMeta({
                condition: product.tyreCondition,
                brand: product.brandName,
                pattern: product.patternName,
                size: product.sizeName,
              })}
            </dd>
          </div>
        ) : null}
      </dl>

      {product.tyreCondition === 'used' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Individually tracked units</h2>
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No individual units yet. Units are created with their intake stock
              movement.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {units.map((unit) => (
                <li
                  key={unit.id}
                  className="rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <span className="font-medium">{unit.internal_unit_code}</span>
                  <span className="ml-2 text-muted-foreground">
                    {unit.locations?.code} · {unit.tread_depth_mm}mm ·{' '}
                    {unit.condition} · {unit.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
