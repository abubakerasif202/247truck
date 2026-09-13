import { NextResponse } from 'next/server';
import { release, status } from '@/lib/integrations/adelaide-service';
import { releaseRequestSchema, uuid } from '@/lib/integrations/adelaide-schema';
import { integrationError, signedJson } from '@/lib/integrations/adelaide-route';

type ReservationContext = { params: Promise<{ reservationId: string }> };

export async function POST(request: Request, context: ReservationContext) {
  try {
    const { reservationId } = await context.params;
    const signed = await signedJson(request, releaseRequestSchema);
    uuid.parse(reservationId);
    return NextResponse.json(await status(signed.signed.clientId, reservationId));
  } catch (error) { return integrationError(error); }
}

export async function DELETE(request: Request, context: ReservationContext) {
  try {
    const { reservationId } = await context.params;
    uuid.parse(reservationId);
    const { signed, value } = await signedJson(request, releaseRequestSchema);
    return NextResponse.json(await release(signed.clientId, reservationId, signed.requestId, value.reason));
  } catch (error) { return integrationError(error); }
}
