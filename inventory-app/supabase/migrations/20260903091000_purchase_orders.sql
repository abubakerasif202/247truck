-- Phase 2A purchase orders: location document numbering, branch-scoped PO
-- lifecycle, Admin approval/rejection, cost-safe reads, and audit history.
-- Depends on supplier purchasing foundation 20260903090000.

-- Reusable location document numbering ---------------------------------------

create table public.document_sequences (
  location_id uuid not null references public.locations (id),
  document_type text not null,
  last_number bigint not null default 0 check (last_number >= 0),
  primary key (location_id, document_type),
  constraint document_sequences_type_not_blank_check check (btrim(document_type) <> '')
);

alter table public.document_sequences enable row level security;
revoke all on public.document_sequences from public, anon, authenticated, service_role;
grant select on public.document_sequences to service_role;

create or replace function private.next_location_document_number(
  p_location_id uuid,
  p_document_type text,
  p_label text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_code text;
  v_number bigint;
begin
  if p_location_id is null
    or p_document_type is null or btrim(p_document_type) = ''
    or p_label is null or btrim(p_label) = '' then
    raise exception 'INVALID_DOCUMENT_SEQUENCE' using errcode = '22023';
  end if;

  select location.code
  into v_location_code
  from public.locations as location
  where location.id = p_location_id
    and location.active;

  if not found then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.document_sequences (location_id, document_type, last_number)
  values (p_location_id, btrim(p_document_type), 1)
  on conflict (location_id, document_type) do update
    set last_number = public.document_sequences.last_number + 1
  returning last_number into v_number;

  return format('%s-%s-%s',
    v_location_code,
    upper(btrim(p_label)),
    lpad(v_number::text, 6, '0')
  );
end;
$$;

revoke execute on function private.next_location_document_number(uuid, text, text)
  from public, anon, authenticated, service_role;

-- Purchase order records -----------------------------------------------------

create table public.purchase_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  supplier_id uuid not null references public.suppliers (id),
  po_number text not null unique,
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'approved', 'sent', 'partially_received',
    'received', 'closed', 'rejected', 'cancelled'
  )),
  supplier_reference text,
  notes text,
  rejection_reason text,
  cancellation_reason text,
  created_by uuid not null references auth.users (id),
  submitted_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  rejected_by uuid references auth.users (id),
  sent_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  sent_at timestamptz,
  closed_at timestamptz
);

create table public.purchase_order_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  description_snapshot text not null,
  supplier_sku_snapshot text,
  ordered_quantity integer not null check (ordered_quantity > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  received_quantity integer not null default 0 check (
    received_quantity >= 0 and received_quantity <= ordered_quantity
  ),
  notes text,
  unique (purchase_order_id, product_id)
);

create index purchase_orders_location_status_created_idx
  on public.purchase_orders (location_id, status, created_at desc);
create index purchase_orders_supplier_status_idx
  on public.purchase_orders (supplier_id, status);
create index purchase_order_lines_product_idx
  on public.purchase_order_lines (product_id);

create trigger purchase_orders_touch_updated_at
before update on public.purchase_orders
for each row execute function private.touch_updated_at();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

revoke all on public.purchase_orders from public, anon, authenticated, service_role;
revoke all on public.purchase_order_lines from public, anon, authenticated, service_role;

-- Header metadata has no cost fields and can be read by purchasing users in
-- their permitted scope. All mutations stay RPC-only.
grant select on public.purchase_orders to authenticated;

-- RLS is row-level, not column-level. Cost is deliberately omitted here and is
-- exposed only through permission-gated read RPCs below.
grant select (
  id, purchase_order_id, product_id, description_snapshot,
  supplier_sku_snapshot, ordered_quantity, received_quantity, notes
) on public.purchase_order_lines to authenticated;

grant select on public.purchase_orders to service_role;
grant select on public.purchase_order_lines to service_role;

create policy purchase_orders_read_access
on public.purchase_orders
for select
to authenticated
using (
  (select private.app_has_permission('purchasing.view'))
  and (
    (select private.app_is_admin())
    or location_id = (select private.app_user_location_id())
  )
);

create policy purchase_order_lines_read_access
on public.purchase_order_lines
for select
to authenticated
using (
  (select private.app_has_permission('purchasing.view'))
  and exists (
    select 1
    from public.purchase_orders as po
    where po.id = purchase_order_lines.purchase_order_id
      and (
        (select private.app_is_admin())
        or po.location_id = (select private.app_user_location_id())
      )
  )
);

