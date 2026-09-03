-- Task 4 purchase-order application support.
-- Atomically updates an editable PO header + replacement lines through one RPC.
-- The location and generated PO number are intentionally immutable.

create or replace function public.update_purchase_order_draft(
  p_purchase_order_id uuid,
  p_supplier_id uuid,
  p_notes text default null,
  p_supplier_reference text default null,
  p_lines jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  select *
  into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform private.assert_purchase_order_scope(
    v_po.location_id,
    'purchasing.create_po'
  );

  if v_po.status not in ('draft', 'rejected') then
    raise exception 'PO_NOT_EDITABLE' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.suppliers as supplier
    where supplier.id = p_supplier_id
      and supplier.active
  ) then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.purchase_orders
  set supplier_id = p_supplier_id,
      supplier_reference = nullif(btrim(p_supplier_reference), ''),
      notes = nullif(btrim(p_notes), '')
  where id = p_purchase_order_id;

  -- Uses the possibly updated supplier_id when snapshotting supplier SKU.
  -- Any failure here rolls back the header changes above.
  perform public.replace_purchase_order_lines(
    p_purchase_order_id,
    p_lines
  );

  perform private.audit_purchase_order(
    p_purchase_order_id,
    v_po.location_id,
    'PURCHASE_ORDER_DRAFT_UPDATED',
    jsonb_build_object('supplier_id', p_supplier_id)
  );
end;
$$;

revoke execute on function public.update_purchase_order_draft(uuid, uuid, text, text, jsonb)
  from public, anon, service_role;

grant execute on function public.update_purchase_order_draft(uuid, uuid, text, text, jsonb)
  to authenticated;
