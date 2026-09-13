import { NextResponse } from 'next/server';
import { expire } from '@/lib/integrations/adelaide-service';
import { integrationError } from '@/lib/integrations/adelaide-route';

/** Vercel Cron calls this endpoint; it has no browser-facing capability. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const clientId = process.env.AWT_INVENTORY_CLIENT_ID;
    if (!clientId) throw new Error('INTEGRATION_UNAVAILABLE');
    return NextResponse.json({ expired: await expire(clientId) });
  } catch (error) { return integrationError(error); }
}
