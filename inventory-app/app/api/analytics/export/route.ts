import { NextResponse } from 'next/server';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';
import { resolveLocationScope } from '@/lib/location/scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { listReorderSuggestions } from '@/lib/purchasing/queries';
import {
  getInventoryByBrand,
  getInventoryBySize,
  getSlowMovingProducts,
  getStockMovementSummary,
} from '@/lib/analytics/queries';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/analytics/csv';
import type { InventoryDistributionRow, SlowMovingWindow } from '@/lib/analytics/types';
import type { ReorderSuggestion } from '@/lib/purchasing/types';

const EXPORT_TYPES = ['replenishment', 'slow-moving', 'brand', 'size', 'movement'] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

function isExportType(value: string | null): value is ExportType {
  return !!value && (EXPORT_TYPES as readonly string[]).includes(value);
}

const DISTRIBUTION_COLUMNS: CsvColumn<InventoryDistributionRow>[] = [
  { header: 'Group', value: (r) => r.groupLabel },
  { header: 'Product count', value: (r) => r.productCount },
  { header: 'On hand', value: (r) => r.onHand },
  { header: 'Available', value: (r) => r.available },
  { header: 'Low stock count', value: (r) => r.lowStockCount },
  { header: 'Known inventory value (AUD)', value: (r) => r.knownInventoryValue },
];

const REPLENISHMENT_COLUMNS: CsvColumn<ReorderSuggestion>[] = [
  { header: 'Product', value: (r) => r.productName },
  { header: 'Branch', value: (r) => r.locationCode },
  { header: 'Available', value: (r) => r.available },
  { header: 'On order', value: (r) => r.onOrder },
  { header: 'Minimum stock', value: (r) => r.minimumStock },
  { header: 'Remaining shortage', value: (r) => Math.max(0, r.minimumStock - r.available - r.onOrder) },
  { header: 'Preferred supplier', value: (r) => r.preferredSupplierName },
];

/**
 * CSV export for the read-only reports the Analytics page and Replenishment
 * preview render. Every branch here reuses the exact same permission-checked
 * query functions the page calls (never a raw RPC or service-role client),
 * so filters, location scope, and cost redaction are identical to what the
 * requesting user already sees on screen -- an export can never leak more
 * than the page it's exported from.
 */
export async function GET(request: Request) {
  const access = await getCurrentAccess();
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  if (!isExportType(type)) {
    return NextResponse.json({ error: 'INVALID_EXPORT_TYPE' }, { status: 400 });
  }

  const requestedLocation = access.role === 'admin' ? (url.searchParams.get('location') ?? 'ALL') : null;
  const scope = access.role === 'admin' ? resolveLocationScope(access, requestedLocation) : await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();

  let csv: string;
  let filenameParts: (string | number)[];

  try {
    switch (type) {
    case 'replenishment': {
      if (!hasPermission(access, 'purchasing.view')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
      const locationId = await getCurrentScopeLocationId(access, scope);
      const rows = await listReorderSuggestions(supabase, locationId);
      csv = toCsv(rows, REPLENISHMENT_COLUMNS);
      filenameParts = ['replenishment', scope.kind === 'location' ? scope.code : 'all-locations'];
      break;
    }
    case 'slow-moving': {
      if (!hasPermission(access, 'inventory.view')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
      const window = (Number(url.searchParams.get('window')) || 90) as SlowMovingWindow;
      const rows = await getSlowMovingProducts(supabase, scope, [30, 60, 90].includes(window) ? window : 90);
      csv = toCsv(rows, [
        { header: 'Product', value: (r) => r.productName },
        { header: 'Brand', value: (r) => r.brandName },
        { header: 'Size', value: (r) => r.sizeName },
        { header: 'Branch', value: (r) => r.locationCode },
        { header: 'On hand', value: (r) => r.onHand },
        { header: 'Last outward movement', value: (r) => r.lastOutwardMovementAt },
        { header: 'Days since last movement', value: (r) => r.daysSinceLastMovement },
        { header: 'Never moved', value: (r) => r.neverMoved },
      ]);
      filenameParts = ['slow-moving', scope.kind === 'location' ? scope.code : 'all-locations'];
      break;
    }
    case 'brand': {
      if (!hasPermission(access, 'inventory.view')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
      const rows = await getInventoryByBrand(supabase, access, scope);
      csv = toCsv(rows, DISTRIBUTION_COLUMNS);
      filenameParts = ['inventory-by-brand', scope.kind === 'location' ? scope.code : 'all-locations'];
      break;
    }
    case 'size': {
      if (!hasPermission(access, 'inventory.view')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
      const rows = await getInventoryBySize(supabase, access, scope);
      csv = toCsv(rows, DISTRIBUTION_COLUMNS);
      filenameParts = ['inventory-by-size', scope.kind === 'location' ? scope.code : 'all-locations'];
      break;
    }
    case 'movement': {
      if (!hasPermission(access, 'inventory.view')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
      const days = Number(url.searchParams.get('days')) || 30;
      const summary = await getStockMovementSummary(supabase, scope, [7, 30, 90].includes(days) ? (days as 7 | 30 | 90) : 30);
      csv = toCsv(summary.buckets, [
        { header: 'Movement type', value: (r) => r.movementType },
        { header: 'Movement count', value: (r) => r.movementCount },
        { header: 'Total quantity', value: (r) => r.totalQuantity },
      ]);
      filenameParts = ['movement', summary.periodDays, scope.kind === 'location' ? scope.code : 'all-locations'];
      break;
    }
    }
  } catch (error) {
    console.error('[analytics] export failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'EXPORT_FAILED' }, { status: 500 });
  }

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(filenameParts)}"`,
    },
  });
}
