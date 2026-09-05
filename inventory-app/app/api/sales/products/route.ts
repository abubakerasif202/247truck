import { NextResponse } from 'next/server';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listSalesProducts } from '@/lib/sales/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view') && !hasPermission(access, 'jobs.view') && !hasPermission(access, 'pos.use')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) return NextResponse.json({ products: [] });
  const client = await createServerSupabaseClient();
  const requestedLocation = new URL(request.url).searchParams.get('location_id');
  const locationId = access.role === 'manager' ? access.locationId : requestedLocation;
  if (!locationId) return NextResponse.json({ error: 'LOCATION_REQUIRED' }, { status: 400 });
  return NextResponse.json({ products: await listSalesProducts(client, { kind: 'location', code: access.locationCode ?? 'LON' }, query, locationId) });
}
