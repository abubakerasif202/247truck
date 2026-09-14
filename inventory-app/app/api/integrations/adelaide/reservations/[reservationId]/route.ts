import { NextResponse } from 'next/server';
import { recordRequest, release, status } from '@/lib/integrations/adelaide-service';
import { releaseRequestSchema, uuid } from '@/lib/integrations/adelaide-schema';
import { integrationError, signedJson } from '@/lib/integrations/adelaide-route';

type ReservationContext = { params: Promise<{ reservationId: string }> };

export async function POST(request: Request, context: ReservationContext) {
  try {
    const { reservationId } = await context.params;
    const signed = await signedJson(request, releaseRequestSchema);
    await recordRequest(signed.signed, request);
    if (!uuid.safeParse(reservationId).success) throw new Error('INVALID_REQUEST');
    return NextResponse.json(await status(signed.signed.clientId, reservationId));
  } catch (error) { return integrationError(error, request.headers.get('x-awt-request-id') ?? undefined); }
}

export async function DELETE(request: Request, context: ReservationContext) {
  try {
    const { reservationId } = await context.params;
    if (!uuid.safeParse(reservationId).success) throw new Error('INVALID_REQUEST');
    const { signed, value } = await signedJson(request, releaseRequestSchema);
    await recordRequest(signed, request);
    return NextResponse.json(await release(signed.clientId, reservationId, signed.requestId, value.reason));
  } catch (error) { return integrationError(error, request.headers.get('x-awt-request-id') ?? undefined); }
}
