-- Phase 2B: branch-to-branch stock transfers.
-- All state changes are database-authoritative and append-only.

alter table public.manager_permissions
  drop constraint if exists manager_permissions_permission_key_check;
alter table public.manager_permissions
  add constraint manager_permissions_permission_key_check check (
    permission_key in (
      'inventory.view', 'inventory.stock_in', 'inventory.stock_out',
      'inventory.adjust', 'inventory.view_cost', 'inventory.edit_global_price',
      'inventory.transfer_request', 'reports.view_inventory_value',
      'purchasing.view', 'purchasing.create_po', 'purchasing.submit_po',
      'purchasing.receive_po'
    )
  );

create table public.stock_transfers (
  id uuid primary key default extensions.gen_random_uuid(),
  transfer_number text not null unique,
  source_location_id uuid not null references public.locations(id),
  destination_location_id uuid not null references public.locations(id),
  status text not null default 'draft',
  notes text,
  requested_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  rejected_by uuid references auth.users(id),
  dispatched_by uuid references auth.users(id),
  received_by uuid references auth.users(id),
  discrepancy_resolved_by uuid references auth.users(id),
  rejection_reason text,
  discrepancy_notes text,
  requested_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint stock_transfers_distinct_locations check (source_location_id <> destination_location_id),
  constraint stock_transfers_status_check check (status in (
    'draft', 'requested', 'approved', 'dispatched', 'in_transit',
    'received', 'completed', 'rejected', 'cancelled', 'review_required'
  ))
);

create table public.stock_transfer_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id),
  requested_quantity integer not null check (requested_quantity > 0),
  approved_quantity integer not null check (approved_quantity > 0),
  dispatched_quantity integer not null default 0 check (dispatched_quantity >= 0),
  received_quantity integer not null default 0 check (received_quantity >= 0),
  transfer_cost_snapshot numeric(14,4),
  notes text,
  unique (transfer_id, product_id),
  constraint stock_transfer_lines_received_lte_dispatched check (received_quantity <= dispatched_quantity),
  constraint stock_transfer_lines_dispatched_lte_approved check (dispatched_quantity <= approved_quantity)
);

