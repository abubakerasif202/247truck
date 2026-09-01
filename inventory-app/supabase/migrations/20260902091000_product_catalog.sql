-- Product catalogue + used-tyre data model.
-- Depends on 20260902090000_identity_access.sql (locations, private.app_is_admin,
-- private.app_user_location_id, public.app_audit_event).

create table public.product_categories (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0
);

insert into public.product_categories (code, name, sort_order)
values
  ('truck_tyre', 'Truck Tyres', 10),
  ('rim_wheel', 'Rims / Wheels', 20),
  ('tube', 'Tubes', 30),
  ('valve', 'Valves', 40),
  ('wheel_nut_stud', 'Wheel Nuts / Studs', 50),
  ('repair_material', 'Repair Materials', 60),
  ('balancing_weight', 'Balancing Weights', 70),
  ('workshop_consumable', 'Workshop Consumables', 80),
  ('other_part', 'Other Related Parts', 90);

create table public.tyre_brands (
  id uuid primary key default extensions.gen_random_uuid(),
  normalized_name text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.tyre_patterns (
  id uuid primary key default extensions.gen_random_uuid(),
  brand_id uuid not null references public.tyre_brands (id) on delete cascade,
  normalized_name text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (brand_id, normalized_name)
);

create table public.tyre_sizes (
  id uuid primary key default extensions.gen_random_uuid(),
  normalized_size text not null unique,
  display_size text not null,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  category_code text not null references public.product_categories (code),
  part_reference text,
  selling_price_incl_gst numeric(14, 2) not null
    check (selling_price_incl_gst >= 0),
  active boolean not null default true,
  tyre_condition text check (tyre_condition in ('new', 'used')),
  tyre_brand_id uuid references public.tyre_brands (id),
  tyre_pattern_id uuid references public.tyre_patterns (id),
  tyre_size_id uuid references public.tyre_sizes (id),
  load_index text,
  speed_rating text,
  notes text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_not_blank_check check (btrim(name) <> ''),
  constraint products_truck_tyre_requirements_check check (
    category_code <> 'truck_tyre'
    or (
      tyre_condition is not null
      and tyre_brand_id is not null
      and tyre_size_id is not null
    )
  ),
  constraint products_tyre_condition_consistency_check check (
    (tyre_condition is null and tyre_brand_id is null
      and tyre_pattern_id is null and tyre_size_id is null)
    or tyre_condition is not null
  )
);

create index products_category_idx on public.products (category_code);
create index products_active_idx on public.products (active);
create index products_name_idx on public.products (lower(name));
create index products_part_reference_idx on public.products (lower(part_reference));
create index products_tyre_brand_idx on public.products (tyre_brand_id);
create index products_tyre_size_idx on public.products (tyre_size_id);

create table public.used_tyre_units (
  id uuid primary key default extensions.gen_random_uuid(),
  product_id uuid not null references public.products (id),
  location_id uuid not null references public.locations (id),
  internal_unit_code text not null unique,
  tread_depth_mm numeric(5, 2) not null check (tread_depth_mm >= 0),
  condition text not null check (condition in ('excellent', 'good', 'fair', 'scrap')),
  cost_basis numeric(14, 4) not null check (cost_basis >= 0),
  selling_price_override numeric(14, 2) check (selling_price_override >= 0),
  status text not null default 'available'
    check (status in ('available', 'reserved', 'sold', 'scrap')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index used_tyre_units_product_idx on public.used_tyre_units (product_id);
create index used_tyre_units_location_idx on public.used_tyre_units (location_id);
create index used_tyre_units_status_idx on public.used_tyre_units (status);

create table public.inventory_settings (
  product_id uuid not null references public.products (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  reorder_quantity integer not null default 0 check (reorder_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, location_id)
);

-- RLS -----------------------------------------------------------------------

alter table public.product_categories enable row level security;
alter table public.tyre_brands enable row level security;
alter table public.tyre_patterns enable row level security;
alter table public.tyre_sizes enable row level security;
alter table public.products enable row level security;
alter table public.used_tyre_units enable row level security;
alter table public.inventory_settings enable row level security;

revoke all on public.product_categories from public, anon, authenticated, service_role;
revoke all on public.tyre_brands from public, anon, authenticated, service_role;
revoke all on public.tyre_patterns from public, anon, authenticated, service_role;
revoke all on public.tyre_sizes from public, anon, authenticated, service_role;
revoke all on public.products from public, anon, authenticated, service_role;
revoke all on public.used_tyre_units from public, anon, authenticated, service_role;
revoke all on public.inventory_settings from public, anon, authenticated, service_role;

grant select on public.product_categories to authenticated;
grant select on public.tyre_brands to authenticated;
grant select on public.tyre_patterns to authenticated;
grant select on public.tyre_sizes to authenticated;
grant select on public.products to authenticated;
grant select on public.used_tyre_units to authenticated;
grant select on public.inventory_settings to authenticated;

grant select, insert, update, delete on public.product_categories to service_role;
grant select, insert, update, delete on public.tyre_brands to service_role;
grant select, insert, update, delete on public.tyre_patterns to service_role;
grant select, insert, update, delete on public.tyre_sizes to service_role;
grant select, insert, update, delete on public.products to service_role;
grant select, insert, update, delete on public.used_tyre_units to service_role;
grant select, insert, update, delete on public.inventory_settings to service_role;

-- Reference data: any active authenticated user may read.
create policy product_categories_read on public.product_categories
  for select to authenticated using (true);
create policy tyre_brands_read on public.tyre_brands
  for select to authenticated using (true);
create policy tyre_patterns_read on public.tyre_patterns
  for select to authenticated using (true);
create policy tyre_sizes_read on public.tyre_sizes
  for select to authenticated using (true);

-- Product master: readable by any authenticated user with an active profile.
-- Writes have NO authenticated grant and NO write policy: product creation and
-- archival go exclusively through public.create_product / public.set_product_active
-- (SECURITY DEFINER, Admin-checked). This keeps "a Manager cannot write products"
-- true at the grant layer, not just the app layer.
create policy products_read on public.products
  for select to authenticated
  using (
    (select private.app_is_admin())
    or (select private.app_user_location_id()) is not null
  );

-- inventory_settings: read follows product visibility. Writes are deferred to
-- Task 7 (reorder thresholds); no authenticated write grant/policy yet.
create policy inventory_settings_read on public.inventory_settings
  for select to authenticated
  using (
    (select private.app_is_admin())
    or location_id = (select private.app_user_location_id())
  );

-- Used-tyre units: Admin sees all branches; Manager sees only their branch.
-- Direct inserts are NOT granted to authenticated - Task 6 creates units
-- atomically with a stock movement via a SECURITY DEFINER RPC.
create policy used_tyre_units_read on public.used_tyre_units
  for select to authenticated
  using (
    (select private.app_is_admin())
    or location_id = (select private.app_user_location_id())
  );

-- Zero-fill inventory_settings for every product x location on product insert.
create or replace function private.seed_inventory_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_settings (product_id, location_id)
  select new.id, location.id
  from public.locations as location
  on conflict (product_id, location_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.seed_inventory_settings()
  from public, anon, authenticated, service_role;

create trigger products_seed_inventory_settings
after insert on public.products
for each row execute function private.seed_inventory_settings();

-- Keep updated_at honest on the mutable catalogue tables.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at()
  from public, anon, authenticated, service_role;

create trigger products_touch_updated_at
before update on public.products
for each row execute function private.touch_updated_at();
create trigger used_tyre_units_touch_updated_at
before update on public.used_tyre_units
for each row execute function private.touch_updated_at();
create trigger inventory_settings_touch_updated_at
before update on public.inventory_settings
for each row execute function private.touch_updated_at();

-- Atomic Admin product creation -------------------------------------------------

create or replace function private.upsert_tyre_brand(p_value text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized text := upper(btrim(regexp_replace(p_value, '\s+', ' ', 'g')));
  v_id uuid;
begin
  insert into public.tyre_brands (normalized_name, display_name)
  values (v_normalized, btrim(p_value))
  on conflict (normalized_name) do update set display_name = public.tyre_brands.display_name
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.upsert_tyre_size(p_value text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized text := upper(btrim(regexp_replace(p_value, '\s+', ' ', 'g')));
  v_id uuid;
begin
  insert into public.tyre_sizes (normalized_size, display_size)
  values (v_normalized, btrim(p_value))
  on conflict (normalized_size) do update set display_size = public.tyre_sizes.display_size
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.upsert_tyre_pattern(p_brand_id uuid, p_value text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized text := upper(btrim(regexp_replace(p_value, '\s+', ' ', 'g')));
  v_id uuid;
begin
  insert into public.tyre_patterns (brand_id, normalized_name, display_name)
  values (p_brand_id, v_normalized, btrim(p_value))
  on conflict (brand_id, normalized_name)
    do update set display_name = public.tyre_patterns.display_name
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function private.upsert_tyre_brand(text) from public, anon, authenticated, service_role;
revoke execute on function private.upsert_tyre_size(text) from public, anon, authenticated, service_role;
revoke execute on function private.upsert_tyre_pattern(uuid, text) from public, anon, authenticated, service_role;

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

create or replace function public.set_product_active(
  p_product_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  update public.products set active = p_active where id = p_product_id;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type, entity_type, entity_id
  )
  values (
    v_actor, 'admin', null,
    case when p_active then 'PRODUCT_UNARCHIVED' else 'PRODUCT_ARCHIVED' end,
    'product', p_product_id::text
  );
end;
$$;

revoke execute on function public.create_product(
  text, text, numeric, text, text, text, text, text, text, text, text
) from public, anon, service_role;
revoke execute on function public.set_product_active(uuid, boolean)
  from public, anon, service_role;

grant execute on function public.create_product(
  text, text, numeric, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.set_product_active(uuid, boolean) to authenticated;
