import { NextResponse } from 'next/server';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view') && !hasPermission(access, 'jobs.view') && !hasPermission(access, 'pos.use')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const productId = params.get('product_id');
  const requestedLocation = params.get('location_id');
  const locationId = access.role === 'manager' ? access.locationId : requestedLocation;
  if (!productId || !locationId) return NextResponse.json({ units: [] });
  const { data, error } = await (await createServerSupabaseClient()).rpc('sales_used_tyre_unit_search', { p_product_id: productId, p_location_id: locationId, p_query: params.get('q')?.trim() ?? '', p_limit: 20 });
  if (error) return NextResponse.json({ error: 'USED_TYRE_SEARCH_FAILED' }, { status: 400 });
  return NextResponse.json({ units: data ?? [] });
}
