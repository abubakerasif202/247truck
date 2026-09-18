-- A supplier may ship less than ordered and cancel or never deliver the
-- remainder. cancel_purchase_order only accepts
-- ('draft','submitted','approved','sent','rejected') -- it deliberately
-- refuses 'partially_received' so a real receipt can never be discarded by a
-- "cancellation". But nothing ever wrote 'closed' or closed_at either
-- (both already existed in the schema/status CHECK with no writer), so a
-- short-shipped purchase order was a permanent dead end: uncancellable,
-- unreceivable-further in any useful sense, and permanently inflating
-- "awaiting receipt" counts.
--
-- close_purchase_order is the explicit, Admin-only terminal transition for
-- that case. It only ever touches the purchase_orders header row -- it never
-- writes purchase_order_lines, goods_receipts, goods_receipt_lines, or posts
-- any inventory movement, so already-received quantities, existing GRNs, and
-- historic receipt costs are untouched. Like cancel_purchase_order, it
-- requires a non-empty reason and is not a distinct no-op on retry -- a
-- second call finds the order already 'closed', not 'partially_received',
-- and raises PO_CANNOT_CLOSE, so a retried request cannot corrupt or
-- double-apply anything.
alter table public.purchase_orders
  add column if not exists closed_by uuid references auth.users (id),
  add column if not exists closed_reason text;

create or replace function public.close_purchase_order(
  p_purchase_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_po public.purchase_orders%rowtype;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'CLOSE_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_po.status <> 'partially_received' then
    raise exception 'PO_CANNOT_CLOSE' using errcode = '55000';
  end if;

  update public.purchase_orders
  set status = 'closed',
      closed_at = now(),
      closed_by = v_actor,
      closed_reason = btrim(p_reason),
      updated_at = now()
  where id = p_purchase_order_id;

  perform private.audit_purchase_order(
    p_purchase_order_id,
    v_po.location_id,
    'PURCHASE_ORDER_CLOSED',
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

revoke execute on function public.close_purchase_order(uuid, text)
  from public, anon, service_role;
grant execute on function public.close_purchase_order(uuid, text)
  to authenticated;

-- Expose the new columns the same way rejection_reason/cancellation_reason
-- already are. Adding columns to a RETURNS TABLE changes the function's
-- return type, which CREATE OR REPLACE FUNCTION cannot do -- drop it first.
drop function if exists public.purchase_order_detail(uuid);

create function public.purchase_order_detail(p_purchase_order_id uuid)
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
  closed_at timestamptz,
  rejection_reason text,
  cancellation_reason text,
  closed_reason text,
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
    po.closed_at,
    po.rejection_reason,
    po.cancellation_reason,
    po.closed_reason,
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

revoke execute on function public.purchase_order_detail(uuid)
  from public, anon, service_role;
grant execute on function public.purchase_order_detail(uuid) to authenticated;
