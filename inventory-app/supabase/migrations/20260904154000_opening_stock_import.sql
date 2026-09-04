-- Atomic, idempotent import boundary for the fixed Regency Park opening-stock
-- dataset. Each source row either matches/creates one New truck-tyre product,
-- posts one opening-stock movement, and records evidence, or rolls back fully.

create table public.opening_stock_import_rows (
  dataset_key text not null,
  row_key text not null,
  row_number integer not null check (row_number > 0),
  product_id uuid not null references public.products(id),
  inventory_movement_id uuid not null unique references public.inventory_movements(id),
  created_product boolean not null,
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  primary key (dataset_key, row_key)
);

alter table public.opening_stock_import_rows enable row level security;
revoke all on public.opening_stock_import_rows
  from public, anon, authenticated, service_role;
grant select on public.opening_stock_import_rows to service_role;

create or replace function private.normalize_opening_lookup(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select upper(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')))
$$;

revoke execute on function private.normalize_opening_lookup(text)
  from public, anon, authenticated, service_role;

create or replace function public.import_opening_stock_row(
  p_dataset_key text,
  p_row_key text,
  p_row_number integer,
  p_request_id uuid,
  p_brand text,
  p_pattern text,
  p_size text,
  p_quantity integer,
  p_location_code text
)
returns table (
  product_id uuid,
  movement_id uuid,
  created_product boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.opening_stock_import_rows%rowtype;
  v_location_id uuid;
  v_product_id uuid;
  v_movement_id uuid;
  v_created boolean := false;
  v_candidate_count integer;
  v_normalized_brand text;
  v_normalized_pattern text;
  v_normalized_size text;
begin
  if v_actor is null or not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if btrim(coalesce(p_dataset_key, '')) = ''
    or btrim(coalesce(p_row_key, '')) = ''
    or p_row_number is null or p_row_number <= 0
    or p_request_id is null
    or btrim(coalesce(p_brand, '')) = ''
    or btrim(coalesce(p_size, '')) = ''
    or p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_OPENING_IMPORT_ROW' using errcode = '22023';
  end if;

  if p_location_code is distinct from 'REG' then
    raise exception 'OPENING_IMPORT_REGENCY_ONLY' using errcode = '22023';
  end if;

  select location.id into v_location_id
  from public.locations as location
  where location.code = 'REG';
  if not found then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_dataset_key || ':' || p_row_key, 0)
  );

  select * into v_existing
  from public.opening_stock_import_rows as evidence
  where evidence.dataset_key = p_dataset_key
    and evidence.row_key = p_row_key;

  if found then
    return query select
      v_existing.product_id,
      v_existing.inventory_movement_id,
      v_existing.created_product,
      true;
    return;
  end if;

  v_normalized_brand := private.normalize_opening_lookup(p_brand);
  v_normalized_pattern := private.normalize_opening_lookup(p_pattern);
  v_normalized_size := private.normalize_opening_lookup(p_size);

  select count(*)
  into v_candidate_count
  from public.products as product
  join public.tyre_brands as brand on brand.id = product.tyre_brand_id
  join public.tyre_sizes as size on size.id = product.tyre_size_id
  left join public.tyre_patterns as pattern on pattern.id = product.tyre_pattern_id
  where product.category_code = 'truck_tyre'
    and product.tyre_condition = 'new'
    and brand.normalized_name = v_normalized_brand
    and size.normalized_size = v_normalized_size
    and (
      (v_normalized_pattern = '' and product.tyre_pattern_id is null)
      or pattern.normalized_name = v_normalized_pattern
    );

  if v_candidate_count > 1 then
    raise exception 'AMBIGUOUS_PRODUCT_MATCH' using errcode = '21000';
  end if;

  if v_candidate_count = 1 then
    select product.id
    into v_product_id
    from public.products as product
    join public.tyre_brands as brand on brand.id = product.tyre_brand_id
    join public.tyre_sizes as size on size.id = product.tyre_size_id
    left join public.tyre_patterns as pattern on pattern.id = product.tyre_pattern_id
    where product.category_code = 'truck_tyre'
      and product.tyre_condition = 'new'
      and brand.normalized_name = v_normalized_brand
      and size.normalized_size = v_normalized_size
      and (
        (v_normalized_pattern = '' and product.tyre_pattern_id is null)
        or pattern.normalized_name = v_normalized_pattern
      )
    limit 1;
  else
    v_product_id := public.create_product(
      p_name => concat_ws(
        ' ',
        btrim(p_brand),
        nullif(btrim(coalesce(p_pattern, '')), ''),
        btrim(p_size)
      ),
      p_category_code => 'truck_tyre',
      p_selling_price_incl_gst => null,
      p_tyre_condition => 'new',
      p_tyre_brand => btrim(p_brand),
      p_tyre_pattern => nullif(btrim(coalesce(p_pattern, '')), ''),
      p_tyre_size => btrim(p_size)
    );
    v_created := true;
  end if;

  select posted.movement_id into v_movement_id
  from public.post_opening_stock(
    p_request_id => p_request_id,
    p_product_id => v_product_id,
    p_location_id => v_location_id,
    p_quantity => p_quantity,
    p_inbound_unit_cost => null,
    p_source_type => 'opening_stock_import',
    p_source_id => p_dataset_key || ':' || p_row_key
  ) as posted;

  if v_movement_id is null then
    raise exception 'OPENING_IMPORT_MOVEMENT_MISSING' using errcode = '55000';
  end if;

  insert into public.opening_stock_import_rows (
    dataset_key,
    row_key,
    row_number,
    product_id,
    inventory_movement_id,
    created_product,
    imported_by
  )
  values (
    p_dataset_key,
    p_row_key,
    p_row_number,
    v_product_id,
    v_movement_id,
    v_created,
    v_actor
  );

  return query select v_product_id, v_movement_id, v_created, false;
end;
$$;

revoke execute on function public.import_opening_stock_row(
  text, text, integer, uuid, text, text, text, integer, text
) from public, anon, service_role;
grant execute on function public.import_opening_stock_row(
  text, text, integer, uuid, text, text, text, integer, text
) to authenticated;
