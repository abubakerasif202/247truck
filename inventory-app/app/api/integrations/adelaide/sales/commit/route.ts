import { NextResponse } from 'next/server';
import { commit, recordRequest } from '@/lib/integrations/adelaide-service';
import { commitRequestSchema } from '@/lib/integrations/adelaide-schema';
import { integrationError, signedJson } from '@/lib/integrations/adelaide-route';

export async function POST(request: Request) {
  try {
    const { signed, value } = await signedJson(request, commitRequestSchema);
    await recordRequest(signed, request);
    const sale = await commit(signed.clientId, value.reservationId, signed.requestId, signed.bodyHash, value.orderReference);
    return NextResponse.json(sale);
  } catch (error) { return integrationError(error, request.headers.get('x-awt-request-id') ?? undefined); }
}
