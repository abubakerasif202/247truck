import 'server-only';

import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { integrationLocationId } from './adelaide-auth';

function message(error: { message?: string } | null): never {
  throw new Error(error?.message ?? 'INTEGRATION_DATABASE_ERROR');
}

export async function availability(clientId: string, mappingIds: string[]) {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('adelaide_inventory_availability', {
    p_client_id: clientId,
    p_location_id: integrationLocationId(),
    p_mapping_ids: mappingIds,
  });
  if (error) message(error);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    inventoryMappingId: String(row.mapping_id),
    onHand: Number(row.on_hand),
    reserved: Number(row.reserved),
    available: Number(row.available),
    updatedAt: String(row.updated_at),
  }));
}

export async function reserve(clientId: string, requestId: string, bodyHash: string, input: { orderReference: string; expiresAt: string; items: { inventoryMappingId: string; quantity: number }[] }) {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('reserve_adelaide_inventory', {
    p_client_id: clientId,
    p_request_id: requestId,
    p_request_hash: bodyHash,
    p_order_reference: input.orderReference,
    p_location_id: integrationLocationId(),
    p_expires_at: input.expiresAt,
    p_lines: input.items.map((item) => ({ mapping_id: item.inventoryMappingId, quantity: item.quantity })),
  });
  if (error) message(error);
  return data;
}

export async function release(clientId: string, reservationId: string, requestId: string, reason?: string) {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('release_adelaide_inventory_reservation', {
    p_client_id: clientId, p_reservation_id: reservationId, p_request_id: requestId, p_reason: reason ?? null,
  });
  if (error) message(error);
  return data;
}

export async function commit(clientId: string, reservationId: string, requestId: string, bodyHash: string, orderReference: string) {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('commit_adelaide_inventory_sale', {
    p_client_id: clientId, p_reservation_id: reservationId, p_request_id: requestId, p_request_hash: bodyHash,
    p_order_reference: orderReference,
  });
  if (error) message(error);
  // The RPC expires a stale hold durably and reports it; only a committed
  // result is a successful sale.
  const status = (data as { status?: string } | null)?.status;
  if (status !== 'committed') throw new Error(status === 'expired' ? 'RESERVATION_EXPIRED' : 'RESERVATION_NOT_ACTIVE');
  return data;
}

export async function status(clientId: string, reservationId: string) {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('adelaide_inventory_reservation_status', {
    p_client_id: clientId, p_reservation_id: reservationId,
  });
  if (error) message(error);
  return data;
}

export async function expire(clientId: string) {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('expire_adelaide_inventory_reservations', { p_client_id: clientId });
  if (error) message(error);
  return Number(data ?? 0);
}

export async function recordRequest(identity: { clientId: string; requestId: string; bodyHash: string }, request: Request) {
  const client = createServiceSupabaseClient();
  const { error } = await client.rpc('record_adelaide_integration_request', {
    p_client_id: identity.clientId,
    p_request_id: identity.requestId,
    p_method: request.method,
    p_pathname: new URL(request.url).pathname,
    p_body_hash: identity.bodyHash,
  });
  if (error) message(error);
}

export async function recordOrderState(clientId: string, requestId: string, bodyHash: string, input: {
  reservationId: string;
  orderReference: string;
  paymentStatus: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'disputed';
  orderStatus: 'pending' | 'confirmed' | 'cancelled' | 'refunded' | 'manual_review';
}) {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('register_adelaide_order_state', {
    p_client_id: clientId,
    p_request_id: requestId,
    p_request_hash: bodyHash,
    p_reservation_id: input.reservationId,
    p_order_reference: input.orderReference,
    p_payment_status: input.paymentStatus,
    p_order_status: input.orderStatus,
  });
  if (error) message(error);
  return data;
}

export async function runOperation(clientId: string, operation: 'expiry' | 'commit_retry' | 'reconciliation') {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('run_adelaide_operation', { p_client_id: clientId, p_operation: operation });
  if (error) message(error);
  return data;
}

export async function health() {
  const client = createServiceSupabaseClient();
  const { data, error } = await client.rpc('adelaide_integration_health');
  if (error) message(error);
  return data;
}
