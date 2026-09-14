-- One commit identity per paid Adelaide order, shared by the website worker
-- and 247's own paid-commit retry queue.
--
-- Before this migration the queue committed under an md5-derived request id
-- with sha256(order_reference) as its hash, while the website committed under
-- the request id it generated at checkout with the raw-body hash. Whichever
-- side ran second tripped IDEMPOTENCY_KEY_REUSED on an already-committed sale
-- and the website filed a successful sale as manual_review. Now the paid-state
-- handoff carries the website's durable commit request id and both sides hash
-- the same canonical value: sha256(lower(reservation_id) || E'\n' || order_reference).
-- Forward-only for ledger history. The one value refreshed is
-- adelaide_inventory_reservations.commit_request_hash on already-committed
-- holds: it is an idempotency token, not history, and without the refresh a
-- replay of an older commit under the canonical hash would be refused as
-- IDEMPOTENCY_KEY_REUSED and file a successful sale as manual_review.

-- PostgREST resolves RPC overloads by parameter names, so the old signature
-- must go rather than coexist with the new defaulted parameter.
drop function if exists public.register_adelaide_order_state(text, uuid, text, uuid, text, text, text);

create or replace function public.register_adelaide_order_state(
  p_client_id text, p_request_id uuid, p_request_hash text, p_reservation_id uuid,
  p_order_reference text, p_payment_status text, p_order_status text, p_commit_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reservation public.adelaide_inventory_reservations%rowtype; v_existing public.adelaide_order_inventory_commits%rowtype;
  v_state text; v_commit_request_id uuid;
begin
  if p_payment_status not in ('pending','paid','cancelled','refunded','disputed')
    or p_order_status not in ('pending','confirmed','cancelled','refunded','manual_review')
    or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_ORDER_STATE' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adelaide-reservation:' || p_reservation_id::text, 0));
  select * into v_reservation from public.adelaide_inventory_reservations
   where id = p_reservation_id and client_id = p_client_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_reservation.external_order_reference <> btrim(p_order_reference) then
    raise exception 'ORDER_REFERENCE_MISMATCH' using errcode = '22023'; end if;
  select * into v_existing from public.adelaide_order_inventory_commits
   where client_id = p_client_id and external_order_reference = btrim(p_order_reference) for update;
  if found and v_existing.state_request_id = p_request_id then
    if v_existing.state_request_hash <> p_request_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023'; end if;
    return to_jsonb(v_existing);
  end if;
  if found and v_existing.reservation_id <> p_reservation_id then raise exception 'ORDER_REFERENCE_MISMATCH' using errcode = '23505'; end if;
  if found and v_existing.payment_status='paid' and p_payment_status='pending' then
    raise exception 'INVALID_PAYMENT_REGRESSION' using errcode='23514'; end if;
  -- Identity precedence: a sale already committed under some id, then the
  -- durable id already recorded for this order, then the website's durable
  -- id, and only as a last resort a derived one. The effective id is returned
  -- (commit_request_id) and the website commits under it.
  v_commit_request_id := coalesce(v_reservation.commit_request_id, v_existing.commit_request_id, p_commit_request_id,
    pg_catalog.md5('adelaide-paid-commit:' || p_client_id || ':' || p_order_reference)::uuid);
  if p_payment_status = 'paid' then
    if v_reservation.status = 'committed' then v_state := 'committed';
    elsif v_reservation.status in ('released','expired') then v_state := 'manual_review'; else v_state := 'commit_pending'; end if;
    update public.adelaide_inventory_reservations set paid_protected_at = coalesce(paid_protected_at, now()), updated_at = now()
     where id = p_reservation_id;
  elsif p_order_status in ('cancelled','refunded') then v_state := case when v_reservation.status = 'committed' then 'manual_review' else 'release_pending' end;
  else v_state := case when v_reservation.status = 'active' then 'payment_pending' else v_reservation.status end;
  end if;
  insert into public.adelaide_order_inventory_commits(client_id, external_order_reference, reservation_id,
    payment_status, order_status, inventory_state, state_request_id, state_request_hash, commit_request_id, next_retry_at, committed_at)
  values (p_client_id, btrim(p_order_reference), p_reservation_id, p_payment_status, p_order_status, v_state,
    p_request_id, p_request_hash, v_commit_request_id, case when v_state = 'commit_pending' then now() end,
    case when v_state='committed' then coalesce(v_reservation.committed_at,now()) end)
  on conflict (client_id, external_order_reference) do update set
    payment_status = excluded.payment_status, order_status = excluded.order_status,
    inventory_state = case when public.adelaide_order_inventory_commits.inventory_state = 'committed' then 'committed' else excluded.inventory_state end,
    state_request_id = excluded.state_request_id, state_request_hash = excluded.state_request_hash,
    next_retry_at = case when public.adelaide_order_inventory_commits.inventory_state = 'committed' then null else excluded.next_retry_at end,
    committed_at = case when excluded.inventory_state='committed' then coalesce(public.adelaide_order_inventory_commits.committed_at,v_reservation.committed_at,now()) else public.adelaide_order_inventory_commits.committed_at end,
    updated_at = now()
  returning * into v_existing;
  perform private.adelaide_audit('ADELAIDE_ORDER_STATE_RECORDED', 'adelaide_order_inventory_commit', v_existing.id::text,
    v_reservation.location_id, p_client_id, jsonb_build_object('order_reference', p_order_reference,
    'payment_status', p_payment_status, 'order_status', p_order_status, 'inventory_state', v_existing.inventory_state,
    'request_id', p_request_id, 'commit_request_id', v_commit_request_id));
  return to_jsonb(v_existing);
