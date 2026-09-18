-- close_purchase_order was deliberately "safe by rejection" on retry (see
-- 20260919096000_purchase_order_short_close.sql's comment): a second call
-- after the PO is already 'closed' raises PO_CANNOT_CLOSE rather than
-- corrupting state or double-writing the audit event. That prevents
-- corruption, but it is not idempotent: a client that closes a PO, loses the
-- response (network drop, tab close, timeout), and retries the exact same
-- request sees an error for an operation that already succeeded, with no way
-- to distinguish "this reason was already applied" from "this PO can never
-- be closed". Every other purchase-order mutation with this shape
-- (receive_purchase_order, and create_job/complete_job in the jobs module)
-- threads a client-supplied p_request_id and replays the original result
-- verbatim on a repeat, so the caller need not special-case a lost response.
-- This migration brings close_purchase_order to the same standard, mirroring
-- complete_job's request-log pattern (advisory lock -> replay lookup ->
-- reused-key guard -> the original business logic, unchanged -> store result).
--
-- CREATE OR REPLACE cannot add a required parameter or change the return
-- type (void -> jsonb, needed so there is something to replay), so the old
-- signature is dropped first; its ACL (authenticated only, no anon/public/
-- service_role) is not inherited and is re-issued below.
drop function public.close_purchase_order(uuid, text);

create or replace function public.close_purchase_order(
  p_request_id uuid,
  p_purchase_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_po public.purchase_orders%rowtype;
  v_prior public.commercial_action_requests%rowtype;
  v_payload_hash text;
  v_result jsonb;
begin
  if p_request_id is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:' || p_request_id::text, 0));
  -- Hash the incoming payload before the replay lookup, exactly as
  -- create_job does, so a request_id reused for a genuinely different PO or
  -- reason is caught as IDEMPOTENCY_KEY_REUSED rather than blindly replaying
  -- an unrelated prior result -- complete_job's own replay lookup below (on
  -- request_id + action + actor only, no payload check) does not guard
  -- against that; this function does not repeat that gap.
  v_payload_hash := encode(extensions.digest(convert_to(coalesce(p_purchase_order_id::text, '') || ':' || coalesce(btrim(p_reason), ''), 'UTF8'), 'sha256'), 'hex');

  select * into v_prior from public.commercial_action_requests where request_id = p_request_id;
  if found then
    if v_prior.action = 'close_purchase_order' and v_prior.actor_user_id = v_actor and v_prior.payload_hash = v_payload_hash then
      return v_prior.result;
    end if;
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
  end if;

  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'CLOSE_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_po.status <> 'partially_received' then
    raise exception 'PO_CANNOT_CLOSE' using errcode = '55000';
  end if;

  update public.purchase_orders
  set status = 'closed',
      closed_at = now(),
      closed_by = v_actor,
      closed_reason = btrim(p_reason),
      updated_at = now()
  where id = p_purchase_order_id;

  perform private.audit_purchase_order(
    p_purchase_order_id,
    v_po.location_id,
    'PURCHASE_ORDER_CLOSED',
    jsonb_build_object('reason', btrim(p_reason))
  );

  v_result := jsonb_build_object('purchase_order_id', p_purchase_order_id, 'status', 'closed', 'closed_reason', btrim(p_reason));
  insert into public.commercial_action_requests (request_id, action, actor_user_id, entity_id, payload_hash, result)
  values (p_request_id, 'close_purchase_order', v_actor, p_purchase_order_id, v_payload_hash, v_result);

  return v_result;
end;
$$;

revoke execute on function public.close_purchase_order(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.close_purchase_order(uuid, uuid, text)
  to authenticated;
