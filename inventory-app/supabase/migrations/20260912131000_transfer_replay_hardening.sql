-- Bind transfer idempotency replays to the authorized actor and canonical input.
-- Historical dispatch actions can be safely matched from their stored columns.
-- Historical receipt actions cannot prove submitted quantities and require review.

alter table public.stock_transfer_actions
  add column if not exists request_fingerprint jsonb;

alter table public.stock_transfer_actions
  add constraint stock_transfer_actions_request_fingerprint_object_check
  check (request_fingerprint is null or jsonb_typeof(request_fingerprint) = 'object');

create or replace function public.dispatch_transfer(p_transfer_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.stock_transfers%rowtype;
  l record;
  b public.inventory_balances%rowtype;
  existing_action public.stock_transfer_actions%rowtype;
  fingerprint jsonb;
  result jsonb;
begin
  if p_transfer_id is null or p_request_id is null or (select auth.uid()) is null then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer-request:'||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer:'||p_transfer_id::text,0));

  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='P0002'; end if;
  if not (select private.transfer_operator_authorized(v.source_location_id)) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;

  fingerprint := jsonb_build_object('action','dispatch','transfer_id',p_transfer_id);
  select * into existing_action from public.stock_transfer_actions where request_id=p_request_id;
  if found then
    if existing_action.actor_user_id <> (select auth.uid())
      or existing_action.action <> 'dispatch'
      or existing_action.transfer_id <> p_transfer_id
      or (existing_action.request_fingerprint is not null and existing_action.request_fingerprint <> fingerprint)
    then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023';
    end if;
    return existing_action.result;
  end if;

  if v.status <> 'approved' then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  perform 1
  from public.inventory_balances balance
  join public.stock_transfer_lines line on line.product_id=balance.product_id and line.transfer_id=p_transfer_id
  where balance.location_id=v.source_location_id
  order by balance.product_id
  for update of balance;
  for l in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by product_id loop
    select * into b from public.inventory_balances where product_id=l.product_id and location_id=v.source_location_id for update;
    if not found or b.on_hand - b.reserved < l.approved_quantity then raise exception 'INSUFFICIENT_STOCK' using errcode='23514'; end if;
    update public.stock_transfer_lines set dispatched_quantity=approved_quantity, transfer_cost_snapshot=b.weighted_average_cost where id=l.id;
    insert into public.inventory_movements(request_id,product_id,location_id,quantity_delta,movement_type,reason,source_type,source_id,inbound_unit_cost,cost_snapshot,actor_user_id,transfer_id,transfer_line_id)
    values(p_request_id,l.product_id,v.source_location_id,-l.approved_quantity,'transfer_out','Branch stock transfer','stock_transfer',p_transfer_id::text,null,b.weighted_average_cost,auth.uid(),p_transfer_id,l.id);
    update public.inventory_balances set on_hand=on_hand-l.approved_quantity, updated_at=now() where product_id=l.product_id and location_id=v.source_location_id;
  end loop;
  update public.stock_transfers set status='in_transit', dispatched_by=auth.uid(), dispatched_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
  result := jsonb_build_object('transfer_id',p_transfer_id,'request_id',p_request_id,'status','in_transit');
  insert into public.stock_transfer_actions(request_id,transfer_id,action,actor_user_id,request_fingerprint,result)
  values(p_request_id,p_transfer_id,'dispatch',auth.uid(),fingerprint,result);
  perform private.transfer_audit(p_transfer_id,'TRANSFER_DISPATCHED','approved','in_transit',jsonb_build_object('request_id',p_request_id));
  return result;
end;
$$;

