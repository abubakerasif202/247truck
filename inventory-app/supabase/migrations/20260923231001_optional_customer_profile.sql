-- Customer identity requires only a display name. Keep existing rows and documents intact.
alter table public.customers
  alter column suburb drop not null,
  alter column state drop not null,
  alter column postcode drop not null;

alter table public.customers drop constraint customers_type_fields_check;

create or replace function private.customer_validate(p jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  t text := pg_catalog.lower(private.customer_text(p->>'customer_type'));
  d text := private.customer_text(p->>'display_name');
  term text := pg_catalog.lower(coalesce(private.customer_text(p->>'payment_terms'),'due_on_receipt'));
begin
  if t not in ('individual','business') then raise exception 'INVALID_CUSTOMER_TYPE' using errcode='22023'; end if;
  if d is null then raise exception 'CUSTOMER_NAME_REQUIRED' using errcode='22023'; end if;
  if term not in ('due_on_receipt','7_days','14_days','30_days') then raise exception 'INVALID_PAYMENT_TERMS' using errcode='22023'; end if;
  return p || jsonb_build_object('customer_type',t,'display_name',d,'payment_terms',term);
end;
$$;
revoke execute on function private.customer_validate(jsonb) from public,anon,authenticated,service_role;

-- A vehicle can be recorded before a registration is known. The parent customer
-- does not need a vehicle at all.
alter table public.customer_vehicles
  alter column registration drop not null,
  alter column registration_normalized drop not null;
alter table public.customer_vehicles
  drop constraint customer_vehicles_registration_check,
  drop constraint customer_vehicles_registration_normalized_check;

create or replace function public.add_customer_vehicle(p_customer_id uuid,p_vehicle jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare id uuid; t text:=lower(private.customer_text(p_vehicle->>'vehicle_type')); reg text:=private.customer_text(p_vehicle->>'registration');
begin
  if not (select private.customer_permission('customers.manage_vehicles')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if t not in ('truck','trailer','other') then raise exception 'INVALID_VEHICLE_TYPE' using errcode='22023'; end if;
  if not exists(select 1 from public.customers where customers.id=p_customer_id) then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.customer_vehicles(customer_id,vehicle_type,registration,registration_normalized,fleet_number,fleet_number_normalized,make,model,year,vin,body_description,axle_configuration_notes,tyre_notes,notes,created_by)
  values(p_customer_id,t,upper(reg),private.customer_vehicle_key(reg),private.customer_text(p_vehicle->>'fleet_number'),lower(private.customer_text(p_vehicle->>'fleet_number')),private.customer_text(p_vehicle->>'make'),private.customer_text(p_vehicle->>'model'),(p_vehicle->>'year')::integer,private.customer_text(p_vehicle->>'vin'),private.customer_text(p_vehicle->>'body_description'),private.customer_text(p_vehicle->>'axle_configuration_notes'),private.customer_text(p_vehicle->>'tyre_notes'),private.customer_text(p_vehicle->>'notes'),auth.uid()) returning customer_vehicles.id into id;
  perform private.customer_audit('CUSTOMER_VEHICLE_CREATED','customer_vehicle',id,jsonb_build_object('customer_id',p_customer_id,'vehicle_type',t,'registration',upper(reg))); return jsonb_build_object('vehicle_id',id);
end;
$$;

create or replace function public.update_customer_vehicle(p_vehicle_id uuid,p_vehicle jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.customer_vehicles%rowtype; t text; reg text; v integer;
begin
  if not (select private.customer_permission('customers.manage_vehicles')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into old from public.customer_vehicles where id=p_vehicle_id for update;
  if not found then raise exception 'VEHICLE_NOT_FOUND' using errcode='P0002'; end if;
  t:=coalesce(lower(private.customer_text(p_vehicle->>'vehicle_type')),old.vehicle_type); reg:=case when p_vehicle?'registration' then private.customer_text(p_vehicle->>'registration') else old.registration end;
  if t not in ('truck','trailer','other') then raise exception 'INVALID_VEHICLE_TYPE' using errcode='22023'; end if;
  update public.customer_vehicles set vehicle_type=t,registration=upper(reg),registration_normalized=private.customer_vehicle_key(reg),fleet_number=case when p_vehicle?'fleet_number' then private.customer_text(p_vehicle->>'fleet_number') else old.fleet_number end,fleet_number_normalized=case when p_vehicle?'fleet_number' then lower(private.customer_text(p_vehicle->>'fleet_number')) else old.fleet_number_normalized end,make=case when p_vehicle?'make' then private.customer_text(p_vehicle->>'make') else old.make end,model=case when p_vehicle?'model' then private.customer_text(p_vehicle->>'model') else old.model end,year=case when p_vehicle?'year' then (p_vehicle->>'year')::integer else old.year end,vin=case when p_vehicle?'vin' then private.customer_text(p_vehicle->>'vin') else old.vin end,body_description=case when p_vehicle?'body_description' then private.customer_text(p_vehicle->>'body_description') else old.body_description end,axle_configuration_notes=case when p_vehicle?'axle_configuration_notes' then private.customer_text(p_vehicle->>'axle_configuration_notes') else old.axle_configuration_notes end,tyre_notes=case when p_vehicle?'tyre_notes' then private.customer_text(p_vehicle->>'tyre_notes') else old.tyre_notes end,notes=case when p_vehicle?'notes' then private.customer_text(p_vehicle->>'notes') else old.notes end,version=version+1 where id=p_vehicle_id returning version into v;
  perform private.customer_audit('CUSTOMER_VEHICLE_UPDATED','customer_vehicle',p_vehicle_id,jsonb_build_object('customer_id',old.customer_id,'version_before',old.version,'version_after',v)); return jsonb_build_object('vehicle_id',p_vehicle_id,'version',v);
end;
$$;

revoke execute on function public.add_customer_vehicle(uuid,jsonb),public.update_customer_vehicle(uuid,jsonb) from public,anon,service_role;
grant execute on function public.add_customer_vehicle(uuid,jsonb),public.update_customer_vehicle(uuid,jsonb) to authenticated;
