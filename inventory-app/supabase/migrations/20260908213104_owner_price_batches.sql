-- Phase 4C approved owner-price batch contract.
-- These records are append-only. Product price changes remain delegated to the
-- canonical set_product_selling_price authority.

create table public.pricing_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  source_sha256 text not null check (source_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  source_row_count integer not null check (source_row_count > 0),
  reference_quantity integer not null check (reference_quantity >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.pricing_batch_rows (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.pricing_batches(id) on delete restrict,
  source_row_number integer not null check (source_row_number > 0),
  product_id uuid not null references public.products(id) on delete restrict,
  expected_sku text,
  expected_brand text not null check (btrim(expected_brand) <> ''),
  expected_pattern text not null check (btrim(expected_pattern) <> ''),
  expected_size text not null check (btrim(expected_size) <> ''),
  expected_current_price numeric(14,2) check (expected_current_price is null or expected_current_price >= 0),
  expected_updated_at timestamptz not null,
  target_price numeric(14,2) not null check (target_price >= 0),
  reference_quantity integer not null check (reference_quantity > 0),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(batch_id, source_row_number),
  unique(batch_id, product_id)
);

create table public.pricing_batch_row_events (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_row_id uuid not null references public.pricing_batch_rows(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  event_type text not null check (event_type in ('applied','already_applied','stale','identity_mismatch','failed')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  old_price numeric(14,2),
  new_price numeric(14,2),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(batch_row_id, attempt_number)
);

create index pricing_batch_rows_batch_id_idx on public.pricing_batch_rows(batch_id);
create index pricing_batch_rows_product_id_idx on public.pricing_batch_rows(product_id);
create index pricing_batch_row_events_row_id_idx on public.pricing_batch_row_events(batch_row_id, attempt_number desc);

alter table public.pricing_batches enable row level security;
alter table public.pricing_batch_rows enable row level security;
alter table public.pricing_batch_row_events enable row level security;

create or replace function private.prevent_pricing_record_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'PRICING_HISTORY_IMMUTABLE' using errcode = '42501';
end;
$$;

create trigger pricing_batches_immutable
before update or delete on public.pricing_batches
for each row execute function private.prevent_pricing_record_mutation();
create trigger pricing_batches_truncate_immutable
before truncate on public.pricing_batches
for each statement execute function private.prevent_pricing_record_mutation();
create trigger pricing_batch_rows_immutable
before update or delete on public.pricing_batch_rows
for each row execute function private.prevent_pricing_record_mutation();
create trigger pricing_batch_rows_truncate_immutable
before truncate on public.pricing_batch_rows
for each statement execute function private.prevent_pricing_record_mutation();
create trigger pricing_batch_row_events_immutable
before update or delete on public.pricing_batch_row_events
for each row execute function private.prevent_pricing_record_mutation();
create trigger pricing_batch_row_events_truncate_immutable
before truncate on public.pricing_batch_row_events
for each statement execute function private.prevent_pricing_record_mutation();

create or replace function public.create_owner_price_batch(
  p_source_sha256 text,
  p_source_row_count integer,
  p_reference_quantity integer,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_batch_id uuid;
  v_row record;
  v_product record;
  v_quantity_total integer := 0;
  v_seen_rows integer[] := '{}';
begin
  if not private.app_has_permission('inventory.edit_global_price') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_source_sha256 <> 'F7F9EDE7F19AD5AC41884D91B792911078C1BD622BFBF100D387F0650C2FAD8A'
    or p_source_row_count <> 28
    or p_reference_quantity <> 643
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) <> 28 then
    raise exception 'PRICING_SOURCE_INVALID' using errcode = '22023';
  end if;

  insert into public.pricing_batches(source_sha256, source_row_count, reference_quantity, created_by)
  values (p_source_sha256, p_source_row_count, p_reference_quantity, v_actor)
  returning id into v_batch_id;

  for v_row in
    select * from jsonb_to_recordset(p_rows) as x(
      source_row_number integer, product_id uuid, expected_sku text,
      expected_brand text, expected_pattern text, expected_size text,
      expected_current_price numeric, expected_updated_at timestamptz,
      target_price numeric, reference_quantity integer, approved boolean
    )
  loop
    if v_row.source_row_number = any(v_seen_rows)
      or v_row.source_row_number < 1
      or v_row.source_row_number > 28
      or not coalesce(v_row.approved, false)
      or v_row.product_id is null
      or v_row.expected_updated_at is null
      or v_row.reference_quantity is null
      or v_row.reference_quantity <= 0
      or v_row.target_price is null
      or v_row.target_price < 0
      or v_row.target_price <> round(v_row.target_price, 2)
      or (v_row.expected_current_price is not null
          and v_row.expected_current_price <> round(v_row.expected_current_price, 2)) then
      raise exception 'PRICING_ROW_INVALID' using errcode = '22023';
    end if;
    v_seen_rows := array_append(v_seen_rows, v_row.source_row_number);

    select p.id, p.part_reference, p.selling_price_incl_gst, p.updated_at,
           b.display_name as brand, pt.display_name as pattern, s.display_size as size
      into v_product
      from public.products p
      join public.tyre_brands b on b.id = p.tyre_brand_id
      join public.tyre_patterns pt on pt.id = p.tyre_pattern_id and pt.brand_id = b.id
      join public.tyre_sizes s on s.id = p.tyre_size_id
     where p.id = v_row.product_id
       and p.active and p.category_code = 'truck_tyre' and p.tyre_condition = 'new';
    if not found
      or lower(btrim(v_product.brand)) <> lower(btrim(v_row.expected_brand))
      or lower(btrim(v_product.pattern)) <> lower(btrim(v_row.expected_pattern))
      or lower(btrim(v_product.size)) <> lower(btrim(v_row.expected_size))
      or v_product.part_reference is distinct from v_row.expected_sku
      or v_product.selling_price_incl_gst is distinct from v_row.expected_current_price
      or v_product.updated_at is distinct from v_row.expected_updated_at then
      raise exception 'PRICING_EXPECTATION_MISMATCH' using errcode = '40001';
    end if;
    if exists (
      select 1
        from public.products p2
        join public.tyre_brands b2 on b2.id = p2.tyre_brand_id
        join public.tyre_patterns pt2 on pt2.id = p2.tyre_pattern_id and pt2.brand_id = b2.id
        join public.tyre_sizes s2 on s2.id = p2.tyre_size_id
       where p2.id <> v_product.id
         and p2.active and p2.category_code = 'truck_tyre' and p2.tyre_condition = 'new'
         and lower(btrim(b2.display_name)) = lower(btrim(v_row.expected_brand))
         and lower(btrim(pt2.display_name)) = lower(btrim(v_row.expected_pattern))
         and lower(btrim(s2.display_size)) = lower(btrim(v_row.expected_size))
         and p2.part_reference is not distinct from v_row.expected_sku
    ) then
      raise exception 'PRICING_IDENTITY_AMBIGUOUS' using errcode = '21000';
    end if;

    insert into public.pricing_batch_rows(
      batch_id, source_row_number, product_id, expected_sku, expected_brand,
      expected_pattern, expected_size, expected_current_price, expected_updated_at,
      target_price, reference_quantity, approved_by
    ) values (
      v_batch_id, v_row.source_row_number, v_row.product_id, v_row.expected_sku,
      v_row.expected_brand, v_row.expected_pattern, v_row.expected_size,
      v_row.expected_current_price, v_row.expected_updated_at, v_row.target_price,
      v_row.reference_quantity, v_actor
    );
    v_quantity_total := v_quantity_total + v_row.reference_quantity;
  end loop;

  if cardinality(v_seen_rows) <> 28 or v_quantity_total <> 643 then
    raise exception 'PRICING_SOURCE_INVALID' using errcode = '22023';
  end if;
  return v_batch_id;
exception when others then
  raise;
end;
$$;

create or replace function public.apply_owner_price_batch_row(p_batch_row_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row record;
  v_product record;
  v_last record;
  v_attempt integer;
  v_event text;
  v_details jsonb;
begin
  if not private.app_has_permission('inventory.edit_global_price') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  select * into v_row from public.pricing_batch_rows where id = p_batch_row_id for update;
  if not found then raise exception 'PRICING_ROW_NOT_FOUND' using errcode = 'P0002'; end if;

  select event_type, details, attempt_number into v_last
    from public.pricing_batch_row_events
   where batch_row_id = p_batch_row_id
   order by attempt_number desc limit 1;
  if v_last.event_type in ('applied', 'already_applied') then
    return v_last.details || jsonb_build_object('status', v_last.event_type, 'batch_row_id', p_batch_row_id, 'attempt_number', v_last.attempt_number);
  end if;
  v_attempt := coalesce((select max(attempt_number) from public.pricing_batch_row_events where batch_row_id = p_batch_row_id), 0) + 1;

  select p.id, p.part_reference, p.selling_price_incl_gst, p.updated_at,
         p.active, p.category_code, p.tyre_condition,
         b.display_name as brand, pt.display_name as pattern, s.display_size as size
    into v_product
    from public.products p
    left join public.tyre_brands b on b.id = p.tyre_brand_id
    left join public.tyre_patterns pt on pt.id = p.tyre_pattern_id
    left join public.tyre_sizes s on s.id = p.tyre_size_id
   where p.id = v_row.product_id for update of p;
  if not found then
    v_event := 'identity_mismatch';
    v_details := jsonb_build_object('reason', 'PRODUCT_NOT_FOUND');
  elsif not v_product.active or v_product.category_code <> 'truck_tyre' or v_product.tyre_condition <> 'new'
    or lower(btrim(coalesce(v_product.brand, ''))) <> lower(btrim(v_row.expected_brand))
    or lower(btrim(coalesce(v_product.pattern, ''))) <> lower(btrim(v_row.expected_pattern))
    or lower(btrim(coalesce(v_product.size, ''))) <> lower(btrim(v_row.expected_size))
    or v_product.part_reference is distinct from v_row.expected_sku then
    v_event := 'identity_mismatch';
    v_details := jsonb_build_object('reason', 'PRODUCT_IDENTITY_CHANGED');
  elsif v_product.selling_price_incl_gst is distinct from v_row.expected_current_price
    or v_product.updated_at is distinct from v_row.expected_updated_at then
    v_event := 'stale';
    v_details := jsonb_build_object('reason', 'EXPECTED_VALUE_CHANGED', 'actual_price', v_product.selling_price_incl_gst, 'actual_updated_at', v_product.updated_at);
  elsif v_product.selling_price_incl_gst is not distinct from v_row.target_price then
    v_event := 'already_applied';
    v_details := jsonb_build_object('product_id', v_row.product_id, 'old_price', v_product.selling_price_incl_gst, 'new_price', v_row.target_price);
  else
    begin
      perform public.set_product_selling_price(v_row.product_id, v_row.target_price);
      v_event := 'applied';
      v_details := jsonb_build_object('product_id', v_row.product_id, 'old_price', v_product.selling_price_incl_gst, 'new_price', v_row.target_price);
    exception when others then
      v_event := 'failed';
      v_details := jsonb_build_object('error_code', sqlstate);
    end;
  end if;

  insert into public.pricing_batch_row_events(batch_row_id, attempt_number, event_type, actor_user_id, old_price, new_price, details)
  values (p_batch_row_id, v_attempt, v_event, v_actor, v_product.selling_price_incl_gst, v_row.target_price, v_details);
  return v_details || jsonb_build_object('status', v_event, 'batch_row_id', p_batch_row_id, 'attempt_number', v_attempt);
end;
$$;

revoke all on public.pricing_batches, public.pricing_batch_rows, public.pricing_batch_row_events from public, anon, authenticated, service_role;
grant select on public.pricing_batches, public.pricing_batch_rows, public.pricing_batch_row_events to authenticated;
grant select on public.pricing_batches, public.pricing_batch_rows, public.pricing_batch_row_events to service_role;
revoke execute on function public.create_owner_price_batch(text, integer, integer, jsonb) from public, anon, service_role;
revoke execute on function public.apply_owner_price_batch_row(uuid) from public, anon, service_role;
grant execute on function public.create_owner_price_batch(text, integer, integer, jsonb) to authenticated;
grant execute on function public.apply_owner_price_batch_row(uuid) to authenticated;

create policy pricing_batches_admin_select on public.pricing_batches for select to authenticated using ((select private.app_is_admin()));
create policy pricing_batch_rows_admin_select on public.pricing_batch_rows for select to authenticated using ((select private.app_is_admin()));
create policy pricing_batch_events_admin_select on public.pricing_batch_row_events for select to authenticated using ((select private.app_is_admin()));

revoke execute on function private.prevent_pricing_record_mutation() from public, anon, authenticated, service_role;