create or replace function public.receive_transfer(p_transfer_id uuid, p_request_id uuid, p_receipts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.stock_transfers%rowtype;
  l record;
  qty integer;
  b public.inventory_balances%rowtype;
  wac numeric(14,4);
  existing_action public.stock_transfer_actions%rowtype;
  canonical_receipts jsonb;
  fingerprint jsonb;
  result jsonb;
begin
  if p_transfer_id is null or p_request_id is null or (select auth.uid()) is null then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' then
    raise exception 'INVALID_RECEIPT_LINES' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_receipts) r
    where jsonb_typeof(r) <> 'object'
      or not (r ? 'product_id' and r ? 'received_quantity')
      or jsonb_typeof(r->'product_id') <> 'string'
      or jsonb_typeof(r->'received_quantity') <> 'number'
      or (r->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (r->>'received_quantity') !~ '^[0-9]+$'
      or (select count(*) from jsonb_object_keys(r)) <> 2
  ) then
    raise exception 'INVALID_RECEIPT_LINES' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_receipts) r
    group by (r->>'product_id')::uuid having count(*) > 1
  ) then
    raise exception 'DUPLICATE_RECEIPT_LINE' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer-request:'||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer:'||p_transfer_id::text,0));
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='P0002'; end if;
  if not (select private.transfer_operator_authorized(v.destination_location_id)) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_receipts) r
    left join public.stock_transfer_lines line
      on line.transfer_id=p_transfer_id and line.product_id=(r->>'product_id')::uuid
    where line.id is null
  ) or jsonb_array_length(p_receipts) <> (select count(*) from public.stock_transfer_lines where transfer_id=p_transfer_id) then
    raise exception 'UNKNOWN_OR_MISSING_RECEIPT_LINE' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', (r->>'product_id')::uuid,
    'received_quantity', (r->>'received_quantity')::integer
  ) order by (r->>'product_id')::uuid), '[]'::jsonb)
  into canonical_receipts from jsonb_array_elements(p_receipts) r;
  fingerprint := jsonb_build_object('action','receive','transfer_id',p_transfer_id,'receipts',canonical_receipts);

  select * into existing_action from public.stock_transfer_actions where request_id=p_request_id;
  if found then
    if existing_action.actor_user_id <> (select auth.uid())
      or existing_action.action <> 'receive'
      or existing_action.transfer_id <> p_transfer_id
    then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023'; end if;
    if existing_action.request_fingerprint is null then
      raise exception 'IDEMPOTENCY_RECONCILIATION_REQUIRED' using errcode='55000';
    end if;
    if existing_action.request_fingerprint <> fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023';
    end if;
    return existing_action.result;
  end if;

  if v.status <> 'in_transit' then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  perform 1
  from public.inventory_balances balance
  join public.stock_transfer_lines line on line.product_id=balance.product_id and line.transfer_id=p_transfer_id
  where balance.location_id=v.destination_location_id
  order by balance.product_id
  for update of balance;
  for l in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by product_id loop
    select (r->>'received_quantity')::integer into qty from jsonb_array_elements(canonical_receipts) r where (r->>'product_id')::uuid=l.product_id;
    if qty < 0 or qty > l.dispatched_quantity then raise exception 'OVER_RECEIPT' using errcode='22023'; end if;
    if qty > 0 then
      select * into b from public.inventory_balances where product_id=l.product_id and location_id=v.destination_location_id for update;
      wac := case when l.transfer_cost_snapshot is null or b.weighted_average_cost is null and b.on_hand > 0 then null
        when b.on_hand=0 then l.transfer_cost_snapshot
        else ((b.on_hand*b.weighted_average_cost)+(qty*l.transfer_cost_snapshot))/(b.on_hand+qty) end;
      insert into public.inventory_movements(request_id,product_id,location_id,quantity_delta,movement_type,reason,source_type,source_id,inbound_unit_cost,cost_snapshot,actor_user_id,transfer_id,transfer_line_id)
      values(p_request_id,l.product_id,v.destination_location_id,qty,'transfer_in','Branch stock transfer','stock_transfer',p_transfer_id::text,l.transfer_cost_snapshot,wac,auth.uid(),p_transfer_id,l.id);
      update public.inventory_balances set on_hand=on_hand+qty, weighted_average_cost=wac, updated_at=now() where product_id=l.product_id and location_id=v.destination_location_id;
    end if;
    update public.stock_transfer_lines set received_quantity=qty where id=l.id;
  end loop;
  if exists(select 1 from public.stock_transfer_lines where transfer_id=p_transfer_id and received_quantity <> dispatched_quantity) then
    update public.stock_transfers set status='review_required', discrepancy_notes='Received quantity differs from dispatched quantity', received_by=auth.uid(), received_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
    perform private.transfer_audit(p_transfer_id,'TRANSFER_RECEIVED','in_transit','review_required',jsonb_build_object('request_id',p_request_id));
    perform private.transfer_audit(p_transfer_id,'TRANSFER_DISCREPANCY_RECORDED','in_transit','review_required',jsonb_build_object('request_id',p_request_id));
  else
    update public.stock_transfers set status='completed', received_by=auth.uid(), received_at=now(), completed_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
    perform private.transfer_audit(p_transfer_id,'TRANSFER_RECEIVED','in_transit','completed',jsonb_build_object('request_id',p_request_id));
    perform private.transfer_audit(p_transfer_id,'TRANSFER_COMPLETED','in_transit','completed');
  end if;
  result := jsonb_build_object('transfer_id',p_transfer_id,'request_id',p_request_id,'status',(select status from public.stock_transfers where id=p_transfer_id));
  insert into public.stock_transfer_actions(request_id,transfer_id,action,actor_user_id,request_fingerprint,result)
  values(p_request_id,p_transfer_id,'receive',auth.uid(),fingerprint,result);
  return result;
end;
$$;

revoke execute on function public.dispatch_transfer(uuid,uuid) from public, anon, service_role;
grant execute on function public.dispatch_transfer(uuid,uuid) to authenticated;
revoke execute on function public.receive_transfer(uuid,uuid,jsonb) from public, anon, service_role;
grant execute on function public.receive_transfer(uuid,uuid,jsonb) to authenticated;
