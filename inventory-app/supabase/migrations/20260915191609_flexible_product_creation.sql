-- Flexible, workspace-owned product creation. Historical products remain
-- shared (owner_location_id NULL); new UI-created products belong to the
-- authenticated Admin's active workspace and start with zero stock there.
alter table public.products alter column category_code drop not null;
alter table public.products drop constraint if exists products_truck_tyre_requirements_check;
alter table public.products drop constraint if exists products_tyre_condition_consistency_check;
alter table public.products add column if not exists owner_location_id uuid references public.locations(id) on delete restrict;
create index if not exists products_owner_location_idx on public.products(owner_location_id,id);

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (
  private.app_is_admin() or owner_location_id is null or owner_location_id=private.app_user_location_id()
);

create or replace function private.seed_inventory_settings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.inventory_settings(product_id,location_id)
  select new.id,l.id from public.locations l where new.owner_location_id is null or l.id=new.owner_location_id
  on conflict(product_id,location_id) do nothing;
  return new;
end;
$$;

create or replace function private.seed_inventory_balances()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.inventory_balances(product_id,location_id)
  select new.id,l.id from public.locations l where new.owner_location_id is null or l.id=new.owner_location_id
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.create_workspace_product(
  p_location_id uuid,
  p_name text,
  p_retail_price_incl_gst numeric,
  p_category_code text default null,
  p_wholesale_price_incl_gst numeric default null,
  p_part_reference text default null,
  p_notes text default null,
  p_tyre_condition text default null,
  p_tyre_brand text default null,
  p_tyre_pattern text default null,
  p_tyre_size text default null,
  p_load_index text default null,
  p_speed_rating text default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); brand_id uuid; pattern_id uuid; size_id uuid; product_id uuid;
begin
  if not private.app_is_admin() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and active) then raise exception 'INVALID_PRODUCT_WORKSPACE' using errcode='22023'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'PRODUCT_NAME_REQUIRED' using errcode='22023'; end if;
  if p_retail_price_incl_gst is null or p_retail_price_incl_gst<0 then raise exception 'RETAIL_PRICE_REQUIRED' using errcode='22023'; end if;
  if p_wholesale_price_incl_gst is not null and p_wholesale_price_incl_gst<0 then raise exception 'INVALID_PRICE' using errcode='22023'; end if;
  if p_category_code is not null and not exists(select 1 from public.product_categories where code=p_category_code) then raise exception 'INVALID_PRODUCT_CATEGORY' using errcode='22023'; end if;
  if p_tyre_condition is not null and p_tyre_condition not in ('new','used') then raise exception 'INVALID_TYRE_CONDITION' using errcode='22023'; end if;
  if nullif(btrim(p_tyre_brand),'') is not null then brand_id:=private.upsert_tyre_brand(p_tyre_brand); end if;
  if brand_id is not null and nullif(btrim(p_tyre_pattern),'') is not null then pattern_id:=private.upsert_tyre_pattern(brand_id,p_tyre_pattern); end if;
  if nullif(btrim(p_tyre_size),'') is not null then size_id:=private.upsert_tyre_size(p_tyre_size); end if;
  insert into public.products(name,category_code,part_reference,selling_price_incl_gst,retail_price_incl_gst,wholesale_price_incl_gst,
    notes,tyre_condition,tyre_brand_id,tyre_pattern_id,tyre_size_id,load_index,speed_rating,owner_location_id,created_by)
  values(btrim(p_name),nullif(btrim(p_category_code),''),nullif(btrim(p_part_reference),''),p_retail_price_incl_gst,p_retail_price_incl_gst,p_wholesale_price_incl_gst,
    nullif(btrim(p_notes),''),p_tyre_condition,brand_id,pattern_id,size_id,nullif(btrim(p_load_index),''),nullif(btrim(p_speed_rating),''),p_location_id,actor)
  returning id into product_id;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(actor,'admin',p_location_id,'PRODUCT_CREATED','product',product_id::text,jsonb_build_object('name',btrim(p_name),'category',p_category_code,'retail_price_incl_gst',p_retail_price_incl_gst));
  return product_id;
end;
$$;

revoke execute on function public.create_workspace_product(uuid,text,numeric,text,numeric,text,text,text,text,text,text,text,text) from public,anon,service_role;
grant execute on function public.create_workspace_product(uuid,text,numeric,text,numeric,text,text,text,text,text,text,text,text) to authenticated;
