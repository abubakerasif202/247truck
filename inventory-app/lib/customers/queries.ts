import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerDetail, CustomerFilter, CustomerSummary } from './types';

export type CustomerListPage = { rows: CustomerSummary[]; total: number };

export async function listCustomersPage(
  client: SupabaseClient,
  query = '',
  filter: CustomerFilter = 'all',
  offset = 0,
  limit = 25,
): Promise<CustomerListPage> {
  const { data, error } = await client.rpc('search_customers', { p_query: query, p_filter: filter, p_limit: limit, p_offset: offset });
  if (error) throw new Error('Could not load customers.');
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    rows: rows.map((row): CustomerSummary => ({ id:String(row.id),customerNumber:String(row.customer_number),customerType:row.customer_type as CustomerSummary['customerType'],displayName:String(row.display_name),phone:row.phone ? String(row.phone):null,paymentTerms:row.payment_terms as CustomerSummary['paymentTerms'],active:Boolean(row.active),vehicleCount:Number(row.vehicle_count) })),
    total: rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0,
  };
}

/** Bounded top-N search for typeahead pickers (POS/sales) — not paginated by design. */
export async function listCustomers(client: SupabaseClient, query = '', filter: CustomerFilter = 'all') {
  const page = await listCustomersPage(client, query, filter, 0, 100);
  return page.rows;
}
export async function getCustomer(client: SupabaseClient,id:string) {
  const { data,error }=await client.rpc('get_customer',{p_customer_id:id});
  if(error) throw new Error('Could not load this customer.'); return data as CustomerDetail;
}
