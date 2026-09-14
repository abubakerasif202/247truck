import { NextResponse } from 'next/server';
import { commit, recordRequest } from '@/lib/integrations/adelaide-service';
import { commitIdempotencyHash } from '@/lib/integrations/adelaide-auth';
import { commitRequestSchema } from '@/lib/integrations/adelaide-schema';
import { integrationError, signedJson } from '@/lib/integrations/adelaide-route';

export async function POST(request: Request) {
  try {
    const { signed, value } = await signedJson(request, commitRequestSchema);
    await recordRequest(signed, request);
    // The sale identity is canonical (reservation + order), not the raw bytes,
    // so 247's own paid-commit queue and the website worker share one key.
    const sale = await commit(signed.clientId, value.reservationId, signed.requestId, commitIdempotencyHash(value), value.orderReference);
    return NextResponse.json(sale);
  } catch (error) { return integrationError(error, request.headers.get('x-awt-request-id') ?? undefined); }
}
