import { NextResponse } from 'next/server';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getInvoiceBrandOptions } from '@/lib/finance/queries';

// General (legacy-fallback-aware) invoice brand options for manual invoice
// creation - distinct from /api/sales/business-options, which is the
// strict, POS-only variant with no location-code fallback.
export async function GET(request: Request) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.view')) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
  const requestedLocation = new URL(request.url).searchParams.get('location_id');
  const locationId = access.role === 'manager' ? access.locationId : requestedLocation;
  if (!locationId) return NextResponse.json({ error: 'LOCATION_REQUIRED' }, { status: 400 });
  const options = await getInvoiceBrandOptions(locationId);
  if (!options) return NextResponse.json({ error: 'ACCESS_DENIED' }, { status: 403 });
  return NextResponse.json(options);
}
