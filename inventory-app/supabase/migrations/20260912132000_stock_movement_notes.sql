-- Persist optional operator notes while retaining the existing movement engine.
-- The wrapper serializes its idempotency check, binds every submitted field,
-- and delegates balance, valuation, used-unit, audit, and authorization rules to
-- the authoritative legacy RPC/private implementation.

alter table public.inventory_movements add column if not exists notes text;
alter table public.inventory_movements
  add constraint inventory_movements_notes_length_check
  check (notes is null or char_length(notes) <= 2000);

create or replace function private.capture_inventory_movement_notes()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_notes text := nullif(current_setting('app.inventory_movement_notes', true), '');
begin
  if v_notes is not null then new.notes := v_notes; end if;
  return new;
end;
$$;

create trigger inventory_movements_capture_notes
before insert on public.inventory_movements
for each row execute function private.capture_inventory_movement_notes();

revoke execute on function private.capture_inventory_movement_notes()
  from public, anon, authenticated, service_role;

create or replace function public.post_inventory_movement_with_notes(
  p_request_id uuid, p_product_id uuid, p_location_id uuid, p_quantity_delta integer,
  p_movement_type text, p_reason text default null, p_inbound_unit_cost numeric default null,
  p_used_tyre_unit_id uuid default null, p_source_type text default null,
  p_source_id text default null, p_supplier_name text default null, p_notes text default null
)
returns table (movement_id uuid, on_hand integer, reserved integer, available integer, weighted_average_cost numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.inventory_movements%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes,'')), '');
begin
  if v_actor is null or p_request_id is null then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'NOTES_TOO_LONG' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'inventory-movement-request:'||v_actor::text||':'||p_location_id::text||':'||p_request_id::text, 0
  ));
  select * into v_existing from public.inventory_movements
  where request_id=p_request_id and actor_user_id=v_actor and location_id=p_location_id;
  if found then
    perform private.assert_stock_authorization(p_location_id,p_movement_type);
    if v_existing.product_id <> p_product_id
      or v_existing.quantity_delta <> p_quantity_delta
      or v_existing.movement_type <> p_movement_type
      or v_existing.reason is distinct from nullif(btrim(coalesce(p_reason,'')), '')
      or v_existing.inbound_unit_cost is distinct from (case when p_quantity_delta > 0 then p_inbound_unit_cost else null end)
      or v_existing.used_tyre_unit_id is distinct from p_used_tyre_unit_id
      or v_existing.source_type is distinct from p_source_type
      or v_existing.source_id is distinct from p_source_id
      or v_existing.supplier_name is distinct from nullif(btrim(coalesce(p_supplier_name,'')), '')
      or v_existing.notes is distinct from v_notes
    then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023'; end if;
  end if;

  perform set_config('app.inventory_movement_notes', coalesce(v_notes,''), true);
  return query select * from public.post_inventory_movement(
    p_request_id,p_product_id,p_location_id,p_quantity_delta,p_movement_type,
    p_reason,p_inbound_unit_cost,p_used_tyre_unit_id,p_source_type,p_source_id,p_supplier_name
  );
end;
$$;

revoke execute on function public.post_inventory_movement_with_notes(uuid,uuid,uuid,integer,text,text,numeric,uuid,text,text,text,text)
  from public, anon, service_role;
grant execute on function public.post_inventory_movement_with_notes(uuid,uuid,uuid,integer,text,text,numeric,uuid,text,text,text,text)
  to authenticated;