create table public.stock_transfer_actions (
  request_id uuid primary key,
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  action text not null check (action in ('dispatch', 'receive')),
  actor_user_id uuid not null references auth.users(id),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index stock_transfer_actions_transfer_action_key
  on public.stock_transfer_actions(transfer_id, action);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (movement_type in (
    'quick_stock_in', 'stock_out', 'adjustment', 'used_unit_in', 'used_unit_out',
    'purchase_receipt', 'opening_stock', 'transfer_out', 'transfer_in'
  ));
alter table public.inventory_movements
  drop constraint if exists inventory_movements_direction_check;
alter table public.inventory_movements
  add constraint inventory_movements_direction_check check (
    (movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt', 'opening_stock', 'transfer_in') and quantity_delta > 0)
    or (movement_type in ('stock_out', 'used_unit_out', 'transfer_out') and quantity_delta < 0)
    or movement_type = 'adjustment'
  );
alter table public.inventory_movements
  add column if not exists transfer_id uuid references public.stock_transfers(id),
  add column if not exists transfer_line_id uuid references public.stock_transfer_lines(id);
create index inventory_movements_transfer_line_idx on public.inventory_movements(transfer_line_id);

-- A transfer action intentionally writes one movement per line under one
-- operation request UUID. Preserve the original idempotency contract for all
-- ordinary movements and scope transfer uniqueness to each immutable line.
drop index if exists public.inventory_movements_actor_location_request_id_key;
create unique index inventory_movements_actor_location_request_id_key
  on public.inventory_movements(actor_user_id, location_id, request_id)
  where movement_type not in ('transfer_out', 'transfer_in');
create unique index inventory_transfer_movements_request_line_key
  on public.inventory_movements(actor_user_id, location_id, request_id, transfer_line_id, movement_type)
  where movement_type in ('transfer_out', 'transfer_in');

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_transfer_actions enable row level security;
revoke all on public.stock_transfers, public.stock_transfer_lines, public.stock_transfer_actions from public, anon, authenticated, service_role;
grant select on public.stock_transfers, public.stock_transfer_lines to service_role;

create or replace function private.transfer_actor_role()
returns text language sql stable security definer set search_path = '' as $$
  select profile.role from public.user_profiles profile
  where profile.user_id = (select auth.uid()) and profile.active;
$$;
revoke execute on function private.transfer_actor_role() from public, anon, authenticated, service_role;

create or replace function private.transfer_authorized(
  p_source uuid, p_destination uuid
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v_location uuid;
begin
  select role, location_id into v_role, v_location from public.user_profiles
  where user_id = (select auth.uid()) and active;
  if v_role = 'admin' then return true; end if;
  if v_role <> 'manager' or not (select private.app_has_permission('inventory.transfer_request')) then return false; end if;
  -- A Manager may be an endpoint, but the source branch is never accepted
  -- from an unrelated branch and all writes are limited to requests.
  return v_location = p_source or v_location = p_destination;
end;
$$;
revoke execute on function private.transfer_authorized(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.transfer_operator_authorized(p_location_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return (select private.app_is_admin())
    or ((select private.app_user_location_id()) = p_location_id
      and (select private.app_has_permission('inventory.transfer_request')));
end;
$$;
revoke execute on function private.transfer_operator_authorized(uuid) from public, anon, authenticated, service_role;

create or replace function private.transfer_audit(
  p_transfer_id uuid, p_event text, p_before text, p_after text, p_details jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_role text; v_lines jsonb;
begin
  select role into v_role from public.user_profiles where user_id = v_actor and active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'transfer_line_id', line.id,
    'product_id', line.product_id,
    'requested_quantity', line.requested_quantity,
    'approved_quantity', line.approved_quantity,
    'dispatched_quantity', line.dispatched_quantity,
    'received_quantity', line.received_quantity,
    'transfer_cost_snapshot', case when private.app_has_permission('inventory.view_cost') then line.transfer_cost_snapshot end
  ) order by line.id), '[]'::jsonb)
  into v_lines
  from public.stock_transfer_lines line
  where line.transfer_id = p_transfer_id;
  insert into public.audit_events(actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details)
  select v_actor, v_role, t.source_location_id, p_event, 'stock_transfer', t.id::text,
    p_details || jsonb_build_object('transfer_number', t.transfer_number, 'source_location_id', t.source_location_id,
      'destination_location_id', t.destination_location_id, 'status_before', p_before, 'status_after', p_after,
      'lines', v_lines)
  from public.stock_transfers t where t.id = p_transfer_id;
end;
$$;
revoke execute on function private.transfer_audit(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.create_transfer_request(
  p_source_location_id uuid, p_destination_location_id uuid, p_notes text default null, p_lines jsonb default '[]'::jsonb
)
returns text language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_id uuid; v_number text; v_line jsonb;
begin
  if v_actor is null or not (select private.transfer_authorized(p_source_location_id, p_destination_location_id)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_source_location_id is null or p_destination_location_id is null or p_source_location_id = p_destination_location_id then raise exception 'INVALID_LOCATIONS' using errcode='22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'TRANSFER_LINES_REQUIRED' using errcode='22023'; end if;
  v_number := private.next_location_document_number(p_source_location_id, 'stock_transfer', 'TRF');
  insert into public.stock_transfers(transfer_number, source_location_id, destination_location_id, status, notes, requested_by)
  values(v_number, p_source_location_id, p_destination_location_id, 'draft', nullif(btrim(p_notes), ''), v_actor) returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'product_id')::uuid is null or coalesce((v_line->>'requested_quantity')::integer, 0) <= 0 then raise exception 'INVALID_TRANSFER_LINE' using errcode='22023'; end if;
    insert into public.stock_transfer_lines(transfer_id, product_id, requested_quantity, approved_quantity)
    values(v_id, (v_line->>'product_id')::uuid, (v_line->>'requested_quantity')::integer, (v_line->>'requested_quantity')::integer);
  end loop;
  perform private.transfer_audit(v_id, 'TRANSFER_CREATED', null, 'draft', jsonb_build_object('requested_by', v_actor));
  return v_number;
end;
$$;

create or replace function public.submit_transfer_request(p_transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found or not (select private.transfer_authorized(v.source_location_id, v.destination_location_id)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if v.status <> 'draft' or (select private.transfer_actor_role()) = 'manager' and v.requested_by <> (select auth.uid()) then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  update public.stock_transfers set status='requested', requested_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
  perform private.transfer_audit(p_transfer_id, 'TRANSFER_REQUESTED', 'draft', 'requested');
end;
$$;

create or replace function public.update_transfer_request(p_transfer_id uuid, p_notes text, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v record; line jsonb;
begin
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found or not (select private.transfer_authorized(v.source_location_id,v.destination_location_id)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if v.status <> 'draft' or ((select private.transfer_actor_role())='manager' and v.requested_by <> (select auth.uid())) then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'TRANSFER_LINES_REQUIRED' using errcode='22023'; end if;
  delete from public.stock_transfer_lines where transfer_id=p_transfer_id;
  for line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((line->>'requested_quantity')::integer,0)<=0 then raise exception 'INVALID_TRANSFER_LINE' using errcode='22023'; end if;
    insert into public.stock_transfer_lines(transfer_id,product_id,requested_quantity,approved_quantity)
    values(p_transfer_id,(line->>'product_id')::uuid,(line->>'requested_quantity')::integer,(line->>'requested_quantity')::integer);
  end loop;
  update public.stock_transfers set notes=nullif(btrim(p_notes),''),updated_at=now(),version=version+1 where id=p_transfer_id;
  perform private.transfer_audit(p_transfer_id,'TRANSFER_UPDATED','draft','draft');
end;
$$;

create or replace function public.approve_transfer(p_transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if not (select private.app_is_admin()) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found or v.status <> 'requested' then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  update public.stock_transfers set status='approved', approved_by=auth.uid(), approved_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
  perform private.transfer_audit(p_transfer_id, 'TRANSFER_APPROVED', 'requested', 'approved');
end;
$$;

create or replace function public.reject_transfer(p_transfer_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if not (select private.app_is_admin()) or btrim(coalesce(p_reason,''))='' then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found or v.status <> 'requested' then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  update public.stock_transfers set status='rejected', rejected_by=auth.uid(), rejected_at=now(), rejection_reason=btrim(p_reason), updated_at=now(), version=version+1 where id=p_transfer_id;
  perform private.transfer_audit(p_transfer_id, 'TRANSFER_REJECTED', 'requested', 'rejected', jsonb_build_object('reason',btrim(p_reason)));
end;
$$;

create or replace function public.cancel_transfer(p_transfer_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found or not (select private.app_is_admin()) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if v.status not in ('draft','requested','approved') then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  update public.stock_transfers set status='cancelled', cancelled_at=now(), notes=coalesce(notes, '') || case when p_reason is null then '' else ' '||btrim(p_reason) end, updated_at=now(), version=version+1 where id=p_transfer_id;
  perform private.transfer_audit(p_transfer_id, 'TRANSFER_CANCELLED', v.status, 'cancelled');
end;
$$;

create or replace function public.dispatch_transfer(p_transfer_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v record; l record; b public.inventory_balances%rowtype; result jsonb := '{}'::jsonb;
begin
  if p_request_id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer-request:'||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer:'||p_transfer_id::text,0));
  select a.result into result from public.stock_transfer_actions a where a.request_id=p_request_id and a.action='dispatch' and a.transfer_id=p_transfer_id;
  if result is not null then return result; end if;
  if exists(select 1 from public.stock_transfer_actions where request_id=p_request_id) then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023'; end if;
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='P0002'; end if;
  if not (select private.transfer_operator_authorized(v.source_location_id)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
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
  insert into public.stock_transfer_actions(request_id,transfer_id,action,actor_user_id,result) values(p_request_id,p_transfer_id,'dispatch',auth.uid(),result);
  perform private.transfer_audit(p_transfer_id,'TRANSFER_DISPATCHED','approved','in_transit',jsonb_build_object('request_id',p_request_id));
  return result;
end;
$$;

create or replace function public.receive_transfer(p_transfer_id uuid, p_request_id uuid, p_receipts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v record; l record; r jsonb; qty integer; b public.inventory_balances%rowtype; wac numeric(14,4); result jsonb := '{}'::jsonb;
begin
  if p_request_id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer-request:'||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer:'||p_transfer_id::text,0));
  select a.result into result from public.stock_transfer_actions a where a.request_id=p_request_id and a.action='receive' and a.transfer_id=p_transfer_id;
  if result is not null then return result; end if;
  if exists(select 1 from public.stock_transfer_actions where request_id=p_request_id) then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023'; end if;
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='P0002'; end if;
  if not (select private.transfer_operator_authorized(v.destination_location_id)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if v.status <> 'in_transit' then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  perform 1
  from public.inventory_balances balance
  join public.stock_transfer_lines line on line.product_id=balance.product_id and line.transfer_id=p_transfer_id
  where balance.location_id=v.destination_location_id
  order by balance.product_id
  for update of balance;
  for l in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by product_id loop
    r := (select x from jsonb_array_elements(p_receipts) x where (x->>'product_id')::uuid=l.product_id limit 1);
    qty := coalesce((r->>'received_quantity')::integer,0);
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
  insert into public.stock_transfer_actions(request_id,transfer_id,action,actor_user_id,result) values(p_request_id,p_transfer_id,'receive',auth.uid(),result);
  return result;
end;
$$;

create or replace function public.resolve_transfer_discrepancy(p_transfer_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if not (select private.app_is_admin()) or btrim(coalesce(p_notes,''))='' then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found or v.status <> 'review_required' then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  update public.stock_transfers set status='completed', discrepancy_resolved_by=auth.uid(), discrepancy_notes=btrim(p_notes), completed_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
  perform private.transfer_audit(p_transfer_id,'TRANSFER_DISCREPANCY_RESOLVED','review_required','completed',jsonb_build_object('reason',btrim(p_notes)));
  perform private.transfer_audit(p_transfer_id,'TRANSFER_COMPLETED','review_required','completed');
end;
$$;

create or replace function public.transfer_summary(p_status text default null)
returns table(id uuid, transfer_number text, source_code text, destination_code text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.app_has_permission('inventory.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  return query select t.id,t.transfer_number,s.code,d.code,t.status,t.created_at from public.stock_transfers t
    join public.locations s on s.id=t.source_location_id join public.locations d on d.id=t.destination_location_id
    where ((select private.app_is_admin()) or t.source_location_id=(select private.app_user_location_id()) or t.destination_location_id=(select private.app_user_location_id()))
    and (p_status is null or t.status=p_status) order by t.created_at desc;
end;
$$;

create or replace function public.transfer_location_options()
returns table(id uuid, code text, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.app_has_permission('inventory.transfer_request')) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  return query select location.id,location.code,location.name
  from public.locations location where location.active and location.code in ('LON','REG')
  order by location.code;
end;
$$;

create or replace function public.transfer_detail(p_transfer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v record; lines jsonb;
begin
  if not (select private.app_has_permission('inventory.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select t.*,s.code source_code,s.name source_name,d.code destination_code,d.name destination_name into v
  from public.stock_transfers t join public.locations s on s.id=t.source_location_id join public.locations d on d.id=t.destination_location_id where t.id=p_transfer_id
    and ((select private.app_is_admin()) or t.source_location_id=(select private.app_user_location_id()) or t.destination_location_id=(select private.app_user_location_id()));
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'product_name',p.name,'requested_quantity',l.requested_quantity,'approved_quantity',l.approved_quantity,'dispatched_quantity',l.dispatched_quantity,'received_quantity',l.received_quantity,'transfer_cost_snapshot',case when private.app_has_permission('inventory.view_cost') then l.transfer_cost_snapshot end) order by p.name), '[]'::jsonb) into lines from public.stock_transfer_lines l join public.products p on p.id=l.product_id where l.transfer_id=p_transfer_id;
  return to_jsonb(v) || jsonb_build_object(
    'lines',lines,
    'activity',(
      select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'event_type',a.event_type,'actor_role',a.actor_role,'created_at',a.created_at,'details',a.details) order by a.created_at,a.id),'[]'::jsonb)
      from public.audit_events a where a.entity_type='stock_transfer' and a.entity_id=p_transfer_id::text
    )
  );
end;
$$;

revoke execute on function public.create_transfer_request(uuid,uuid,text,jsonb), public.update_transfer_request(uuid,text,jsonb), public.submit_transfer_request(uuid), public.approve_transfer(uuid), public.reject_transfer(uuid,text), public.cancel_transfer(uuid,text), public.dispatch_transfer(uuid,uuid), public.receive_transfer(uuid,uuid,jsonb), public.resolve_transfer_discrepancy(uuid,text), public.transfer_summary(text), public.transfer_location_options(), public.transfer_detail(uuid) from public, anon, service_role;
grant execute on function public.create_transfer_request(uuid,uuid,text,jsonb), public.update_transfer_request(uuid,text,jsonb), public.submit_transfer_request(uuid), public.approve_transfer(uuid), public.reject_transfer(uuid,text), public.cancel_transfer(uuid,text), public.dispatch_transfer(uuid,uuid), public.receive_transfer(uuid,uuid,jsonb), public.resolve_transfer_discrepancy(uuid,text), public.transfer_summary(text), public.transfer_location_options(), public.transfer_detail(uuid) to authenticated;

-- Extend chronological WAC replay. A transfer-in cost is resolved from the
-- source branch at dispatch time, so assigning opening cost later can rebuild
-- downstream balances without rewriting immutable movements.
create or replace function private.replay_wac_at(
  p_product_id uuid,
  p_location_id uuid,
  p_until timestamptz default null,
  p_before_movement_id uuid default null
)
returns numeric language plpgsql security definer set search_path = '' as $$
declare m record; q integer:=0; before_q integer; w numeric(14,4):=0; c numeric(14,4);
begin
  for m in
    select im.*, osa.unit_cost assigned_cost
    from public.inventory_movements im
    left join public.opening_stock_cost_assignments osa on osa.opening_movement_id=im.id
    where im.product_id=p_product_id and im.location_id=p_location_id
      and (p_until is null or im.created_at < p_until
        or (im.created_at=p_until and (p_before_movement_id is null or im.id < p_before_movement_id)))
    order by im.created_at,im.id
  loop
    before_q:=q; q:=q+m.quantity_delta; if q<0 then raise exception 'WAC_REPLAY_NEGATIVE_STOCK' using errcode='23514'; end if;
    if m.movement_type in ('quick_stock_in','used_unit_in','purchase_receipt','opening_stock','transfer_in') then
      c:=case
        when m.movement_type='opening_stock' then coalesce(m.inbound_unit_cost,m.assigned_cost)
        when m.movement_type='transfer_in' then coalesce(
          m.inbound_unit_cost,
          (select private.replay_wac_at(m.product_id, tr.source_location_id, outm.created_at, outm.id)
           from public.stock_transfer_lines tl
           join public.stock_transfers tr on tr.id=tl.transfer_id
           join public.inventory_movements outm on outm.transfer_line_id=tl.id and outm.movement_type='transfer_out'
           where tl.id=m.transfer_line_id)
        )
        else m.inbound_unit_cost
      end;
      if c is null then w:=null; elsif before_q=0 then w:=c; elsif w is not null then w:=((before_q*w)+(m.quantity_delta*c))/q; end if;
    end if;
    if q=0 then w:=0; end if;
  end loop; return w;
end;
$$;
revoke execute on function private.replay_wac_at(uuid,uuid,timestamptz,uuid) from public, anon, authenticated, service_role;

create or replace function private.rebuild_current_wac(p_product_id uuid,p_location_id uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  perform 1 from public.inventory_balances where product_id=p_product_id and location_id=p_location_id for update;
  if not found then raise exception 'BALANCE_NOT_FOUND' using errcode='P0002'; end if;
  v:=private.replay_wac_at(p_product_id,p_location_id,null,null);
  update public.inventory_balances set weighted_average_cost=v,updated_at=now() where product_id=p_product_id and location_id=p_location_id;
  return v;
end;
$$;
revoke execute on function private.rebuild_current_wac(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function private.rebuild_product_wac(p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  for b in select location_id from public.inventory_balances where product_id=p_product_id order by location_id loop
    perform private.rebuild_current_wac(p_product_id,b.location_id);
  end loop;
end;
$$;
revoke execute on function private.rebuild_product_wac(uuid) from public, anon, authenticated, service_role;

-- Re-state the Admin-only assignment endpoint so a newly assigned opening cost
-- rebuilds every location that may contain descendants of that opening stock.
create or replace function public.assign_opening_stock_cost(p_opening_movement_id uuid,p_unit_cost numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare a uuid := (select auth.uid()); m public.inventory_movements%rowtype;
begin
  if a is null or not (select private.app_is_admin()) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'INVALID_COST' using errcode='22023'; end if;
  select * into m from public.inventory_movements where id=p_opening_movement_id for update;
  if not found then raise exception 'MOVEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if m.movement_type <> 'opening_stock' then raise exception 'NOT_OPENING_STOCK' using errcode='22023'; end if;
  if m.inbound_unit_cost is not null or exists(select 1 from public.opening_stock_cost_assignments where opening_movement_id=p_opening_movement_id) then raise exception 'OPENING_COST_ALREADY_ASSIGNED' using errcode='23505'; end if;
  insert into public.opening_stock_cost_assignments(opening_movement_id,unit_cost,assigned_by) values(p_opening_movement_id,p_unit_cost,a);
  perform private.rebuild_product_wac(m.product_id);
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(a,'admin',m.location_id,'OPENING_STOCK_COST_ASSIGNED','inventory_movement',m.id::text,jsonb_build_object('product_id',m.product_id,'opening_movement_id',m.id,'unit_cost',p_unit_cost,'quantity',m.quantity_delta));
end;
$$;
revoke execute on function public.assign_opening_stock_cost(uuid,numeric) from public, anon, service_role;
grant execute on function public.assign_opening_stock_cost(uuid,numeric) to authenticated;
