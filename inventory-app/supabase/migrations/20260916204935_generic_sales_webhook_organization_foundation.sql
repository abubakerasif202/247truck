-- Generic sales, webhook idempotency, and explicit organisation ownership.
--
-- This is deliberately additive. Existing location-scoped records are not
-- backfilled: the current data model does not establish which business owns a
-- historical location, product, customer, supplier, or invoice. New generic
-- sales cannot be created until an administrator makes an explicit
-- organisation/location assignment.

create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name text not null unique check (btrim(name) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.organizations (code, name)
values
  ('247TRUCK', '24/7 Truck Tyre Services'),
  ('AWT', 'Adelaide Wholesale Tyres')
on conflict (code) do nothing;

create table public.organization_location_assignments (
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  primary key (organization_id, location_id)
);
create unique index organization_location_one_active_organization
  on public.organization_location_assignments(location_id) where active;

-- Binds each external payment/order provider to exactly one organization and
-- location and to a durable order-identity namespace. This table is the
-- authorization boundary for public.process_paid_sale_webhook: an
-- unconfigured provider cannot create a paid sale, so caller-supplied
-- organization/location values can never select a foreign tenant, and a
-- generic webhook credential cannot be reused to target an unintended
-- organization. Seeded empty; paid-channel processing fails closed until an
-- administrator explicitly configures a provider.
create table private.sales_channel_configs (
  provider text primary key check (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  source text not null check (source in ('website', 'stripe')),
  order_namespace text not null check (order_namespace ~ '^[a-z][a-z0-9_-]{1,63}$'),
  expected_currency text not null check (expected_currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.sales_channel_configs enable row level security;
revoke all on private.sales_channel_configs from public, anon, authenticated, service_role;
create trigger sales_channel_configs_touch_updated_at
before update on private.sales_channel_configs
for each row execute function private.touch_updated_at();

create table public.sales (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  request_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  source text not null check (source in ('internal', 'website', 'stripe')),
  -- The business-order identity namespace. Distinct providers that front the
  -- same real storefront share a namespace (bound in
  -- private.sales_channel_configs) so a retry through a channel alias cannot
  -- double-deduct stock; unrelated providers get distinct namespaces so an
  -- external ID collision between them is not treated as the same order.
  order_namespace text,
  external_order_id text,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('committing', 'committed')),
  subtotal_incl_gst numeric(14,2) not null default 0 check (subtotal_incl_gst >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_incl_gst numeric(14,2) not null default 0 check (total_incl_gst >= 0),
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_external_order_not_blank check (external_order_id is null or btrim(external_order_id) <> ''),
  constraint sales_order_namespace_shape check (order_namespace is null or order_namespace ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint sales_order_identity_pair check ((external_order_id is null) = (order_namespace is null)),
  constraint sales_committed_at_check check ((status = 'committed' and committed_at is not null) or status = 'committing'),
  unique (actor_user_id, location_id, request_id)
);
create unique index sales_organization_namespace_external_order_key
  on public.sales(organization_id, order_namespace, external_order_id)
  where external_order_id is not null;
create index sales_organization_location_created_idx
  on public.sales(organization_id, location_id, created_at desc, id desc);

create table public.sale_items (
  id uuid primary key default extensions.gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  line_position integer not null check (line_position > 0),
  product_id uuid not null references public.products(id),
  inventory_movement_id uuid not null unique references public.inventory_movements(id) on delete restrict,
  sku_snapshot text,
  name_snapshot text not null check (btrim(name_snapshot) <> ''),
  description_snapshot text not null check (btrim(description_snapshot) <> ''),
  quantity integer not null check (quantity > 0),
  unit_price_incl_gst numeric(14,2) not null check (unit_price_incl_gst >= 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  unit_cost_snapshot numeric(14,4) not null check (unit_cost_snapshot >= 0),
  line_total_incl_gst numeric(14,2) not null check (line_total_incl_gst >= 0),
  created_at timestamptz not null default now(),
  unique (sale_id, line_position)
);
create index sale_items_sale_idx on public.sale_items(sale_id, line_position);
create index sale_items_product_idx on public.sale_items(product_id, created_at desc);

create table public.processed_webhook_events (
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  event_id text not null check (btrim(event_id) <> ''),
  event_type text not null check (btrim(event_type) <> ''),
  external_order_id text,
  organization_id uuid references public.organizations(id),
  location_id uuid references public.locations(id),
  sale_id uuid references public.sales(id),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('processing', 'completed', 'ignored', 'failed')),
  processed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, event_id),
  constraint webhook_error_shape check ((status = 'failed') = (error_code is not null)),
  constraint webhook_processed_at_shape check ((status in ('completed', 'ignored', 'failed')) = (processed_at is not null))
);
create index processed_webhook_events_order_idx
  on public.processed_webhook_events(organization_id, external_order_id, created_at desc)
  where external_order_id is not null;

create trigger organizations_touch_updated_at
before update on public.organizations
for each row execute function private.touch_updated_at();
create trigger sales_touch_updated_at
before update on public.sales
for each row execute function private.touch_updated_at();
create trigger processed_webhook_events_touch_updated_at
before update on public.processed_webhook_events
for each row execute function private.touch_updated_at();

alter table public.organizations enable row level security;
alter table public.organization_location_assignments enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.processed_webhook_events enable row level security;

revoke all on public.organizations, public.organization_location_assignments,
  public.sales, public.sale_items, public.processed_webhook_events
from public, anon, authenticated, service_role;
-- Server integrations may inspect durable outcomes but never write base tables.
grant select on public.sales, public.sale_items, public.processed_webhook_events to service_role;
grant select on public.organizations, public.organization_location_assignments to service_role;

create or replace function private.assert_organization_location_scope(
  p_organization_id uuid,
  p_location_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_location_id is null or not exists (
    select 1
    from public.organization_location_assignments ola
    join public.organizations o on o.id = ola.organization_id and o.active
    join public.locations l on l.id = ola.location_id and l.active
    where ola.organization_id = p_organization_id
      and ola.location_id = p_location_id
      and ola.active
  ) then
    raise exception 'ORGANIZATION_LOCATION_NOT_ASSIGNED' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.assert_sale_actor(
  p_actor_user_id uuid,
  p_location_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_profile public.user_profiles%rowtype;
begin
  select * into v_profile
  from public.user_profiles
  where user_id = p_actor_user_id and active;
  if not found then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_profile.role = 'manager' and v_profile.location_id is distinct from p_location_id then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_profile.role = 'manager' and not exists (
    select 1 from public.manager_permissions
    where user_id = p_actor_user_id and permission_key = 'pos.use' and enabled
  ) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  return v_profile.role;
end;
$$;

create or replace function public.admin_assign_organization_location(
  p_organization_id uuid,
  p_location_id uuid,
  p_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
begin
  v_actor := private.require_active_admin();
  if p_organization_id is null or p_location_id is null then
    raise exception 'INVALID_ORGANIZATION_ASSIGNMENT' using errcode = '22023';
  end if;
  if p_active and exists (
    select 1 from public.organization_location_assignments
    where location_id = p_location_id and active and organization_id <> p_organization_id
  ) then
    raise exception 'LOCATION_ALREADY_ASSIGNED_TO_ANOTHER_ORGANIZATION' using errcode = '23505';
  end if;
  insert into public.organization_location_assignments(
    organization_id, location_id, active, assigned_by
  ) values (p_organization_id, p_location_id, p_active, v_actor)
  on conflict (organization_id, location_id) do update
    set active = excluded.active, assigned_at = now(), assigned_by = excluded.assigned_by;
end;
$$;

-- Only an admin may bind a provider credential to an organization/location
-- and order-identity namespace. A caller of the webhook entry point never
-- chooses this binding; it is looked up server-side from this table.
create or replace function public.admin_upsert_sales_channel_config(
  p_provider text,
  p_organization_id uuid,
  p_location_id uuid,
  p_source text,
  p_order_namespace text,
  p_expected_currency text,
  p_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin();
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_-]{1,63}$'
     or p_source not in ('website', 'stripe')
     or p_order_namespace is null or p_order_namespace !~ '^[a-z][a-z0-9_-]{1,63}$'
     or p_expected_currency is null or p_expected_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_SALES_CHANNEL_CONFIG' using errcode = '22023';
  end if;
  perform private.assert_organization_location_scope(p_organization_id, p_location_id);
  insert into private.sales_channel_configs(
    provider, organization_id, location_id, source, order_namespace, expected_currency, active
  ) values (
    p_provider, p_organization_id, p_location_id, p_source, p_order_namespace, p_expected_currency, p_active
  )
  on conflict (provider) do update
    set organization_id = excluded.organization_id, location_id = excluded.location_id,
        source = excluded.source, order_namespace = excluded.order_namespace,
        expected_currency = excluded.expected_currency, active = excluded.active,
        updated_at = now();
end;
$$;

create or replace function private.commit_sale(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_source text,
  p_order_namespace text,
  p_external_order_id text,
  p_items jsonb,
  p_expected_total numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric(14,2);
  v_tax_amount numeric(14,2);
  v_line_total numeric(14,2);
  v_movement_id uuid;
  v_line_position integer := 0;
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_payload_hash text;
  v_movement_request_id uuid;
  v_existing_item_count integer;
begin
  if p_request_id is null or p_actor_user_id is null
     or p_source not in ('internal', 'website', 'stripe')
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_SALE_INPUT' using errcode = '22023';
  end if;
  if (p_external_order_id is null) <> (p_order_namespace is null) then
    raise exception 'INVALID_SALE_INPUT' using errcode = '22023';
  end if;
  if p_external_order_id is not null and btrim(p_external_order_id) = '' then
    raise exception 'INVALID_SALE_INPUT' using errcode = '22023';
  end if;

  v_role := private.assert_sale_actor(p_actor_user_id, p_location_id);
  perform private.assert_organization_location_scope(p_organization_id, p_location_id);
  v_payload_hash := encode(extensions.digest(convert_to(p_items::text, 'UTF8'), 'sha256'), 'hex');

  -- The two locks make retries and distinct webhook deliveries for the same
  -- external order serialize before either can consume inventory. The order
  -- lock is keyed by namespace, not by source, so two channel aliases that
  -- legitimately share a namespace also serialize against each other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'generic-sale-request:' || p_actor_user_id::text || ':' || p_location_id::text || ':' || p_request_id::text, 0));
  if p_external_order_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'generic-sale-order:' || p_organization_id::text || ':' || p_order_namespace || ':' || btrim(p_external_order_id), 0));
  end if;

  select * into v_sale from public.sales
  where actor_user_id = p_actor_user_id and location_id = p_location_id and request_id = p_request_id
  for update;
  if found then
    if v_sale.organization_id <> p_organization_id or v_sale.source <> p_source
       or v_sale.external_order_id is distinct from nullif(btrim(p_external_order_id), '')
       or v_sale.order_namespace is distinct from p_order_namespace
       or v_sale.payload_hash <> v_payload_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return jsonb_build_object('sale_id', v_sale.id, 'status', v_sale.status, 'replayed', true,
      'total_incl_gst', v_sale.total_incl_gst);
  end if;

  if p_external_order_id is not null then
    select * into v_sale from public.sales
    where organization_id = p_organization_id and order_namespace = p_order_namespace
      and external_order_id = nullif(btrim(p_external_order_id), '')
    for update;
    if found then
      if v_sale.payload_hash <> v_payload_hash or v_sale.location_id <> p_location_id then
        raise exception 'EXTERNAL_ORDER_REUSED' using errcode = '22023';
      end if;
      return jsonb_build_object('sale_id', v_sale.id, 'status', v_sale.status, 'replayed', true,
        'total_incl_gst', v_sale.total_incl_gst);
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) as x(item)
    where jsonb_typeof(x.item) <> 'object'
      or coalesce(x.item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(x.item->>'quantity', '') !~ '^[1-9][0-9]*$'
      or x.item ? 'unit_price_incl_gst'
  ) then
    raise exception 'INVALID_SALE_ITEM' using errcode = '22023';
  end if;
  select count(*), count(distinct (item->>'product_id')::uuid)
  into v_existing_item_count, v_line_position
  from jsonb_array_elements(p_items) as x(item);
  if v_existing_item_count <> v_line_position then
    raise exception 'DUPLICATE_SALE_PRODUCT' using errcode = '22023';
  end if;
  v_line_position := 0;

  insert into public.sales(
    organization_id, location_id, request_id, actor_user_id, source,
    order_namespace, external_order_id, payload_hash, status
  ) values (
    p_organization_id, p_location_id, p_request_id, p_actor_user_id, p_source,
    p_order_namespace, nullif(btrim(p_external_order_id), ''), v_payload_hash, 'committing'
  ) returning * into v_sale;

  for v_item in
    select item from jsonb_array_elements(p_items) as x(item)
    order by (item->>'product_id')::uuid
  loop
    v_line_position := v_line_position + 1;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id = v_product_id and active;
    if not found then
      raise exception 'SALE_PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
    select * into v_balance from public.inventory_balances
    where product_id = v_product_id and location_id = p_location_id for update;
    if not found then
      raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_balance.on_hand - v_balance.reserved < v_quantity then
      raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
    end if;
    -- Price authority is server-side only: the caller (staff terminal or
    -- trusted webhook) can never assert a unit price. It is always derived
    -- from the product's own retail price record.
    v_unit_price := private.product_sale_price(v_product_id, 'retail');
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'SALE_PRICE_REQUIRED' using errcode = '22023';
    end if;
    -- Line-rounded GST, matching the existing finance calculation
    -- (round(line_total / 11, 2)) rather than rounding a per-unit tax and
    -- multiplying, which can disagree on multi-quantity decimal prices.
    v_line_total := round((v_unit_price * v_quantity)::numeric, 2);
    v_tax_amount := round((v_line_total / 11)::numeric, 2);
    v_movement_request_id := (md5(p_request_id::text || ':' || v_product_id::text))::uuid;

    update public.inventory_balances
    set on_hand = on_hand - v_quantity, updated_at = now()
    where product_id = v_product_id and location_id = p_location_id;
    insert into public.inventory_movements(
      request_id, product_id, location_id, quantity_delta, movement_type,
      reason, source_type, source_id, cost_snapshot, actor_user_id
    ) values (
      v_movement_request_id, v_product_id, p_location_id, -v_quantity, 'stock_out',
      'Generic sale', 'generic_sale', v_sale.id::text, v_balance.weighted_average_cost, p_actor_user_id
    ) returning id into v_movement_id;
    insert into public.sale_items(
      sale_id, line_position, product_id, inventory_movement_id, sku_snapshot,
      name_snapshot, description_snapshot, quantity, unit_price_incl_gst,
      tax_amount, unit_cost_snapshot, line_total_incl_gst
    ) values (
      v_sale.id, v_line_position, v_product_id, v_movement_id, v_product.part_reference,
      v_product.name, v_product.name, v_quantity, v_unit_price, v_tax_amount,
      v_balance.weighted_average_cost, v_line_total
    );
    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + v_tax_amount;
  end loop;

  -- A trusted payment source can supply the amount it actually collected.
  -- Reject the whole sale rather than silently trusting either figure.
  if p_expected_total is not null and p_expected_total <> v_subtotal then
    raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode = '22023';
  end if;

  update public.sales
  set status = 'committed', subtotal_incl_gst = v_subtotal, tax_amount = v_tax_total,
      total_incl_gst = v_subtotal, committed_at = now(), updated_at = now()
  where id = v_sale.id;
  insert into public.audit_events(actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details)
  values (p_actor_user_id, v_role, p_location_id, 'GENERIC_SALE_COMMITTED', 'sale', v_sale.id::text,
    jsonb_build_object('organization_id', p_organization_id, 'source', p_source,
      'external_order_id', nullif(btrim(p_external_order_id), ''), 'line_count', v_line_position,
      'total_incl_gst', v_subtotal));
  return jsonb_build_object('sale_id', v_sale.id, 'status', 'committed', 'replayed', false,
    'total_incl_gst', v_subtotal);
end;
$$;

-- Staff POS entry point. Deliberately narrow: only the acting staff member's
-- request/location/items are caller-controlled. Source is hardcoded
-- 'internal' and organization is derived from the location's own active
-- assignment, so no caller can assert a privileged source (e.g. 'stripe') or
-- select a foreign organization/location by simply naming its id.
create or replace function public.commit_sale(
  p_request_id uuid,
  p_location_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_organization_id uuid;
begin
  if v_actor is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  select organization_id into v_organization_id
  from public.organization_location_assignments
  where location_id = p_location_id and active;
  if not found then
    raise exception 'ORGANIZATION_LOCATION_NOT_ASSIGNED' using errcode = '23514';
  end if;
  return private.commit_sale(p_request_id, v_actor, v_organization_id, p_location_id,
    'internal', null, null, p_items, null);
end;
$$;

-- The organization, location, sale source, order-identity namespace and
-- expected currency are never caller-supplied. They are looked up from
-- private.sales_channel_configs by provider, which only an admin can bind
-- (public.admin_upsert_sales_channel_config). An unconfigured or inactive
-- provider fails closed before any durable row is written: this is what
-- prevents a generic webhook credential from being redirected to select an
-- arbitrary organization, and what keeps unrelated/unrecognised source
-- values from bypassing authorization entirely.
create or replace function public.process_paid_sale_webhook(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_actor_user_id uuid,
  p_external_order_id text,
  p_amount_total numeric,
  p_currency text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.processed_webhook_events%rowtype;
  v_config private.sales_channel_configs%rowtype;
  v_result jsonb;
  v_request_id uuid;
  v_error_code text;
  v_is_paid_event boolean;
begin
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_-]{1,63}$' or nullif(btrim(p_event_id), '') is null
     or nullif(btrim(p_event_type), '') is null or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
     or p_actor_user_id is null then
    raise exception 'INVALID_WEBHOOK_EVENT' using errcode = '22023';
  end if;
  v_is_paid_event := p_event_type in ('checkout.session.completed', 'payment_intent.succeeded', 'order.paid');

  -- Fail closed on an unconfigured/inactive provider before any row is
  -- persisted: an unrecognised source is not a business event worth
  -- ledgering, and this is the sole binding that authorizes org/location.
  select * into v_config from private.sales_channel_configs
  where provider = p_provider and active;
  if not found then
    raise exception 'UNKNOWN_PROVIDER' using errcode = '42501';
  end if;

  -- Distinct provider events must share a durable business identity. Without
  -- this key, the external-order uniqueness guard cannot prevent double sales.
  if v_is_paid_event and nullif(btrim(p_external_order_id), '') is null then
    raise exception 'WEBHOOK_ORDER_REQUIRED' using errcode = '22023';
  end if;
  if v_is_paid_event and (p_amount_total is null or p_amount_total < 0) then
    raise exception 'PAYMENT_AMOUNT_REQUIRED' using errcode = '22023';
  end if;
  if v_is_paid_event and (p_currency is null or upper(btrim(p_currency)) <> v_config.expected_currency) then
    raise exception 'PAYMENT_CURRENCY_MISMATCH' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'generic-webhook:' || p_provider || ':' || p_event_id, 0));
  select * into v_event from public.processed_webhook_events
  where provider = p_provider and event_id = btrim(p_event_id) for update;
  if found then
    if v_event.payload_hash <> p_payload_hash or v_event.event_type <> p_event_type
       or v_event.external_order_id is distinct from nullif(btrim(p_external_order_id), '') then
      raise exception 'WEBHOOK_EVENT_REUSED' using errcode = '22023';
    end if;
    return jsonb_build_object('status', v_event.status, 'sale_id', v_event.sale_id, 'replayed', true,
      'error_code', v_event.error_code);
  end if;

  insert into public.processed_webhook_events(
    provider, event_id, event_type, external_order_id, organization_id,
    location_id, payload_hash, status
  ) values (
    p_provider, btrim(p_event_id), btrim(p_event_type), nullif(btrim(p_external_order_id), ''),
    v_config.organization_id, v_config.location_id, p_payload_hash, 'processing'
  ) returning * into v_event;

  -- Refund notifications are ledgered but never restock. A physical return
  -- remains the explicit, separately idempotent customer-return workflow.
  if not v_is_paid_event then
    update public.processed_webhook_events
    set status = 'ignored', processed_at = now(), updated_at = now()
    where id = v_event.id;
    return jsonb_build_object('status', 'ignored', 'replayed', false);
  end if;

  v_request_id := (md5(p_provider || ':' || btrim(p_event_id)))::uuid;
  begin
    v_result := private.commit_sale(v_request_id, p_actor_user_id, v_config.organization_id,
      v_config.location_id, v_config.source, v_config.order_namespace, p_external_order_id, p_items,
      p_amount_total);
    update public.processed_webhook_events
    set status = 'completed', sale_id = (v_result->>'sale_id')::uuid,
        processed_at = now(), updated_at = now()
    where id = v_event.id;
    return v_result || jsonb_build_object('webhook_status', 'completed');
  exception
    -- A serialization failure or deadlock is retryable, not a real business
    -- rejection. Re-raise so the whole transaction rolls back (including the
    -- event insert above) instead of durably recording a 'failed' event that
    -- would never be reprocessed.
    when sqlstate '40001' or sqlstate '40P01' then
      raise;
    when others then
      get stacked diagnostics v_error_code = returned_sqlstate;
      update public.processed_webhook_events
      set status = 'failed', error_code = coalesce(v_error_code, 'P0001'),
          error_message = left(sqlerrm, 500), processed_at = now(), updated_at = now()
      where id = v_event.id;
      return jsonb_build_object('status', 'failed', 'error_code', coalesce(v_error_code, 'P0001'));
  end;
end;
$$;

revoke execute on function private.assert_organization_location_scope(uuid, uuid),
  private.assert_sale_actor(uuid, uuid),
  private.commit_sale(uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric)
from public, anon, authenticated, service_role;
revoke execute on function public.admin_assign_organization_location(uuid, uuid, boolean),
  public.admin_upsert_sales_channel_config(text, uuid, uuid, text, text, text, boolean),
  public.commit_sale(uuid, uuid, jsonb),
  public.process_paid_sale_webhook(text, text, text, text, uuid, text, numeric, text, jsonb)
from public, anon, authenticated, service_role;
-- Hosted projects can grant authenticated EXECUTE through default privileges.
-- Reset every API role above before granting only the intended entry points.
grant execute on function public.admin_assign_organization_location(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_upsert_sales_channel_config(text, uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.commit_sale(uuid, uuid, jsonb) to authenticated;
grant execute on function public.process_paid_sale_webhook(text, text, text, text, uuid, text, numeric, text, jsonb) to service_role;
