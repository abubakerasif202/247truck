import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomerDetail, CustomerFilter, CustomerSummary } from './types';

export async function listCustomers(client: SupabaseClient, query = '', filter: CustomerFilter = 'all') {
  const { data, error } = await client.rpc('search_customers', { p_query: query, p_filter: filter, p_limit: 100 });
  if (error) throw new Error('Could not load customers.');
  return (data ?? []).map((row: Record<string, unknown>): CustomerSummary => ({ id:String(row.id),customerNumber:String(row.customer_number),customerType:row.customer_type as CustomerSummary['customerType'],displayName:String(row.display_name),phone:row.phone ? String(row.phone):null,paymentTerms:row.payment_terms as CustomerSummary['paymentTerms'],active:Boolean(row.active),vehicleCount:Number(row.vehicle_count) }));
}
export async function getCustomer(client: SupabaseClient,id:string) {
  const { data,error }=await client.rpc('get_customer',{p_customer_id:id});
  if(error) throw new Error('Could not load this customer.'); return data as CustomerDetail;
}
