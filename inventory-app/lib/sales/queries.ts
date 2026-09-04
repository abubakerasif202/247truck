import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { listCustomers } from '@/lib/customers/queries';
import type { UserAccessContext } from '@/lib/auth/types';
import { searchInventory } from '@/lib/inventory/queries';
import type { LocationScope } from '@/lib/location/scope';

export async function listSalesCustomers(client: SupabaseClient, query = '') {
  return listCustomers(client, query, 'active');
}

export async function listSalesProducts(client: SupabaseClient, access: UserAccessContext, scope: LocationScope, query = '') {
  return searchInventory(client, access, { scope, search: query, includeArchived: false });
}

export async function listQuotes(client: SupabaseClient, locationId: string | null) {
  const { data, error } = await client.rpc('quote_summary', { p_location_id: locationId, p_limit: 100 });
  if (error) throw new Error('Could not load quotes.');
  return data ?? [];
}

