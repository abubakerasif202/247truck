-- Phase 2A purchasing foundation: Manager purchasing permissions, suppliers,
-- product/supplier relationships, and location-specific preferred suppliers.
-- Depends on Phase 1 identity, product catalogue, and inventory settings.

-- Manager purchasing permissions ------------------------------------------------

alter table public.manager_permissions
  drop constraint manager_permissions_permission_key_check;

alter table public.manager_permissions
  add constraint manager_permissions_permission_key_check check (
    permission_key in (
      'inventory.view',
      'inventory.stock_in',
      'inventory.stock_out',
      'inventory.adjust',
      'inventory.view_cost',
      'inventory.edit_global_price',
      'purchasing.view',
      'purchasing.create_po',
      'purchasing.submit_po',
      'purchasing.receive_po',
      'reports.view_inventory_value'
    )
  );

-- Supplier master --------------------------------------------------------------

create table public.suppliers (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  abn text,
  contact_name text,
  phone text,
  email text,
  address text,
  payment_terms text,
  account_reference text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank_check check (btrim(name) <> '')
);

create table public.product_suppliers (
  product_id uuid not null references public.products (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  supplier_sku text,
  last_cost numeric(14, 4)
    check (last_cost is null or last_cost >= 0),
  typical_lead_days integer
    check (typical_lead_days is null or typical_lead_days >= 0),
  minimum_order_qty integer not null default 1
    check (minimum_order_qty > 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, supplier_id)
);

alter table public.inventory_settings
  add column preferred_supplier_id uuid
  references public.suppliers (id) on delete set null;

create index suppliers_active_name_idx
  on public.suppliers (active, lower(name));
create index product_suppliers_supplier_idx
  on public.product_suppliers (supplier_id);
create index inventory_settings_preferred_supplier_idx
  on public.inventory_settings (preferred_supplier_id);

create trigger suppliers_touch_updated_at
before update on public.suppliers
for each row execute function private.touch_updated_at();

create trigger product_suppliers_touch_updated_at
before update on public.product_suppliers
for each row execute function private.touch_updated_at();

-- RLS + least-privilege grants -------------------------------------------------

alter table public.suppliers enable row level security;
alter table public.product_suppliers enable row level security;

revoke all on public.suppliers from public, anon, authenticated, service_role;
revoke all on public.product_suppliers from public, anon, authenticated, service_role;

-- Supplier contact/account metadata is operationally safe. Managers require
-- purchasing.view and see active suppliers only; Admin sees archived suppliers.
grant select (
  id, name, abn, contact_name, phone, email, address, payment_terms,
  account_reference, notes, active, created_at, updated_at
) on public.suppliers to authenticated;

-- last_cost is deliberately omitted. RLS is row-level only, so cost protection
-- must also exist at the column-grant layer. A later cost-gated read interface
-- may reveal it only to inventory.view_cost users.
grant select (
  product_id, supplier_id, supplier_sku, typical_lead_days,
  minimum_order_qty, updated_at
) on public.product_suppliers to authenticated;

grant select, insert, update, delete on public.suppliers to service_role;
grant select, insert, update, delete on public.product_suppliers to service_role;

create policy suppliers_read_access
on public.suppliers
for select
to authenticated
using (
  (select private.app_is_admin())
  or (
    active
    and (select private.app_has_permission('purchasing.view'))
  )
);

create policy product_suppliers_read_access
on public.product_suppliers
for select
to authenticated
using (
  (select private.app_is_admin())
  or (
    (select private.app_has_permission('purchasing.view'))
    and exists (
      select 1
      from public.suppliers as supplier
      where supplier.id = product_suppliers.supplier_id
        and supplier.active
    )
  )
);

-- Admin-only audited supplier mutations ---------------------------------------

create or replace function public.create_supplier(
  p_name text,
  p_abn text default null,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_payment_terms text default null,
  p_account_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_supplier_id uuid;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'INVALID_SUPPLIER_NAME' using errcode = '22023';
  end if;

  insert into public.suppliers (
    name, abn, contact_name, phone, email, address, payment_terms,
    account_reference, notes
  )
  values (
    btrim(p_name), nullif(btrim(p_abn), ''), nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''),
    nullif(btrim(p_address), ''), nullif(btrim(p_payment_terms), ''),
    nullif(btrim(p_account_reference), ''), nullif(btrim(p_notes), '')
  )
  returning id into v_supplier_id;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type,
    entity_type, entity_id, details
  )
  values (
    v_actor, 'admin', null, 'SUPPLIER_CREATED',
    'supplier', v_supplier_id::text,
    jsonb_build_object(
      'name', btrim(p_name),
      'account_reference', nullif(btrim(p_account_reference), '')
    )
  );

  return v_supplier_id;
end;
$$;

create or replace function public.update_supplier(
  p_supplier_id uuid,
  p_name text,
  p_abn text default null,
  p_contact_name text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_payment_terms text default null,
  p_account_reference text default null,
  p_notes text default null
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

  if p_name is null or btrim(p_name) = '' then
    raise exception 'INVALID_SUPPLIER_NAME' using errcode = '22023';
  end if;

  update public.suppliers
  set
    name = btrim(p_name),
    abn = nullif(btrim(p_abn), ''),
    contact_name = nullif(btrim(p_contact_name), ''),
    phone = nullif(btrim(p_phone), ''),
    email = nullif(btrim(p_email), ''),
    address = nullif(btrim(p_address), ''),
    payment_terms = nullif(btrim(p_payment_terms), ''),
    account_reference = nullif(btrim(p_account_reference), ''),
    notes = nullif(btrim(p_notes), '')
  where id = p_supplier_id;

  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type,
    entity_type, entity_id, details
  )
  values (
    v_actor, 'admin', null, 'SUPPLIER_UPDATED',
    'supplier', p_supplier_id::text,
    jsonb_build_object(
      'name', btrim(p_name),
      'account_reference', nullif(btrim(p_account_reference), '')
    )
  );
end;
$$;

create or replace function public.set_supplier_active(
  p_supplier_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  update public.suppliers
  set active = p_active
  where id = p_supplier_id
  returning name into v_name;

  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type,
    entity_type, entity_id, details
  )
  values (
    v_actor, 'admin', null,
    case when p_active then 'SUPPLIER_RESTORED' else 'SUPPLIER_ARCHIVED' end,
    'supplier', p_supplier_id::text,
    jsonb_build_object('name', v_name, 'active', p_active)
  );
end;
$$;

revoke execute on function public.create_supplier(
  text, text, text, text, text, text, text, text, text
) from public, anon, service_role;
revoke execute on function public.update_supplier(
  uuid, text, text, text, text, text, text, text, text, text
) from public, anon, service_role;
revoke execute on function public.set_supplier_active(uuid, boolean)
  from public, anon, service_role;

grant execute on function public.create_supplier(
  text, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.update_supplier(
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.set_supplier_active(uuid, boolean)
  to authenticated;
