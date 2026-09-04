import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  assignOpeningStockCostAction,
  setProductSellingPriceAction,
} from '@/app/(protected)/inventory/actions';
import { ArchiveToggle } from '@/components/inventory/archive-toggle';
import { AssignOpeningCostForm } from '@/components/inventory/assign-opening-cost-form';
import { ReorderSettingsForm } from '@/components/inventory/reorder-settings-form';
import { SetSellingPriceForm } from '@/components/inventory/set-selling-price-form';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { formatAud, formatAudOrPending, formatTyreMeta } from '@/lib/format';
import { listPendingOpeningCosts } from '@/lib/inventory/repository';
import { searchInventory } from '@/lib/inventory/queries';
import type { PendingOpeningCost } from '@/lib/inventory/types';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
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
  const canViewCost = hasPermission(access, 'inventory.view_cost');
  const canEditPrice = hasPermission(access, 'inventory.edit_global_price');

  let pendingOpeningCosts: PendingOpeningCost[] = [];
  let regHasUnvaluedStock = false;
  if (access.role === 'admin') {
    const allRows =
      scope.kind === 'all'
        ? summaryRows
        : await searchInventory(supabase, access, {
            scope: { kind: 'all' },
            productId,
            includeArchived: true,
          });
    const regRow = allRows.find((row) => row.locationCode === 'REG');
    regHasUnvaluedStock = Boolean(
      regRow && regRow.onHand > 0 && regRow.weightedAverageCost == null,
    );

    const { data: regLocation } = await supabase
      .from('locations')
      .select('id')
      .eq('code', 'REG')
      .maybeSingle<{ id: string }>();

    if (regLocation) {
      pendingOpeningCosts = await listPendingOpeningCosts(
        supabase,
        productId,
        regLocation.id,
      );
    }
  }

  const sellingPriceAction = setProductSellingPriceAction.bind(null, product.id);
  const openingCostAction = assignOpeningStockCostAction.bind(null, product.id);

  return (
    <div className="operations-page max-w-4xl domain-inventory">
      <Link href="/inventory" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
        ← Inventory
      </Link>

      <PageHeader
        domain="inventory"
        eyebrow="Product record"
        title={product.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {PRODUCT_CATEGORY_LABELS[product.categoryCode]}
            <StatusBadge status={product.active ? 'active' : 'inactive'}>
              {product.active ? 'Active' : 'Archived'}
            </StatusBadge>
            {product.tyreCondition ? (
              <StatusBadge status={`${product.tyreCondition}_tyre`}>
                {product.tyreCondition === 'used' ? 'Used tyre' : 'New tyre'}
              </StatusBadge>
            ) : null}
          </span>
        }
        actions={access.role === 'admin' ? (
          <ArchiveToggle productId={product.id} active={product.active} />
        ) : null}
      />

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Selling price (GST incl.)</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span>{formatAudOrPending(product.sellingPriceInclGst)}</span>
            {product.sellingPriceInclGst == null ? (
              <StatusBadge tone="warning">Selling price pending</StatusBadge>
            ) : null}
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

      {regHasUnvaluedStock ? (
        <div className="operations-panel border-l-4 border-l-warning p-4">
          <StatusBadge tone="warning">Opening cost pending</StatusBadge>
          <p className="mt-2 text-sm text-muted-foreground">
            Positive Regency Park opening stock exists without a confirmed cost. It is excluded from known inventory value until cost is assigned.
          </p>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Stock by branch</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {summaryRows.map((row) => (
            <li
              key={row.locationCode}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <span>{row.locationName}</span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span>{row.available} available</span>
                {row.lowStock ? <StatusBadge status="low stock">Low stock</StatusBadge> : null}
                {canViewCost && row.onHand > 0 && row.weightedAverageCost == null ? (
                  <StatusBadge tone="warning">Opening cost pending</StatusBadge>
                ) : null}
                {canViewCost && row.weightedAverageCost != null ? (
                  <span>WAC {formatAud(row.weightedAverageCost)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canEditPrice ? (
        <SetSellingPriceForm
          currentPrice={product.sellingPriceInclGst}
          action={sellingPriceAction}
        />
      ) : null}

      {access.role === 'admin' && pendingOpeningCosts.length > 0 ? (
        <AssignOpeningCostForm pending={pendingOpeningCosts} action={openingCostAction} />
      ) : null}

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
              const row = summaryRows.find((item) => item.locationCode === code);
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
