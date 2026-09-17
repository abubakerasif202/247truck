import { NextResponse } from 'next/server';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getPosBusinessOptions } from '@/lib/finance/queries';

// Uses the strict pos_business_options RPC, not the general
// invoice_brand_options one: POS authorization must never fall back to a
// location-code default the way manual/job invoice creation still can.
export async function GET(request: Request) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'pos.use')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
  const requestedLocation = new URL(request.url).searchParams.get('location_id');
  const locationId = access.role === 'manager' ? access.locationId : requestedLocation;
  if (!locationId) return NextResponse.json({ error: 'LOCATION_REQUIRED' }, { status: 400 });
  const options = await getPosBusinessOptions(locationId);
  if (!options) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
  return NextResponse.json({
    defaultBrand: options.default_brand,
    canOverride: options.can_override,
    businesses: options.businesses.map((business) => ({ brand: business.brand, businessName: business.business_name })),
  });
}
