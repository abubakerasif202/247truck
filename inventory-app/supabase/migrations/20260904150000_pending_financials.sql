-- Pending financial state for opening stock.
-- Unknown selling price and WAC are represented as NULL, never as zero.

alter table public.products
  alter column selling_price_incl_gst drop not null;

alter table public.inventory_balances
  alter column weighted_average_cost drop not null;

alter table public.inventory_movements
  alter column cost_snapshot drop not null;

-- Empty balances remain a known neutral state. Positive unknown-cost opening
-- stock may explicitly set WAC to NULL in the dedicated opening-stock path.
create or replace function private.normalize_empty_balance_wac()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.on_hand = 0 then
    new.weighted_average_cost := 0;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalize_empty_balance_wac()
  from public, anon, authenticated, service_role;

create trigger inventory_balances_zero_wac
before insert or update on public.inventory_balances
for each row execute function private.normalize_empty_balance_wac();

-- Re-state product creation with the existing signature/body. PostgreSQL CHECK
-- constraints accept NULL, so a missing selling price remains genuinely pending.
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
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if p_selling_price_incl_gst is not null and p_selling_price_incl_gst < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;

  if p_tyre_condition is not null then
    if p_tyre_brand is null or btrim(p_tyre_brand) = ''
      or p_tyre_size is null or btrim(p_tyre_size) = '' then
      raise exception 'TYRE_ATTRIBUTES_REQUIRED' using errcode = '23514';
    end if;
    v_brand_id := private.upsert_tyre_brand(p_tyre_brand);
    v_size_id := private.upsert_tyre_size(p_tyre_size);
    if p_tyre_pattern is not null and btrim(p_tyre_pattern) <> '' then
      v_pattern_id := private.upsert_tyre_pattern(v_brand_id, p_tyre_pattern);
    end if;
  end if;

  insert into public.products (
    name, category_code, part_reference, selling_price_incl_gst, notes,
    tyre_condition, tyre_brand_id, tyre_pattern_id, tyre_size_id,
    load_index, speed_rating, created_by
  )
  values (
    btrim(p_name), p_category_code, p_part_reference, p_selling_price_incl_gst, p_notes,
    p_tyre_condition, v_brand_id, v_pattern_id, v_size_id,
    p_load_index, p_speed_rating, v_actor
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

create or replace function public.set_product_selling_price(
  p_product_id uuid,
  p_selling_price_incl_gst numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old_price numeric;
begin
  if not private.app_has_permission('inventory.edit_global_price') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_selling_price_incl_gst is not null and p_selling_price_incl_gst < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;

  select selling_price_incl_gst into v_old_price
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.products
  set selling_price_incl_gst = p_selling_price_incl_gst
  where id = p_product_id;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details
  )
  select
    v_actor,
    profile.role,
    profile.location_id,
    'PRODUCT_SELLING_PRICE_UPDATED',
    'product',
    p_product_id::text,
    jsonb_build_object('old_price', v_old_price, 'new_price', p_selling_price_incl_gst)
  from public.user_profiles as profile
  where profile.user_id = v_actor and profile.active;
end;
$$;

revoke execute on function public.set_product_selling_price(uuid, numeric)
  from public, anon, service_role;
grant execute on function public.set_product_selling_price(uuid, numeric)
  to authenticated;
