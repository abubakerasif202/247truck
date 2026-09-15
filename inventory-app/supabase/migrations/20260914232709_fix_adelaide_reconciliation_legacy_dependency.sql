-- The legacy AWT reservation tables were intentionally removed by
-- 20260914184236_drop_legacy_awt_schema.sql, but the active Adelaide
-- reconciliation function still referenced private.awt_checkouts. Replace
-- the function in a forward migration so reconciliation uses only the two
-- live reservation systems.

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
  union all select 'critical','movement_without_reservation_line',r.external_order_reference,r.id,null::uuid,mt.product_id,r.commit_request_id,null::integer,mt.quantity,
    'Preserve the ledger and investigate the unexpected product before posting any authorised compensating movement.'
  from movement_totals mt join public.adelaide_inventory_reservations r on r.id=mt.external_reservation_id
  where not exists (
    select 1 from public.adelaide_inventory_reservation_lines l
    where l.reservation_id=r.id and l.inventory_product_id=mt.product_id
  )
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
  where m.id is null or not p.active or upper(b.normalized_name) is distinct from upper(wp.brand) or upper(pat.normalized_name) is distinct from upper(wp.pattern)
    or upper(s.normalized_size) is distinct from upper(wp.tyre_size) or p.tyre_condition is distinct from wp.tyre_condition
    or not exists(select 1 from public.inventory_balances ib where ib.product_id=p.id and ib.location_id=wp.intended_location_id)
  union all select 'critical','reserved_total_mismatch',null::text,null::uuid,null::uuid,b.product_id,null::uuid,coalesce(rt.quantity,0),b.reserved,
    'Investigate active reservation lines and balance history; repair only through an audited forward database function.'
  from public.inventory_balances b left join reserved_totals rt on rt.inventory_product_id=b.product_id and rt.location_id=b.location_id
  where b.reserved<>coalesce(rt.quantity,0);
$$;

