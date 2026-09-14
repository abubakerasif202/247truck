import { NextResponse } from 'next/server';

import { integrationError, signedJson } from '@/lib/integrations/adelaide-route';
import { orderStateRequestSchema } from '@/lib/integrations/adelaide-schema';
import { recordOrderState, recordRequest } from '@/lib/integrations/adelaide-service';

export async function POST(request: Request) {
  const requestId = request.headers.get('x-awt-request-id') ?? undefined;
  try {
    const { signed, value } = await signedJson(request, orderStateRequestSchema);
    await recordRequest(signed, request);
    const result = await recordOrderState(signed.clientId, signed.requestId, signed.bodyHash, value);
    return NextResponse.json(result, { headers: { 'x-request-id': signed.requestId } });
  } catch (error) {
    return integrationError(error, requestId);
  }
}
