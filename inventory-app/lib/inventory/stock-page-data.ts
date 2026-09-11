import 'server-only';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission, toAccessSnapshot, type AccessSnapshot } from '@/lib/auth/permissions';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { searchInventory, type InventorySummaryRow } from './queries';

export type StockFormContext = {
  access: AccessSnapshot;
  rows: InventorySummaryRow[];
  canViewCost: boolean;
  locationIds: Record<'LON' | 'REG', string>;
};

// The initial page shown before the user searches. Stock forms operate on a
// bounded picker, not the whole catalog, so this is capped well above any
// realistic branch product count while staying inside the RPC's 200-row max.
const INITIAL_STOCK_PRODUCTS = 200;

export async function getStockFormContext(): Promise<StockFormContext> {
  const access = await getCurrentAccess();
  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();

  const [page, locationsResult] = await Promise.all([
    searchInventory(supabase, access, {
      scope,
      includeArchived: false,
      limit: INITIAL_STOCK_PRODUCTS,
    }),
    supabase.from('locations').select('id, code').returns<{ id: string; code: string }[]>(),
  ]);
  const rows = page.rows;

  const locationIds = { LON: '', REG: '' };
  for (const row of locationsResult.data ?? []) {
    if (row.code === 'LON' || row.code === 'REG') {
      locationIds[row.code] = row.id;
    }
  }

  return {
    access: toAccessSnapshot(access),
    rows,
    canViewCost: hasPermission(access, 'inventory.view_cost'),
    locationIds,
  };
}
