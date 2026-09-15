-- Allow quick catalogue entry with only product name + retail price supplied by
-- the application. Tyre metadata remains optional and may be completed later.
--
-- This intentionally preserves the nullable legacy selling-price contract used
-- by opening-stock imports; the New Product application form enforces retail
-- price separately.

alter table public.products
  drop constraint if exists products_truck_tyre_requirements_check;

create or replace function public.create_product(
  p_name text,
  p_category_code text,
  p_selling_price_incl_gst numeric,
  p_part_reference text default null,
  p_notes text default null,
  p_tyre_condition text default null,
  p_tyre_brand text default null,
  p_tyre_pattern text default null,
  p_tyre_size text default null,
  p_load_index text default null,
  p_speed_rating text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_brand_id uuid;
  v_pattern_id uuid;
  v_size_id uuid;
  v_product_id uuid;
  v_condition text := nullif(btrim(p_tyre_condition), '');
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'INVALID_PRODUCT_NAME' using errcode = '22023';
  end if;

  if p_selling_price_incl_gst is not null and p_selling_price_incl_gst < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;

  if v_condition is not null and v_condition not in ('new', 'used') then
    raise exception 'INVALID_TYRE_CONDITION' using errcode = '22023';
  end if;

  if p_tyre_brand is not null and btrim(p_tyre_brand) <> '' then
    v_brand_id := private.upsert_tyre_brand(p_tyre_brand);
  end if;

  if p_tyre_size is not null and btrim(p_tyre_size) <> '' then
    v_size_id := private.upsert_tyre_size(p_tyre_size);
  end if;

  if p_tyre_pattern is not null and btrim(p_tyre_pattern) <> '' then
    if v_brand_id is null then
      raise exception 'TYRE_PATTERN_REQUIRES_BRAND' using errcode = '23514';
    end if;
    v_pattern_id := private.upsert_tyre_pattern(v_brand_id, p_tyre_pattern);
  end if;

  -- When optional tyre metadata is supplied through an API caller without a
  -- condition, use the existing form default so the consistency constraint is
  -- still honoured. A completely blank tyre block remains NULL metadata.
  if v_condition is null and (
    v_brand_id is not null
    or v_pattern_id is not null
    or v_size_id is not null
  ) then
    v_condition := 'new';
  end if;

  insert into public.products (
    name, category_code, part_reference, selling_price_incl_gst, notes,
    tyre_condition, tyre_brand_id, tyre_pattern_id, tyre_size_id,
    load_index, speed_rating, created_by
  )
  values (
    btrim(p_name), p_category_code, nullif(btrim(p_part_reference), ''),
    p_selling_price_incl_gst, nullif(btrim(p_notes), ''),
    v_condition, v_brand_id, v_pattern_id, v_size_id,
    nullif(btrim(p_load_index), ''), nullif(btrim(p_speed_rating), ''), v_actor
  )
  returning id into v_product_id;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details
  )
  values (
    v_actor, 'admin', null, 'PRODUCT_CREATED', 'product', v_product_id::text,
    jsonb_build_object('name', btrim(p_name), 'category', p_category_code)
  );

  return v_product_id;
end;
$$;

revoke execute on function public.create_product(
  text, text, numeric, text, text, text, text, text, text, text, text
) from public, anon, service_role;
grant execute on function public.create_product(
  text, text, numeric, text, text, text, text, text, text, text, text
) to authenticated;