-- Draft edits must use the same server-owned pricing tier as creation. The
-- original Phase 3B functions predated retail/wholesale pricing and otherwise
-- reset product lines to the legacy retail compatibility price.
create or replace function public.update_quote_draft(p_quote_id uuid,p_expected_version integer,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb; tier text;
begin
  if not private.sales_permission('quotes.edit') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and private.sales_location_allowed(location_id) for update;
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if q.version<>p_expected_version then raise exception 'QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if q.status<>'draft' then raise exception 'QUOTE_NOT_EDITABLE' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  if q.customer_id is not null then
    select * into c from public.customers where id=q.customer_id and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
    tier:=case
      when q.customer_snapshot ? 'pricing_tier' then case when q.customer_snapshot->>'pricing_tier'='wholesale' then 'wholesale' else 'retail' end
      when c.pricing_tier='wholesale' then 'wholesale'
      else 'retail'
    end;
    if q.customer_vehicle_id is not null then
      select * into v from public.customer_vehicles where id=q.customer_vehicle_id and customer_id=q.customer_id and active;
      if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
    end if;
  else
    tier:='retail';
  end if;
  delete from public.quote_lines where quote_id=q.id;
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      price:=private.product_sale_price(product.id,tier);
      if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.quote_lines(quote_id,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier)
      values(q.id,pos,'product',product.id,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,tier);
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric;
      if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.quote_lines(quote_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier)
      values(q.id,pos,'labour',btrim(row->>'description'),qty,price,line_total,tier);
    else raise exception 'INVALID_QUOTE_LINE' using errcode='22023'; end if;
  end loop;
  update public.quotes set customer_reference=nullif(btrim(p_quote->>'customer_reference'),''),internal_notes=nullif(btrim(p_quote->>'internal_notes'),''),customer_notes=nullif(btrim(p_quote->>'customer_notes'),''),expiry_date=(p_quote->>'expiry_date')::date,
    customer_snapshot=case when q.customer_id is null then q.customer_snapshot else to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized' end,
    vehicle_snapshot=case when q.customer_id is null then q.vehicle_snapshot when q.customer_vehicle_id is null then null else to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' end,
    subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete,pricing_tier=tier,version=version+1 where id=q.id;
  perform private.sales_audit('QUOTE_CHANGED','quote',q.id,q.location_id,jsonb_build_object('quote_number',q.quote_number,'version_before',q.version,'version_after',q.version+1,'pricing_tier',tier,'pricing_complete',complete));
  result:=jsonb_build_object('quote_id',q.id,'quote_number',q.quote_number,'status','draft','pricing_complete',complete,'pricing_tier',tier,'subtotal_ex_gst',case when complete then total-round(total/11,2) else null end,'gst_amount',case when complete then round(total/11,2) else null end,'total_incl_gst',case when complete then total else null end,'version',q.version+1);
  return result;
end;
$$;

create or replace function public.update_job(p_job_id uuid,p_expected_version integer,p_job jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); j public.jobs%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; tier text;
begin
  if not private.sales_permission('jobs.edit') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into j from public.jobs where id=p_job_id and private.sales_location_allowed(location_id) for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  if j.version<>p_expected_version then raise exception 'JOB_VERSION_CONFLICT' using errcode='40001'; end if;
  if j.status in ('completed','cancelled') then raise exception 'JOB_NOT_EDITABLE' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  if j.customer_snapshot ? 'pricing_tier' then
    tier:=case when j.customer_snapshot->>'pricing_tier'='wholesale' then 'wholesale' else 'retail' end;
  elsif j.customer_id is not null and exists(select 1 from public.customers c where c.id=j.customer_id and c.active and c.pricing_tier='wholesale') then
    tier:='wholesale';
  else
    tier:='retail';
  end if;
  perform private.release_job_reservations(j.id);
  update public.job_lines set is_active=false where job_id=j.id;
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      price:=private.product_sale_price(product.id,tier);
      if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.job_lines(job_id,line_position,line_type,product_id,used_tyre_unit_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,is_active,pricing_tier)
      values(j.id,pos,'product',product.id,nullif(row->>'used_tyre_unit_id','')::uuid,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,true,tier)
      on conflict (job_id,line_position) do update set line_type=excluded.line_type,product_id=excluded.product_id,used_tyre_unit_id=excluded.used_tyre_unit_id,description=excluded.description,quantity=excluded.quantity,unit_price_incl_gst=excluded.unit_price_incl_gst,line_total_incl_gst=excluded.line_total_incl_gst,is_active=true,pricing_tier=excluded.pricing_tier;
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric;
      if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.job_lines(job_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,is_active,pricing_tier)
      values(j.id,pos,'labour',btrim(row->>'description'),qty,price,line_total,true,tier)
      on conflict (job_id,line_position) do update set line_type=excluded.line_type,product_id=null,used_tyre_unit_id=null,description=excluded.description,quantity=excluded.quantity,unit_price_incl_gst=excluded.unit_price_incl_gst,line_total_incl_gst=excluded.line_total_incl_gst,is_active=true,pricing_tier=excluded.pricing_tier;
    else raise exception 'INVALID_JOB_LINE' using errcode='22023'; end if;
  end loop;
  update public.jobs set technician_notes=coalesce(nullif(btrim(p_job->>'technician_notes'),''),technician_notes),customer_notes=coalesce(nullif(btrim(p_job->>'customer_notes'),''),customer_notes),customer_reference=coalesce(nullif(btrim(p_job->>'customer_reference'),''),customer_reference),subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete,version=version+1 where id=j.id;
  perform private.reserve_job_lines(j.id,j.location_id,actor);
  perform private.sales_audit('JOB_UPDATED','job',j.id,j.location_id,jsonb_build_object('version_before',j.version,'version_after',j.version+1,'pricing_tier',tier));
  return jsonb_build_object('job_id',j.id,'status',j.status,'pricing_complete',complete,'pricing_tier',tier,'version',j.version+1);
end;
$$;
