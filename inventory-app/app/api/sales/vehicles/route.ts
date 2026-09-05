import { NextResponse } from 'next/server';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCustomer } from '@/lib/customers/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view') && !hasPermission(access, 'jobs.view') && !hasPermission(access, 'pos.use')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
  const customerId = new URL(request.url).searchParams.get('customer_id');
  if (!customerId) return NextResponse.json({ vehicles: [] });
  const customer = await getCustomer(await createServerSupabaseClient(), customerId);
  return NextResponse.json({ vehicles: customer.active ? customer.vehicles.filter(vehicle => vehicle.active).map(vehicle => ({ id: vehicle.id, registration: vehicle.registration, fleet_number: vehicle.fleet_number, vehicle_type: vehicle.vehicle_type, make: vehicle.make, model: vehicle.model })) : [] });
}
