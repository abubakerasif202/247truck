import { NextResponse } from 'next/server';

import { isValidCronRequest } from '@/lib/integrations/cron-auth';
import { integrationError } from '@/lib/integrations/adelaide-route';
import { runOperation } from '@/lib/integrations/adelaide-service';

export async function GET(request: Request) {
  if (!isValidCronRequest(request)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const clientId = process.env.AWT_INVENTORY_CLIENT_ID;
    if (!clientId) throw new Error('INTEGRATION_UNAVAILABLE');
    return NextResponse.json(await runOperation(clientId, 'commit_retry'));
  } catch (error) {
    return integrationError(error);
  }
}
