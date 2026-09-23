-- Price Pending is represented by NULL. Keep the legacy selling-price alias
-- synchronized without restoring a price that staff explicitly cleared.
create or replace function private.sync_retail_compatibility_price()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.retail_price_incl_gst is null then
      new.retail_price_incl_gst := new.selling_price_incl_gst;
    else
      new.selling_price_incl_gst := new.retail_price_incl_gst;
    end if;
  elsif new.retail_price_incl_gst is distinct from old.retail_price_incl_gst then
    new.selling_price_incl_gst := new.retail_price_incl_gst;
  elsif new.selling_price_incl_gst is distinct from old.selling_price_incl_gst then
    new.retail_price_incl_gst := new.selling_price_incl_gst;
  end if;
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
  if p_retail_price_incl_gst is not null and p_retail_price_incl_gst<0
    or p_wholesale_price_incl_gst is not null and p_wholesale_price_incl_gst<0 then
    raise exception 'INVALID_PRICE' using errcode='22023';
  end if;
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

create or replace function public.update_product_details(
  p_product_id uuid, p_name text, p_category_code text, p_part_reference text,
  p_notes text, p_tyre_condition text, p_tyre_brand text, p_tyre_pattern text,
  p_tyre_size text, p_load_index text, p_speed_rating text
)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); current_product public.products%rowtype;
  brand_id uuid; pattern_id uuid; size_id uuid;
begin
  if not private.app_is_admin() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into current_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode='P0002'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'PRODUCT_NAME_REQUIRED' using errcode='22023'; end if;
  if nullif(btrim(p_category_code),'') is not null and not exists(select 1 from public.product_categories where code=p_category_code) then raise exception 'INVALID_PRODUCT_CATEGORY' using errcode='22023'; end if;
  if nullif(btrim(p_tyre_condition),'') is not null and p_tyre_condition not in ('new','used') then raise exception 'INVALID_TYRE_CONDITION' using errcode='22023'; end if;
  if current_product.tyre_condition='used' and nullif(btrim(p_tyre_condition),'') is distinct from 'used'
    and exists(select 1 from public.used_tyre_units where product_id=p_product_id) then
    raise exception 'TRACKED_USED_UNITS_EXIST' using errcode='23514';
  end if;
  if nullif(btrim(p_tyre_brand),'') is not null then brand_id:=private.upsert_tyre_brand(p_tyre_brand); end if;
  if brand_id is not null and nullif(btrim(p_tyre_pattern),'') is not null then pattern_id:=private.upsert_tyre_pattern(brand_id,p_tyre_pattern); end if;
  if nullif(btrim(p_tyre_size),'') is not null then size_id:=private.upsert_tyre_size(p_tyre_size); end if;
  update public.products set
    name=btrim(p_name), category_code=nullif(btrim(p_category_code),''),
    part_reference=nullif(btrim(p_part_reference),''), notes=nullif(btrim(p_notes),''),
    tyre_condition=nullif(btrim(p_tyre_condition),''), tyre_brand_id=brand_id,
    tyre_pattern_id=pattern_id, tyre_size_id=size_id,
    load_index=nullif(btrim(p_load_index),''), speed_rating=nullif(btrim(p_speed_rating),'')
  where id=p_product_id;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(actor,'admin',current_product.owner_location_id,'PRODUCT_DETAILS_UPDATED','product',p_product_id::text,
    jsonb_build_object('old_name',current_product.name,'new_name',btrim(p_name)));
end;
$$;
revoke execute on function public.update_product_details(uuid,text,text,text,text,text,text,text,text,text,text) from public,anon,service_role;
grant execute on function public.update_product_details(uuid,text,text,text,text,text,text,text,text,text,text) to authenticated;
