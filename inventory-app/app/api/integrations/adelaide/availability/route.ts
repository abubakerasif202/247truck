import { NextResponse } from 'next/server';
import { availability, recordRequest } from '@/lib/integrations/adelaide-service';
import { availabilityRequestSchema } from '@/lib/integrations/adelaide-schema';
import { integrationError, signedJson } from '@/lib/integrations/adelaide-route';

export async function POST(request: Request) {
  try {
    const { signed, value } = await signedJson(request, availabilityRequestSchema);
    await recordRequest(signed, request);
    const items = await availability(signed.clientId, value.items.map((item) => item.inventoryMappingId));
    return NextResponse.json({ items });
  } catch (error) { return integrationError(error, request.headers.get('x-awt-request-id') ?? undefined); }
}
