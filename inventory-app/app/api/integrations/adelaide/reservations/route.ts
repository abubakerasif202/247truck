import { NextResponse } from 'next/server';
import { reserve } from '@/lib/integrations/adelaide-service';
import { reservationIdempotencyHash } from '@/lib/integrations/adelaide-auth';
import { reserveRequestSchema } from '@/lib/integrations/adelaide-schema';
import { integrationError, signedJson } from '@/lib/integrations/adelaide-route';

export async function POST(request: Request) {
  try {
    const { signed, value } = await signedJson(request, reserveRequestSchema);
    const reservation = await reserve(signed.clientId, signed.requestId, reservationIdempotencyHash(value), value);
    return NextResponse.json(reservation, { status: 201 });
  } catch (error) { return integrationError(error); }
}
