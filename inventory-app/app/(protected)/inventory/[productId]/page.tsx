import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArchiveToggle } from '@/components/inventory/archive-toggle';
import { ReorderSettingsForm } from '@/components/inventory/reorder-settings-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { hasPermission } from '@/lib/auth/permissions';
import { formatAud, formatTyreMeta } from '@/lib/format';
import { searchInventory } from '@/lib/inventory/queries';
import { PRODUCT_CATEGORY_LABELS } from '@/lib/products/types';
import { getProduct } from '@/lib/products/repository';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

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
  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();

  const product = await getProduct(supabase, productId);
  if (!product) notFound();

  const summaryRows = await searchInventory(supabase, access, {
    scope,
    productId,
    includeArchived: true,
  });

  const { data: unitsData } = await supabase
    .from('used_tyre_units')
    .select('id, internal_unit_code, tread_depth_mm, condition, status, locations(code)')
    .eq('product_id', productId)
    .order('internal_unit_code')
    .returns<UsedUnitRow[]>();
  const units = unitsData ?? [];

  const canStockIn = hasPermission(access, 'inventory.stock_in');
  const canStockOut = hasPermission(access, 'inventory.stock_out');
  const canAdjust = hasPermission(access, 'inventory.adjust');

  return (
    <div className="operations-page max-w-4xl domain-inventory">
      <Link href="/inventory" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
        ← Inventory
      </Link>

      <PageHeader domain="inventory" eyebrow="Product record" title={product.name} subtitle={<span className="flex flex-wrap items-center gap-2">{PRODUCT_CATEGORY_LABELS[product.categoryCode]}<StatusBadge status={product.active ? 'active' : 'inactive'}>{product.active ? 'Active' : 'Archived'}</StatusBadge>{product.tyreCondition ? <StatusBadge status={`${product.tyreCondition}_tyre`}>{product.tyreCondition === 'used' ? 'Used tyre' : 'New tyre'}</StatusBadge> : null}</span>} actions={access.role === 'admin' ? (
          <ArchiveToggle productId={product.id} active={product.active} />
        ) : null} />

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Selling price (GST incl.)</dt>
          <dd>
            {product.sellingPriceInclGst == null
              ? '—'
              : formatAud(product.sellingPriceInclGst)}
          </dd>
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

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Stock by branch</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {summaryRows.map((row) => (
            <li
              key={row.locationCode}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
            >
              <span>{row.locationName}</span>
              <span>
                {row.available} available
                {row.lowStock ? (
                  <StatusBadge status="low stock" className="ml-2">Low stock</StatusBadge>
                ) : null}
                {row.weightedAverageCost !== null
                  ? ` · WAC ${formatAud(row.weightedAverageCost)}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(canStockIn || canStockOut || canAdjust) ? (
        <section className="flex flex-wrap gap-2">
          {canStockIn ? (
            <Link href="/stock/in" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Stock In
            </Link>
          ) : null}
          {canStockOut ? (
            <Link href="/stock/out" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Stock Out
            </Link>
          ) : null}
          {canAdjust ? (
            <Link href="/stock/adjust" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Adjust
            </Link>
          ) : null}
          {canStockIn && product.tyreCondition === 'used' ? (
            <Link href="/stock/used-intake" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Add used unit
            </Link>
          ) : null}
        </section>
      ) : null}

      {access.role === 'admin' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Reorder thresholds</h2>
          <ReorderSettingsForm
            productId={product.id}
            rows={(['LON', 'REG'] as const).map((code) => {
              const row = summaryRows.find((r) => r.locationCode === code);
              return {
                locationCode: code,
                minimumStock: row?.minimumStock ?? 0,
                reorderQuantity: row?.reorderQuantity ?? 0,
              };
            })}
          />
        </section>
      ) : null}

      {product.tyreCondition === 'used' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Individually tracked units</h2>
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No individual units yet. Units are created with their intake stock movement.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {units.map((unit) => (
                <li key={unit.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <span className="font-medium">{unit.internal_unit_code}</span>
                  <span className="ml-2 text-muted-foreground">
                    {unit.locations?.code} · {unit.tread_depth_mm}mm · {unit.condition} · {unit.status}
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
