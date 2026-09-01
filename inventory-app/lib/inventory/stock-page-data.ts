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

export async function getStockFormContext(): Promise<StockFormContext> {
  const access = await getCurrentAccess();
  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();

  const [rows, locationsResult] = await Promise.all([
    searchInventory(supabase, access, { scope, includeArchived: false }),
    supabase.from('locations').select('id, code').returns<{ id: string; code: string }[]>(),
  ]);

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
