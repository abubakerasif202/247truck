-- Phase 5: Ask 24/7 usage telemetry.
--
-- Operational logging only -- token counts, cost estimate, tool names, and
-- timing for each Ask 24/7 request. Never stores prompt/response text
-- (spec: no full prompts, no unnecessary customer PII) or any credential.
-- Writes go through log_ai_usage() (SECURITY DEFINER), the same
-- RPC-mediated-write pattern audit_events already uses -- there is no direct
-- INSERT policy, so a client can only ever log its own request as itself.

create table public.ai_usage_log (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  estimated_cost_usd numeric(10, 6) not null default 0 check (estimated_cost_usd >= 0),
  tool_names text[] not null default '{}',
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  success boolean not null,
  error_code text
);

create index ai_usage_log_created_at_idx on public.ai_usage_log (created_at desc);
create index ai_usage_log_user_id_idx on public.ai_usage_log (user_id);

alter table public.ai_usage_log enable row level security;

-- Admin-only visibility: usage/cost telemetry is an operational concern, not
-- something every manager needs to browse. No policy exists for
-- insert/update/delete -- log_ai_usage() (SECURITY DEFINER) is the only path.
create policy ai_usage_log_select_access
on public.ai_usage_log
for select
to authenticated
using ((select private.app_is_admin()));

-- An RLS policy alone is not reachable without the underlying table grant --
-- default privileges for a newly created table carry no SELECT/INSERT for
-- authenticated (see 20260919097000_lock_down_default_privileges.sql), so
-- this grant is what actually lets the policy above be evaluated at all.
-- Matches the identical audit_events_select_access + grant select pairing in
-- 20260902090000_identity_access.sql. No insert/update/delete grant: writes
-- only ever happen through log_ai_usage(), which runs as the function owner
-- and so needs no table-level grant of its own.
revoke all on public.ai_usage_log from public, anon, service_role;
grant select on public.ai_usage_log to authenticated;

create or replace function public.log_ai_usage(
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_estimated_cost_usd numeric,
  p_tool_names text[],
  p_duration_ms integer,
  p_success boolean,
  p_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  -- Defense in depth: the application layer only ever adds a name from its
  -- fixed tool registry (see lib/ai/assistant.ts isKnownAiTool), but this
  -- RPC is the actual trust boundary, so it does not assume that held.
  -- Bounded to the first 20 entries, each truncated to 100 chars, so this
  -- column can never become an unbounded or oversized payload regardless of
  -- what a caller passes.
  v_tool_names text[] := (
    select coalesce(array_agg(left(name, 100)), '{}')
    from unnest(coalesce(p_tool_names, '{}')) as name
    limit 20
  );
begin
  if v_actor is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_model is null or btrim(p_model) = '' then
    raise exception 'INVALID_USAGE_LOG' using errcode = '22023';
  end if;

  insert into public.ai_usage_log (
    user_id, model, input_tokens, output_tokens, cached_input_tokens,
    estimated_cost_usd, tool_names, duration_ms, success, error_code
  )
  values (
    v_actor, left(p_model, 100), greatest(0, coalesce(p_input_tokens, 0)), greatest(0, coalesce(p_output_tokens, 0)),
    p_cached_input_tokens, greatest(0, coalesce(p_estimated_cost_usd, 0)),
    v_tool_names, p_duration_ms, p_success,
    -- Bounded: never let an upstream error message become an unbounded blob.
    left(p_error_code, 200)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.log_ai_usage(text, integer, integer, integer, numeric, text[], integer, boolean, text)
  from public, anon, service_role;
grant execute on function public.log_ai_usage(text, integer, integer, integer, numeric, text[], integer, boolean, text)
  to authenticated;
