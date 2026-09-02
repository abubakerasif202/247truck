import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerSupabaseClient } from '@/lib/supabase/server';

export type AuditEventInput = {
  eventType: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  locationId?: string | null;
};

/**
 * Records a business audit event through the `public.app_audit_event` RPC, which
 * derives the actor from the session and enforces the append-only contract.
 * Never throws into the caller's happy path — a failed audit write is logged and
 * swallowed so it cannot mask the primary result, but callers doing
 * security-sensitive work should check the return value.
 */
export async function recordAuditEvent(
  input: AuditEventInput,
  client?: SupabaseClient,
): Promise<{ ok: boolean }> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { error } = await supabase.rpc('app_audit_event', {
    p_event_type: input.eventType,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_details: input.details ?? {},
    p_location_id: input.locationId ?? null,
  });

  if (error) {
    console.error('[audit] failed to record event', input.eventType, error.message);
    return { ok: false };
  }

  return { ok: true };
}
