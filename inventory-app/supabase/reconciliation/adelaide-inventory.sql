-- Read-only Adelaide Wholesale Tyres reconciliation. Run with an admin/service-role connection.
-- PASS/WARN/ERROR rows are intentionally not auto-corrected.
select 'ERROR' as severity, 'duplicate_mapping' as check_name, inventory_product_id::text as subject
from public.adelaide_product_mappings group by inventory_product_id having count(*) > 1
union all
select 'WARN', 'active_expired_reservation', id::text
from public.adelaide_inventory_reservations where status = 'active' and expires_at <= now()
union all
select 'ERROR', 'impossible_balance', product_id::text || ':' || location_id::text
from public.inventory_balances where on_hand < 0 or reserved < 0 or reserved > on_hand
union all
select 'ERROR', 'adelaide_sale_missing_reservation', id::text
from public.inventory_movements where source_type = 'adelaide_wholesale_tyres' and external_reservation_id is null
union all
select 'ERROR', 'adelaide_sale_missing_reference', id::text
from public.inventory_movements where source_type = 'adelaide_wholesale_tyres' and coalesce(source_id, '') = ''
union all
select 'ERROR', 'committed_reservation_without_sale', r.id::text
from public.adelaide_inventory_reservations r
where r.status = 'committed' and not exists (
  select 1 from public.inventory_movements m where m.external_reservation_id = r.id and m.source_type = 'adelaide_wholesale_tyres'
)
union all
select 'WARN', 'mapped_product_not_currently_exposed', m.inventory_product_id::text
from public.adelaide_product_mappings m
where not exists (select 1 from public.products p where p.id = m.inventory_product_id and p.active = true)
order by severity, check_name, subject;
