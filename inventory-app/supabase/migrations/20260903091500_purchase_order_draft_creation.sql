-- Task 4 purchase-order application support.
-- Creates a complete draft header + lines in one PostgreSQL transaction so the
-- server action needs exactly one authenticated RPC and cannot leave an orphan
-- header when line validation fails.

create or replace function public.create_purchase_order_draft(
  p_location_id uuid,
  p_supplier_id uuid,
  p_notes text default null,
  p_supplier_reference text default null,
  p_lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_order_id uuid;
begin
  -- Reuse the database-authoritative Task 3 functions so branch scope,
  -- permissions, supplier/product validation, numbering and audit behavior stay
  -- defined in one place. Any exception from line replacement rolls this whole
  -- function back, including the newly-created header and sequence increment.
  v_purchase_order_id := public.create_purchase_order(
    p_location_id,
    p_supplier_id,
    p_notes,
    p_supplier_reference
  );

  perform public.replace_purchase_order_lines(
    v_purchase_order_id,
    p_lines
  );

  return v_purchase_order_id;
end;
$$;

revoke execute on function public.create_purchase_order_draft(uuid, uuid, text, text, jsonb)
  from public, anon, service_role;

grant execute on function public.create_purchase_order_draft(uuid, uuid, text, text, jsonb)
  to authenticated;
