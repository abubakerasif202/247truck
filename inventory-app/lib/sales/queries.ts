import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { listCustomers } from '@/lib/customers/queries';
import type { LocationScope } from '@/lib/location/scope';

export async function listSalesCustomers(client: SupabaseClient, query = '') {
  return listCustomers(client, query, 'active');
}

export async function listSalesProducts(client: SupabaseClient, scope: LocationScope, query = '', locationId: string | null = null) {
  const { data, error } = await client.rpc('sales_product_search', { p_location_id: locationId, p_query: query, p_limit: 30 });
  if (error) throw new Error('Could not load sales products.');
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) if (!unique.has(String(row.product_id))) unique.set(String(row.product_id), row);
  return [...unique.values()].map(row => ({ productId: String(row.product_id), name: String(row.name), brandName: row.brand_name ? String(row.brand_name) : null, patternName: row.pattern_name ? String(row.pattern_name) : null, sizeName: row.size_name ? String(row.size_name) : null, tyreCondition: row.tyre_condition === 'used' ? 'used' as const : 'new' as const, sellingPriceInclGst: row.selling_price_incl_gst == null ? null : Number(row.selling_price_incl_gst), available: Number(row.available ?? 0), onHand: Number(row.on_hand ?? 0), reserved: Number(row.reserved ?? 0) }));
}

export async function listQuotes(client: SupabaseClient, locationId: string | null) {
  const { data, error } = await client.rpc('quote_summary', { p_location_id: locationId, p_limit: 100 });
  if (error) throw new Error('Could not load quotes.');
  return data ?? [];
}

export async function listJobs(client: SupabaseClient, locationId: string | null, status?: string, query = '') {
  const { data, error } = await client.rpc('job_summary', { p_location_id: locationId, p_status: status || null, p_query: query, p_limit: 100 });
  if (error) throw new Error('Could not load jobs.');
  return data ?? [];
}