-- Internal helpers -----------------------------------------------------------

create or replace function private.purchase_order_actor_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.user_profiles as profile
  where profile.user_id = (select auth.uid())
    and profile.active;
$$;

create or replace function private.assert_purchase_order_scope(
  p_location_id uuid,
  p_permission_key text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.app_has_permission(p_permission_key)) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if not (select private.app_is_admin())
    and p_location_id is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.audit_purchase_order(
  p_purchase_order_id uuid,
  p_location_id uuid,
  p_event_type text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := (select private.purchase_order_actor_role());
begin
  if v_role not in ('admin', 'manager') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type,
    entity_type, entity_id, details
  )
  values (
    (select auth.uid()), v_role, p_location_id, p_event_type,
    'purchase_order', p_purchase_order_id::text, coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke execute on function private.purchase_order_actor_role()
  from public, anon, authenticated, service_role;
revoke execute on function private.assert_purchase_order_scope(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.audit_purchase_order(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

-- Create / edit --------------------------------------------------------------

create or replace function public.create_purchase_order(
  p_location_id uuid,
  p_supplier_id uuid,
  p_notes text default null,
  p_supplier_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_po_id uuid;
  v_po_number text;
begin
  perform private.assert_purchase_order_scope(p_location_id, 'purchasing.create_po');

  if not exists (
    select 1
    from public.locations as location
    where location.id = p_location_id and location.active
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.suppliers as supplier
    where supplier.id = p_supplier_id and supplier.active
  ) then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_po_number := private.next_location_document_number(p_location_id, 'purchase_order', 'PO');

  insert into public.purchase_orders (
    location_id, supplier_id, po_number, status, supplier_reference,
    notes, created_by
  )
  values (
    p_location_id, p_supplier_id, v_po_number, 'draft',
    nullif(btrim(p_supplier_reference), ''), nullif(btrim(p_notes), ''), v_actor
  )
  returning id into v_po_id;

  perform private.audit_purchase_order(
    v_po_id,
    p_location_id,
    'PURCHASE_ORDER_CREATED',
    jsonb_build_object('po_number', v_po_number, 'supplier_id', p_supplier_id)
  );

  return v_po_id;
end;
$$;

create or replace function public.replace_purchase_order_lines(
  p_purchase_order_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
-- Intentionally one transaction: validation finishes before old lines are
-- deleted, so a malformed replacement can never leave a draft half-written.
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_line jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_cost numeric(14, 4);
  v_notes text;
  v_product_name text;
  v_supplier_sku text;
  v_seen uuid[] := '{}'::uuid[];
begin
  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform private.assert_purchase_order_scope(v_po.location_id, 'purchasing.create_po');

  if v_po.status not in ('draft', 'rejected') then
    raise exception 'PO_NOT_EDITABLE' using errcode = '55000';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'INVALID_PO_LINES' using errcode = '22023';
  end if;

  -- Validate every replacement row before mutating existing lines.
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_product_id := (v_line ->> 'product_id')::uuid;
      v_quantity := (v_line ->> 'ordered_quantity')::integer;
      v_unit_cost := (v_line ->> 'unit_cost')::numeric(14, 4);
    exception when others then
      raise exception 'INVALID_PO_LINES' using errcode = '22023';
    end;

    if v_product_id is null
      or v_quantity is null or v_quantity <= 0
      or v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'INVALID_PO_LINES' using errcode = '22023';
    end if;

    if v_product_id = any(v_seen) then
      raise exception 'DUPLICATE_PO_PRODUCT' using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_product_id);

    select product.name
    into v_product_name
    from public.products as product
    where product.id = v_product_id
      and product.active;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
  end loop;

  delete from public.purchase_order_lines
  where purchase_order_id = p_purchase_order_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line ->> 'product_id')::uuid;
    v_quantity := (v_line ->> 'ordered_quantity')::integer;
    v_unit_cost := (v_line ->> 'unit_cost')::numeric(14, 4);
    v_notes := nullif(btrim(v_line ->> 'notes'), '');

    select product.name
    into v_product_name
    from public.products as product
    where product.id = v_product_id;

    select link.supplier_sku
    into v_supplier_sku
    from public.product_suppliers as link
    where link.product_id = v_product_id
      and link.supplier_id = v_po.supplier_id;

    insert into public.purchase_order_lines (
      purchase_order_id, product_id, description_snapshot,
      supplier_sku_snapshot, ordered_quantity, unit_cost, notes
    )
    values (
      p_purchase_order_id, v_product_id, v_product_name,
      v_supplier_sku, v_quantity, v_unit_cost, v_notes
    );
  end loop;

  -- Editing a rejected PO reopens it as a draft before resubmission.
  if v_po.status = 'rejected' then
    update public.purchase_orders
    set status = 'draft',
        rejection_reason = null,
        rejected_by = null,
        rejected_at = null
    where id = p_purchase_order_id;
  end if;

  perform private.audit_purchase_order(
    p_purchase_order_id,
    v_po.location_id,
    'PURCHASE_ORDER_LINES_REPLACED',
    jsonb_build_object('line_count', jsonb_array_length(p_lines))
  );
end;
$$;

-- Lifecycle ------------------------------------------------------------------

create or replace function public.submit_purchase_order(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform private.assert_purchase_order_scope(v_po.location_id, 'purchasing.submit_po');

  if v_po.status not in ('draft', 'rejected') then
    raise exception 'PO_CANNOT_SUBMIT' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.purchase_order_lines as line
    where line.purchase_order_id = p_purchase_order_id
  ) then
    raise exception 'PO_LINES_REQUIRED' using errcode = '23514';
  end if;

  update public.purchase_orders
  set status = 'submitted',
      submitted_by = (select auth.uid()),
      submitted_at = now(),
      rejection_reason = null,
      rejected_by = null,
      rejected_at = null
  where id = p_purchase_order_id;

  perform private.audit_purchase_order(
    p_purchase_order_id, v_po.location_id, 'PURCHASE_ORDER_SUBMITTED'
  );
end;
$$;

create or replace function public.approve_purchase_order(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_po.status <> 'submitted' then
    raise exception 'PO_CANNOT_APPROVE' using errcode = '55000';
  end if;

  update public.purchase_orders
  set status = 'approved',
      approved_by = (select auth.uid()),
      approved_at = now()
  where id = p_purchase_order_id;

  perform private.audit_purchase_order(
    p_purchase_order_id, v_po.location_id, 'PURCHASE_ORDER_APPROVED'
  );
end;
$$;

create or replace function public.reject_purchase_order(
  p_purchase_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REJECTION_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_po.status <> 'submitted' then
    raise exception 'PO_CANNOT_REJECT' using errcode = '55000';
  end if;

  update public.purchase_orders
  set status = 'rejected',
      rejection_reason = btrim(p_reason),
      rejected_by = (select auth.uid()),
      rejected_at = now()
  where id = p_purchase_order_id;

  perform private.audit_purchase_order(
    p_purchase_order_id,
    v_po.location_id,
    'PURCHASE_ORDER_REJECTED',
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

create or replace function public.mark_purchase_order_sent(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_po.status <> 'approved' then
    raise exception 'PO_CANNOT_MARK_SENT' using errcode = '55000';
  end if;

  update public.purchase_orders
  set status = 'sent',
      sent_by = (select auth.uid()),
      sent_at = now()
  where id = p_purchase_order_id;

  perform private.audit_purchase_order(
    p_purchase_order_id, v_po.location_id, 'PURCHASE_ORDER_SENT'
  );
end;
$$;

create or replace function public.cancel_purchase_order(
  p_purchase_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'CANCELLATION_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_po.status not in ('draft', 'submitted', 'approved', 'sent', 'rejected') then
    raise exception 'PO_CANNOT_CANCEL' using errcode = '55000';
  end if;

  update public.purchase_orders
  set status = 'cancelled',
      cancellation_reason = btrim(p_reason)
  where id = p_purchase_order_id;

  perform private.audit_purchase_order(
    p_purchase_order_id,
    v_po.location_id,
    'PURCHASE_ORDER_CANCELLED',
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

-- Cost-safe read interfaces --------------------------------------------------

create or replace function public.purchase_order_detail(p_purchase_order_id uuid)
returns table (
  purchase_order_id uuid,
  po_number text,
  location_id uuid,
  location_code text,
  supplier_id uuid,
  supplier_name text,
  status text,
  supplier_reference text,
  purchase_order_notes text,
  created_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  sent_at timestamptz,
  rejection_reason text,
  cancellation_reason text,
  line_id uuid,
  product_id uuid,
  product_name text,
  supplier_sku text,
  ordered_quantity integer,
  received_quantity integer,
  unit_cost numeric,
  line_notes text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
begin
  if not (select private.app_has_permission('purchasing.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  select po.location_id
  into v_location_id
  from public.purchase_orders as po
  where po.id = p_purchase_order_id;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (select private.app_is_admin())
    and v_location_id is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    po.id,
    po.po_number,
    po.location_id,
    location.code,
    po.supplier_id,
    supplier.name,
    po.status,
    po.supplier_reference,
    po.notes,
    po.created_at,
    po.submitted_at,
    po.approved_at,
    po.rejected_at,
    po.sent_at,
    po.rejection_reason,
    po.cancellation_reason,
    line.id,
    line.product_id,
    line.description_snapshot,
    line.supplier_sku_snapshot,
    line.ordered_quantity,
    line.received_quantity,
    case
      when (select private.app_has_permission('inventory.view_cost'))
      then line.unit_cost
      else null::numeric
    end,
    line.notes
  from public.purchase_orders as po
  join public.locations as location on location.id = po.location_id
  join public.suppliers as supplier on supplier.id = po.supplier_id
  left join public.purchase_order_lines as line on line.purchase_order_id = po.id
  where po.id = p_purchase_order_id
  order by line.id;
end;
$$;

create or replace function public.purchase_order_summary(
  p_location_id uuid default null,
  p_status text default null
)
returns table (
  purchase_order_id uuid,
  po_number text,
  location_id uuid,
  location_code text,
  supplier_id uuid,
  supplier_name text,
  status text,
  created_at timestamptz,
  ordered_total numeric,
  ordered_quantity bigint,
  outstanding_quantity bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.app_has_permission('purchasing.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if not (select private.app_is_admin()) then
    if p_location_id is not null
      and p_location_id is distinct from (select private.app_user_location_id()) then
      raise exception 'ACCESS_DENIED' using errcode = '42501';
    end if;
  end if;

  return query
  select
    po.id,
    po.po_number,
    po.location_id,
    location.code,
    po.supplier_id,
    supplier.name,
    po.status,
    po.created_at,
    case
      when (select private.app_has_permission('inventory.view_cost'))
      then coalesce(sum(line.ordered_quantity * line.unit_cost), 0::numeric)
      else null::numeric
    end as ordered_total,
    coalesce(sum(line.ordered_quantity), 0)::bigint,
    coalesce(sum(line.ordered_quantity - line.received_quantity), 0)::bigint
  from public.purchase_orders as po
  join public.locations as location on location.id = po.location_id
  join public.suppliers as supplier on supplier.id = po.supplier_id
  left join public.purchase_order_lines as line on line.purchase_order_id = po.id
  where (p_status is null or po.status = p_status)
    and (p_location_id is null or po.location_id = p_location_id)
    and (
      (select private.app_is_admin())
      or po.location_id = (select private.app_user_location_id())
    )
  group by po.id, location.code, supplier.name
  order by po.created_at desc;
end;
$$;

-- Explicit least-privilege function grants ----------------------------------

revoke execute on function public.create_purchase_order(uuid, uuid, text, text)
  from public, anon, service_role;
revoke execute on function public.replace_purchase_order_lines(uuid, jsonb)
  from public, anon, service_role;
revoke execute on function public.submit_purchase_order(uuid)
  from public, anon, service_role;
revoke execute on function public.approve_purchase_order(uuid)
  from public, anon, service_role;
revoke execute on function public.reject_purchase_order(uuid, text)
  from public, anon, service_role;
revoke execute on function public.mark_purchase_order_sent(uuid)
  from public, anon, service_role;
revoke execute on function public.cancel_purchase_order(uuid, text)
  from public, anon, service_role;
revoke execute on function public.purchase_order_detail(uuid)
  from public, anon, service_role;
revoke execute on function public.purchase_order_summary(uuid, text)
  from public, anon, service_role;

grant execute on function public.create_purchase_order(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.replace_purchase_order_lines(uuid, jsonb)
  to authenticated;
grant execute on function public.submit_purchase_order(uuid)
  to authenticated;
grant execute on function public.approve_purchase_order(uuid)
  to authenticated;
grant execute on function public.reject_purchase_order(uuid, text)
  to authenticated;
grant execute on function public.mark_purchase_order_sent(uuid)
  to authenticated;
grant execute on function public.cancel_purchase_order(uuid, text)
  to authenticated;
grant execute on function public.purchase_order_detail(uuid)
  to authenticated;
grant execute on function public.purchase_order_summary(uuid, text)
  to authenticated;
