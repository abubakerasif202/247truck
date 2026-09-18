-- 20260914184236_drop_legacy_awt_schema.sql dropped private.awt_checkouts on
-- the stated basis that "no views/triggers/functions depend on these
-- objects". That was incorrect: public.adelaide_integration_reconciliation()
-- (language sql, so its body is not resolved until first executed) unions in
-- a branch reading private.awt_checkouts for active reserved-quantity totals.
-- Every call to adelaide_integration_reconciliation() has raised
-- 42P01 (relation "private.awt_checkouts" does not exist) since that
-- migration ran, which silently breaks adelaide_integration_health() too,
-- since it calls adelaide_integration_reconciliation() twice, and breaks the
-- 'reconcile' branch of the scheduled Adelaide maintenance operation.
--
-- The dropped table was confirmed empty and never written
-- (20260914184236's own pre-drop audit: "awt_checkouts: 0 rows, never
-- written"), so removing its union branch changes no reconciliation result;
-- this migration is a like-for-like function body restore with only that
-- dead branch removed, not a behavior change.
create or replace function public.adelaide_integration_reconciliation()
returns table(severity text, discrepancy_type text, external_order_reference text, reservation_id uuid,
  mapping_id uuid, inventory_product_id uuid, request_id uuid, expected_quantity integer,
  actual_quantity integer, guidance text)
language sql security definer set search_path = '' as $$
  with movement_totals as (
    select external_reservation_id, product_id, sum(-quantity_delta)::integer quantity, count(*) line_count
    from public.inventory_movements where source_type = 'adelaide_wholesale_tyres' group by external_reservation_id, product_id
  ), reservation_sources as (
    select r.location_id, l.inventory_product_id, l.quantity
    from public.adelaide_inventory_reservations r join public.adelaide_inventory_reservation_lines l on l.reservation_id = r.id
    where r.status = 'active'
    union all
    select r.location_id, r.product_id, r.quantity from public.inventory_reservations r where r.status='active'
  ), reserved_totals as (
    select location_id,inventory_product_id,sum(quantity)::integer quantity from reservation_sources
    group by location_id,inventory_product_id
  )
  select 'critical'::text,'paid_without_committed_inventory'::text,o.external_order_reference,o.reservation_id,null::uuid,null::uuid,o.state_request_id,null::integer,null::integer,
    'Retry with the stable commit request ID; move to manual review after the bounded retry limit.'
  from public.adelaide_order_inventory_commits o where o.payment_status='paid' and o.inventory_state<>'committed'
  union all select 'critical','committed_without_paid_order',r.external_order_reference,r.id,null::uuid,null::uuid,r.commit_request_id,null::integer,null::integer,
    'Verify payment evidence and order validity; never delete the movement. Escalate for financial correction.'
  from public.adelaide_inventory_reservations r left join public.adelaide_order_inventory_commits o on o.reservation_id=r.id
  where r.status='committed' and coalesce(o.payment_status,'')<>'paid'
  union all select 'critical','sale_movement_without_reservation',m.source_id,m.external_reservation_id,null::uuid,m.product_id,m.id,null::integer,(-m.quantity_delta)::integer,
    'Investigate the movement source and preserve the append-only ledger.'
  from public.inventory_movements m left join public.adelaide_inventory_reservations r on r.id=m.external_reservation_id
  where m.source_type='adelaide_wholesale_tyres' and r.id is null
  union all select 'critical','committed_missing_movement_line',r.external_order_reference,r.id,l.mapping_id,l.inventory_product_id,r.commit_request_id,l.quantity,coalesce(mt.quantity,0),
    'Do not post an ad-hoc movement; use an audited forward repair after confirming the reservation.'
  from public.adelaide_inventory_reservations r join public.adelaide_inventory_reservation_lines l on l.reservation_id=r.id
  left join movement_totals mt on mt.external_reservation_id=r.id and mt.product_id=l.inventory_product_id
  where r.status='committed' and coalesce(mt.quantity,0)=0
  union all select 'critical','movement_quantity_mismatch',r.external_order_reference,r.id,l.mapping_id,l.inventory_product_id,r.commit_request_id,l.quantity,mt.quantity,
    'Preserve history and post only an authorised compensating movement after investigation.'
  from public.adelaide_inventory_reservations r join public.adelaide_inventory_reservation_lines l on l.reservation_id=r.id
  join movement_totals mt on mt.external_reservation_id=r.id and mt.product_id=l.inventory_product_id where mt.quantity<>l.quantity
  union all select 'warning','active_reservation_past_expiry',r.external_order_reference,r.id,null::uuid,null::uuid,r.request_id,null::integer,null::integer,
    'Run the protected expiry worker; paid-protected reservations must instead be committed.'
  from public.adelaide_inventory_reservations r where r.status='active' and r.expires_at<=now()
  union all select 'critical','paid_reservation_released_or_expired',o.external_order_reference,o.reservation_id,null::uuid,null::uuid,o.state_request_id,null::integer,null::integer,
    'Manual review is required; do not recreate stock movements without payment and fulfilment evidence.'
  from public.adelaide_order_inventory_commits o join public.adelaide_inventory_reservations r on r.id=o.reservation_id
  where o.payment_status='paid' and r.status in ('released','expired')
  union all select 'critical','duplicate_request_or_commit_attempt',o.external_order_reference,o.reservation_id,null::uuid,null::uuid,o.commit_request_id,1,o.attempt_count,
    'Inspect delivery history and payload hashes; stable identical retries are safe.'
  from public.adelaide_order_inventory_commits o where o.attempt_count>1 and o.last_error_code='IDEMPOTENCY_KEY_REUSED'
  union all select 'critical','duplicate_order_reference',r.external_order_reference,(array_agg(r.id order by r.id))[1],null::uuid,null::uuid,null::uuid,1,count(*)::integer,
    'Investigate duplicate legacy reservations; do not merge or delete history.'
  from public.adelaide_inventory_reservations r group by r.client_id,r.external_order_reference having count(*)>1
  union all select case when wp.active and wp.sellable then 'critical' else 'warning' end,'product_mapping_invalid',wp.website_product_id,null::uuid,wp.expected_mapping_id,m.inventory_product_id,null::uuid,null::integer,null::integer,
    'Correct the permanent mapping or catalogue attributes before deployment.'
  from public.adelaide_website_products wp left join public.adelaide_product_mappings m on m.website_product_id=wp.website_product_id and m.id=wp.expected_mapping_id
  left join public.products p on p.id=m.inventory_product_id
  left join public.tyre_brands b on b.id=p.tyre_brand_id left join public.tyre_patterns pat on pat.id=p.tyre_pattern_id
  left join public.tyre_sizes s on s.id=p.tyre_size_id
  where m.id is null or not p.active or upper(b.normalized_name)<>upper(wp.brand) or upper(pat.normalized_name)<>upper(wp.pattern)
    or upper(s.normalized_size)<>upper(wp.tyre_size) or p.tyre_condition<>wp.tyre_condition
    or not exists(select 1 from public.inventory_balances ib where ib.product_id=p.id and ib.location_id=wp.intended_location_id)
  union all select 'critical','reserved_total_mismatch',null::text,null::uuid,null::uuid,b.product_id,null::uuid,coalesce(rt.quantity,0),b.reserved,
    'Investigate active reservation lines and balance history; repair only through an audited forward database function.'
  from public.inventory_balances b left join reserved_totals rt on rt.inventory_product_id=b.product_id and rt.location_id=b.location_id
  where b.reserved<>coalesce(rt.quantity,0);
$$;
