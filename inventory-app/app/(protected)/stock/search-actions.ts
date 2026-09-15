'use server';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { searchInventory, type InventorySummaryRow } from '@/lib/inventory/queries';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type StockSearchMode = 'in' | 'out' | 'adjust' | 'used-intake' | 'opening-stock';

const STOCK_SEARCH_LIMIT = 30;
const STOCK_SEARCH_MAX_TERM = 100;
const STOCK_SEARCH_MODES: readonly StockSearchMode[] = ['in', 'out', 'adjust', 'used-intake', 'opening-stock'];

/**
 * Server-side product search for the stock-form picker. Runs the same
 * paginated `inventory_summary_page` RPC used by the inventory list, so a
 * catalog with more than 1000 rows is still fully searchable rather than
 * limited to whatever page loaded initially.
 */
export async function searchStockProductsAction(
  term: string,
  mode: StockSearchMode,
  productId?: string,
): Promise<{ ok: true; rows: InventorySummaryRow[] } | { ok: false; error: string }> {
  if (typeof term !== 'string' || !STOCK_SEARCH_MODES.includes(mode)) {
    return { ok: false, error: 'Invalid product search.' };
  }
  const search = term.trim().slice(0, STOCK_SEARCH_MAX_TERM);
  try {
    const access = await getCurrentAccess();
    if (!hasPermission(access, 'inventory.view')) return { ok: false, error: 'Viewing stock requires the View stock permission.' };
    if (mode === 'opening-stock' && access.role !== 'admin') {
      return { ok: false, error: 'Only Admins can add opening stock.' };
    }
    const scope = await getCurrentLocationScope(access);
    const supabase = await createServerSupabaseClient();

    const page = await searchInventory(supabase, access, {
      scope: mode === 'opening-stock' ? { kind: 'all' } : scope,
      search,
      tyreCondition: mode === 'used-intake' ? 'used' : undefined,
      limit: STOCK_SEARCH_LIMIT,
      productId,
    });

    return { ok: true, rows: page.rows };
  } catch {
    return { ok: false, error: 'Could not search products.' };
  }
}
