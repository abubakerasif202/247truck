-- Read-only reconciliation between stored on_hand balances and the
-- authoritative inventory_movements ledger. Every stock-changing RPC writes
-- both a movement row and updates inventory_balances in the same
-- transaction (verified: no direct balance writes exist outside the
-- sanctioned RPCs), so under correct operation ledger_quantity always equals
-- stored_quantity. A mismatch here indicates a real bug or data corruption,
-- not routine business variance — this function never writes, it only
-- reports. Opening stock is itself a movement type ('opening_stock'), so
-- there is no historical gap to reconstruct; a product with movements but no
-- balance row (or vice versa) is still surfaced via the full outer join
-- rather than silently dropped.

create or replace function public.reconcile_inventory_ledger()
returns table (
  product_id uuid,
  product_name text,
  part_reference text,
  location_id uuid,
  location_code text,
  location_name text,
  stored_quantity integer,
  ledger_quantity bigint,
  variance bigint,
  status text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  with ledger as (
    select m.product_id, m.location_id, sum(m.quantity_delta) as ledger_quantity
    from public.inventory_movements m
    group by m.product_id, m.location_id
  ),
  combined as (
    select
      coalesce(b.product_id, l.product_id) as product_id,
      coalesce(b.location_id, l.location_id) as location_id,
      coalesce(b.on_hand, 0) as stored_quantity,
      coalesce(l.ledger_quantity, 0::bigint) as ledger_quantity
    from public.inventory_balances b
    full outer join ledger l
      on l.product_id = b.product_id and l.location_id = b.location_id
  )
  select
    c.product_id,
    p.name,
    p.part_reference,
    c.location_id,
    loc.code,
    loc.name,
    c.stored_quantity,
    c.ledger_quantity,
    (c.stored_quantity::bigint - c.ledger_quantity) as variance,
    case
      when c.stored_quantity = c.ledger_quantity then 'matched'
      when c.stored_quantity > c.ledger_quantity then 'overstated'
      else 'understated'
    end as status
  from combined c
  join public.products p on p.id = c.product_id
  join public.locations loc on loc.id = c.location_id
  order by (c.stored_quantity <> c.ledger_quantity) desc, p.name, loc.code;
end;
$$;

revoke execute on function public.reconcile_inventory_ledger() from public, anon, service_role;
grant execute on function public.reconcile_inventory_ledger() to authenticated;
