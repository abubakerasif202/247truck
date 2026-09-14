import { NextResponse } from 'next/server';

import { isValidCronRequest } from '@/lib/integrations/cron-auth';
import { integrationError } from '@/lib/integrations/adelaide-route';
import { health } from '@/lib/integrations/adelaide-service';

export async function GET(request: Request) {
  if (!isValidCronRequest(request)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const result = await health() as { status?: string };
    return NextResponse.json(result, { status: result?.status === 'ok' ? 200 : 503 });
  } catch (error) {
    return integrationError(error);
  }
}
