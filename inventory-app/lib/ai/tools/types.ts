import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { UserAccessContext } from '@/lib/auth/types';
import type { LocationScope } from '@/lib/location/scope';

/**
 * Executes with the CURRENT authenticated user's own RLS-respecting
 * Supabase client and access context -- never a service-role client. Every
 * tool handler must call into lib/*\/queries.ts the same way the pages do
 * (see lib/ai/tools/index.ts) so permission checks and cost redaction are
 * never bypassed by the AI layer.
 */
export type AiToolContext = {
  supabase: SupabaseClient;
  access: UserAccessContext;
  /** The scope the assistant conversation is pinned to for this request
   * (an Admin's selected branch, or a Manager's fixed branch). Tools that
   * accept a location argument still re-validate it against this scope. */
  scope: LocationScope;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  /** Returns a compact, already-redacted JSON-serialisable result, or throws
   * a short user-facing message on failure (never a raw driver/DB error). */
  handler: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<unknown>;
};

/** Resolves an optional {location} tool argument against the caller's real
 * scope. A Manager's own branch always wins regardless of what the model
 * passes -- this is the same rule getCurrentScopeLocationId enforces for
 * page requests, applied identically here so the AI layer can never widen
 * a Manager's access. */
export function resolveToolScope(ctx: AiToolContext, requestedLocation: unknown): LocationScope {
  if (ctx.access.role === 'manager') return ctx.scope;
  if (requestedLocation === 'LON' || requestedLocation === 'REG') {
    return { kind: 'location', code: requestedLocation };
  }
  return { kind: 'all' };
}