end;
$$;

-- Canonical commit identity hash, shared with lib/integrations/adelaide-auth.ts.
create or replace function private.adelaide_commit_identity_hash(p_reservation_id uuid, p_order_reference text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(lower(p_reservation_id::text) || E'\n' || btrim(p_order_reference), 'UTF8'), 'sha256'), 'hex');
$$;
revoke execute on function private.adelaide_commit_identity_hash(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.commit_adelaide_inventory_sale(
  p_client_id text, p_reservation_id uuid, p_request_id uuid, p_request_hash text, p_order_reference text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reservation public.adelaide_inventory_reservations%rowtype; v_line record;
begin
  if nullif(btrim(p_client_id), '') is null or p_reservation_id is null or p_request_id is null
    or p_request_hash !~ '^[0-9a-f]{64}$' or nullif(btrim(p_order_reference), '') is null then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adelaide-reservation:' || p_reservation_id::text, 0));
  select * into v_reservation from public.adelaide_inventory_reservations
   where id=p_reservation_id and client_id=p_client_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_reservation.external_order_reference<>btrim(p_order_reference) then raise exception 'ORDER_REFERENCE_MISMATCH' using errcode='22023'; end if;
  if v_reservation.status='committed' then
    if v_reservation.commit_request_id<>p_request_id or v_reservation.commit_request_hash<>p_request_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023'; end if;
    return jsonb_build_object('reservation_id',v_reservation.id,'status','committed','order_reference',v_reservation.external_order_reference,'committed_at',v_reservation.committed_at);
  end if;
  if v_reservation.status<>'active' then raise exception 'RESERVATION_NOT_ACTIVE' using errcode='23514'; end if;
  if v_reservation.expires_at<=now() and v_reservation.paid_protected_at is null then
    v_reservation:=private.release_adelaide_reservation(v_reservation.id,'checkout_hold_expired',true);
    return jsonb_build_object('reservation_id',v_reservation.id,'status',v_reservation.status,'order_reference',v_reservation.external_order_reference);
  end if;
  -- Balance rows are locked in the same product order used by reserve/release.
  for v_line in select * from public.adelaide_inventory_reservation_lines
    where reservation_id=v_reservation.id order by inventory_product_id
  loop
    update public.inventory_balances set reserved=reserved-v_line.quantity,on_hand=on_hand-v_line.quantity,updated_at=now()
     where product_id=v_line.inventory_product_id and location_id=v_reservation.location_id
       and reserved>=v_line.quantity and on_hand>=v_line.quantity;
    if not found then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    insert into public.inventory_movements(request_id,product_id,location_id,quantity_delta,movement_type,reason,
      source_type,source_id,cost_snapshot,actor_user_id,actor_type,integration_client_id,external_reservation_id)
    values(pg_catalog.md5('adelaide-sale:'||v_reservation.id::text||':'||v_line.inventory_product_id::text)::uuid,
      v_line.inventory_product_id,v_reservation.location_id,-v_line.quantity,'stock_out',
      'Adelaide Wholesale Tyres sale '||v_reservation.external_order_reference,'adelaide_wholesale_tyres',
      v_reservation.external_order_reference,(select weighted_average_cost from public.inventory_balances
       where product_id=v_line.inventory_product_id and location_id=v_reservation.location_id),
      null,'integration',p_client_id,v_reservation.id);
  end loop;
  update public.adelaide_inventory_reservations set status='committed',commit_request_id=p_request_id,
    commit_request_hash=p_request_hash,committed_at=now(),updated_at=now() where id=v_reservation.id returning * into v_reservation;
  -- A direct website commit settles the durable paid record too, so health and
  -- reconciliation do not report a committed sale as awaiting commit until the
  -- next queue run.
  update public.adelaide_order_inventory_commits set inventory_state='committed', committed_at=coalesce(committed_at, v_reservation.committed_at),
    next_retry_at=null, last_error_code=null, updated_at=now()
   where client_id=p_client_id and reservation_id=v_reservation.id and inventory_state<>'committed';
  perform private.adelaide_audit('ADELAIDE_SALE_COMMITTED','adelaide_inventory_reservation',v_reservation.id::text,
    v_reservation.location_id,p_client_id,jsonb_build_object('order_reference',v_reservation.external_order_reference,'request_id',p_request_id));
  return jsonb_build_object('reservation_id',v_reservation.id,'status','committed','order_reference',v_reservation.external_order_reference,'committed_at',v_reservation.committed_at);
end;
$$;

create or replace function public.process_adelaide_commit_queue(p_client_id text, p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.adelaide_order_inventory_commits%rowtype; v_ok integer := 0; v_failed integer := 0; v_error text;
begin
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode = '22023'; end if;
  for v_job in select * from public.adelaide_order_inventory_commits
    where client_id = p_client_id and inventory_state = 'commit_pending' and coalesce(next_retry_at, now()) <= now()
    order by coalesce(next_retry_at, created_at), id for update skip locked limit p_limit
  loop
    begin
      update public.adelaide_order_inventory_commits set attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
       where id = v_job.id;
      perform public.commit_adelaide_inventory_sale(v_job.client_id, v_job.reservation_id, v_job.commit_request_id,
        private.adelaide_commit_identity_hash(v_job.reservation_id, v_job.external_order_reference), v_job.external_order_reference);
      update public.adelaide_order_inventory_commits set inventory_state = 'committed', committed_at = coalesce(committed_at, now()), next_retry_at = null,
        last_error_code = null, updated_at = now() where id = v_job.id;
      perform private.adelaide_audit('ADELAIDE_ORDER_INVENTORY_COMMITTED', 'adelaide_order_inventory_commit', v_job.id::text,
        null, v_job.client_id, jsonb_build_object('reservation_id', v_job.reservation_id, 'commit_request_id', v_job.commit_request_id));
      v_ok := v_ok + 1;
    exception when others then
      v_error := case when sqlerrm ~ '^[A-Z][A-Z0-9_]{2,60}$' then sqlerrm else 'INTEGRATION_DATABASE_ERROR' end;
      update public.adelaide_order_inventory_commits set
        attempt_count = attempt_count + 1,
        inventory_state = case when attempt_count + 1 >= 8 then 'manual_review' else 'commit_pending' end,
        last_error_code = v_error,
        next_retry_at = case when attempt_count + 1 >= 8 then null else now() + make_interval(secs => least(3600, 15 * power(2, least(attempt_count + 1, 8))::integer)) end,
        updated_at = now() where id = v_job.id;
      perform private.adelaide_audit('ADELAIDE_ORDER_COMMIT_FAILED', 'adelaide_order_inventory_commit', v_job.id::text,
        null, v_job.client_id, jsonb_build_object('reservation_id', v_job.reservation_id, 'error_code', v_error));
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('processed', v_ok + v_failed, 'committed', v_ok, 'failed', v_failed);
end;
$$;

-- Re-key every committed hold to the canonical identity hash so pre-existing
-- sales replay cleanly under the new protocol (see header).
update public.adelaide_inventory_reservations
   set commit_request_hash = private.adelaide_commit_identity_hash(id, external_order_reference), updated_at = now()
 where status = 'committed' and commit_request_hash is distinct from private.adelaide_commit_identity_hash(id, external_order_reference);

revoke execute on function public.register_adelaide_order_state(text,uuid,text,uuid,text,text,text,uuid),
  public.commit_adelaide_inventory_sale(text,uuid,uuid,text,text), public.process_adelaide_commit_queue(text,integer)
from public, anon, authenticated;
grant execute on function public.register_adelaide_order_state(text,uuid,text,uuid,text,text,text,uuid),
  public.commit_adelaide_inventory_sale(text,uuid,uuid,text,text), public.process_adelaide_commit_queue(text,integer)
to service_role;
