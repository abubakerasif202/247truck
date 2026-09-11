-- Review remediation: paginated inventory + receivables, database-side dashboard
-- totals, overdue filtering by financial condition, canonical cancellation
-- fingerprints, and durable invoice e-mail send requests.
-- Forward-only: released migrations are not edited. Immutable financial history
-- (finance_action_requests, invoice_email_deliveries) is never rewritten.

-- ---------------------------------------------------------------------------
-- 2. Inventory: product-paged summary and database-side dashboard totals.
-- Both require inventory.view and read through inventory_product_summary so branch
-- scope and the inventory.view_cost gate on weighted_average_cost are inherited unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_summary_page(
  p_location_code text default null,
  p_product_id uuid default null,
  p_search text default null,
  p_category text default null,
  p_tyre_condition text default null,
  p_low_stock_only boolean default false,
  p_include_archived boolean default false,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare term text := lower(btrim(coalesce(p_search,''))); total bigint; page_rows jsonb;
begin
  -- Requires inventory.view (Admins implicitly hold every permission; disabled or
  -- anonymous callers hold none). Branch scope and the inventory.view_cost gate on
  -- weighted_average_cost are enforced by inventory_product_summary itself.
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_offset<0 or p_limit not between 1 and 200 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  if p_location_code is not null and not exists(select 1 from public.locations l where l.code=p_location_code) then raise exception 'INVALID_LOCATION' using errcode='22023'; end if;
  if p_tyre_condition is not null and p_tyre_condition not in ('new','used') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if length(term)>100 then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  -- Managers are pinned to their branch by the view itself; an explicit foreign
  -- branch request must fail loudly rather than silently return nothing.
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code=p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;

  with scope as (
    select distinct s.product_id from public.inventory_product_summary s
    where (p_include_archived or s.active)
      and (p_product_id is null or s.product_id=p_product_id)
      and (p_location_code is null or s.location_code=p_location_code)
      and (p_category is null or s.category_code=p_category)
      and (p_tyre_condition is null or s.tyre_condition=p_tyre_condition)
      and (not p_low_stock_only or s.low_stock)
      and (term='' or lower(concat_ws(' ',s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name)) like '%'||term||'%')
  ), counted as (select count(*) total from scope),
  page as (
    select p.id, p.name from public.products p join scope sc on sc.product_id=p.id
    order by p.name, p.id offset p_offset limit p_limit
  ), page_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'product_id',s.product_id,'name',s.name,'category_code',s.category_code,'part_reference',s.part_reference,
        'selling_price_incl_gst',s.selling_price_incl_gst,'tyre_condition',s.tyre_condition,'brand_name',s.brand_name,
        'pattern_name',s.pattern_name,'size_name',s.size_name,'location_code',s.location_code,'location_name',s.location_name,
        'on_hand',s.on_hand,'reserved',s.reserved,'available',s.available,'weighted_average_cost',s.weighted_average_cost,
        'minimum_stock',s.minimum_stock,'reorder_quantity',s.reorder_quantity,'low_stock',s.low_stock,'active',s.active
      ) order by s.name, s.product_id, s.location_code),'[]'::jsonb) rows_json
    from public.inventory_product_summary s join page on page.id=s.product_id
    where (p_location_code is null or s.location_code=p_location_code)
      and (p_product_id is null or s.product_id=p_product_id)
      and (p_category is null or s.category_code=p_category)
      and (p_tyre_condition is null or s.tyre_condition=p_tyre_condition)
      and (not p_low_stock_only or s.low_stock)
      and (p_include_archived or s.active)
      and (term='' or lower(concat_ws(' ',s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name)) like '%'||term||'%')
  )
  select counted.total, page_json.rows_json into total, page_rows from counted, page_json;

  return jsonb_build_object('rows',page_rows,'total_products',total,'offset',p_offset,'limit',p_limit,'has_more',p_offset+p_limit<total);
end; $$;

create or replace function public.inventory_dashboard_metrics(p_location_code text default null)
returns table(active_products bigint, total_on_hand bigint, low_stock_items bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  -- Requires inventory.view (Admins implicitly hold every permission; disabled or
  -- anonymous callers hold none). Branch scope and the inventory.view_cost gate on
  -- weighted_average_cost are enforced by inventory_product_summary itself.
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code=p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  return query
  select count(distinct s.product_id)::bigint, coalesce(sum(s.on_hand),0)::bigint, count(*) filter (where s.low_stock)::bigint
  from public.inventory_product_summary s
  where s.active and (p_location_code is null or s.location_code=p_location_code);
end; $$;

revoke execute on function public.inventory_summary_page(text,uuid,text,text,text,boolean,boolean,integer,integer), public.inventory_dashboard_metrics(text) from public,anon,service_role;
grant execute on function public.inventory_summary_page(text,uuid,text,text,text,boolean,boolean,integer,integer), public.inventory_dashboard_metrics(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1 + 7. Receivables: keyset pagination that is stable across equal and null
-- due dates, an explicit has_more flag, and a default view limited to
-- outstanding balances. Paid history is only returned when asked for.
-- Order: due_date asc nulls last, invoice id asc. A cursor with a null due date
-- addresses the trailing null-due section.
-- ---------------------------------------------------------------------------
create or replace function public.customer_receivables_v2(p_location_id uuid default null,p_customer_id uuid default null,p_state text default null,
  p_search text default null,p_due_from date default null,p_due_to date default null,p_cursor_due_date date default null,
  p_cursor_invoice_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_search,''))); page_rows jsonb; fetched integer; last_row jsonb;
begin
  perform private.finance_guard('receivables.view',p_location_id);
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  if length(term)>100 or (p_state is not null and p_state not in ('unpaid','partial','paid','overdue')) or p_due_from>p_due_to then
    raise exception 'INVALID_RECEIVABLE_FILTER' using errcode='22023'; end if;
  select coalesce(pg_catalog.jsonb_agg(row_data order by due_date asc nulls last, invoice_id asc),'[]'::jsonb) into page_rows from (
    select i.id invoice_id,r.due_date,pg_catalog.jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,
      'location_id',i.location_id,'location_code',l.code,'customer_id',i.customer_id,'customer_name',coalesce(r.customer_snapshot->>'display_name',c.display_name,'Walk-In Customer'),
      'issue_date',r.issue_date,'due_date',r.due_date,'total',(x->>'total')::numeric,'credits',(x->>'credits')::numeric,'gross_paid',(x->>'gross_paid')::numeric,
      'reversed',(x->>'reversed')::numeric,'effective_paid',(x->>'effective_paid')::numeric,'refund_due',(x->>'refund_due')::numeric,'balance',(x->>'balance')::numeric,
      'payment_state',x->>'payment_state','is_overdue',(x->>'is_overdue')::boolean,'aging_bucket',x->>'aging_bucket',
      'invoice_link_allowed',private.app_has_permission('invoices.view')) row_data
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id join public.locations l on l.id=i.location_id left join public.customers c on c.id=i.customer_id
    cross join lateral private.finance_invoice_projection(i.id,false) x
    where i.status='issued' and ((select private.app_is_admin()) or i.location_id=(select private.app_user_location_id()))
      and (p_location_id is null or i.location_id=p_location_id) and (p_customer_id is null or i.customer_id=p_customer_id)
      and case
        when p_state is null then (x->>'balance')::numeric>0
        when p_state='paid' then x->>'payment_state'='paid'
        when p_state='overdue' then (x->>'is_overdue')::boolean and (x->>'balance')::numeric>0
        else x->>'payment_state'=p_state and (x->>'balance')::numeric>0 end
      and (term='' or lower(concat_ws(' ',i.invoice_number,r.customer_snapshot->>'display_name',c.display_name)) like '%'||term||'%')
      and (p_due_from is null or r.due_date>=p_due_from) and (p_due_to is null or r.due_date<=p_due_to)
      and (p_cursor_invoice_id is null
        or (p_cursor_due_date is not null and (r.due_date>p_cursor_due_date or (r.due_date=p_cursor_due_date and i.id>p_cursor_invoice_id) or r.due_date is null))
        or (p_cursor_due_date is null and r.due_date is null and i.id>p_cursor_invoice_id))
    order by r.due_date asc nulls last, i.id asc limit p_limit+1) q;
  fetched:=jsonb_array_length(page_rows);
  if fetched>p_limit then page_rows:=page_rows-(fetched-1); end if;
  last_row:=case when fetched>p_limit then page_rows->(p_limit-1) else null end;
  return jsonb_build_object('rows',page_rows,'has_more',fetched>p_limit,
    'next_cursor',case when last_row is null then null else jsonb_build_object('due_date',last_row->'due_date','invoice_id',last_row->'invoice_id') end);
end;
$$;

-- Keep the released array-returning signature for existing callers, but route it
-- through the corrected implementation so both agree on ordering and filters.
create or replace function public.customer_receivables(p_location_id uuid default null,p_customer_id uuid default null,p_state text default null,
  p_search text default null,p_due_from date default null,p_due_to date default null,p_cursor_due_date date default null,
  p_cursor_invoice_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  return public.customer_receivables_v2(p_location_id,p_customer_id,p_state,p_search,p_due_from,p_due_to,p_cursor_due_date,p_cursor_invoice_id,p_limit)->'rows';
end;
$$;
revoke execute on function public.customer_receivables_v2(uuid,uuid,text,text,date,date,date,uuid,integer) from public,anon,service_role;
grant execute on function public.customer_receivables_v2(uuid,uuid,text,text,date,date,date,uuid,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Invoice list: overdue is a financial condition (past due, positive
-- balance) independent of partial payment. display_status reports 'overdue'
-- for those rows; payment_state still carries the partial-payment detail.
-- ---------------------------------------------------------------------------
create or replace function public.invoice_summary_v2(p_location_id uuid default null,p_status text default null,p_source_type text default null,p_search text default null,
  p_sort text default 'created_at',p_direction text default 'desc',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint; term text:=lower(nullif(btrim(p_search),''));
begin
  perform private.finance_guard('invoices.view',p_location_id);
  if p_status is not null and p_status not in ('draft','issued','cancelled','sent','partial','paid','overdue','void') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_source_type is not null and p_source_type not in ('job','pos','manual') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_sort not in ('created_at','invoice_number','customer_name','issue_date','due_date','total','balance','status') or p_direction not in ('asc','desc')
    or p_offset<0 or p_limit not between 1 and 100 then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  with data as (
    select i.id,i.invoice_number,i.location_id,i.customer_id,i.source_type,i.job_id,i.status,i.version,i.created_at,r.issue_date,r.due_date,r.total_incl_gst,r.gst_amount,r.revision_number,
      coalesce(r.customer_snapshot->>'display_name',c.display_name,'Walk-In Customer') customer_name,
      private.finance_invoice_projection(i.id,false) financials
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id left join public.customers c on c.id=i.customer_id
    where (private.app_is_admin() or i.location_id=private.app_user_location_id()) and (p_location_id is null or i.location_id=p_location_id)
      and (p_source_type is null or i.source_type=p_source_type)
      and (term is null or lower(concat_ws(' ',i.invoice_number,c.display_name,r.customer_snapshot->>'display_name',r.customer_reference,r.job_details->>'registration',r.job_details->>'vehicle_or_fleet_id')) like '%'||term||'%')
  ), filtered as (
    select d.*,case when d.status='cancelled' then 'void' when d.status='draft' then 'draft'
        when (d.financials->>'is_overdue')::boolean and (d.financials->>'balance')::numeric>0 then 'overdue'
        when (d.financials->>'payment_state')='paid' then 'paid' when (d.financials->>'payment_state')='partial' then 'partial' else 'sent' end display_status
    from data d
  ), chosen as (
    select f.* from filtered f
    where p_status is null
      or (p_status in ('draft','issued','cancelled') and f.status=p_status)
      or (p_status='void' and f.status='cancelled')
      or (p_status='overdue' and f.status='issued' and (f.financials->>'is_overdue')::boolean and (f.financials->>'balance')::numeric>0)
      or (p_status='paid' and f.status='issued' and f.financials->>'payment_state'='paid')
      or (p_status='partial' and f.status='issued' and f.financials->>'payment_state'='partial')
      or (p_status='sent' and f.status='issued' and f.financials->>'payment_state'='unpaid' and not (f.financials->>'is_overdue')::boolean)
  ), counted as (select count(*) total from chosen),
  page as (
    select * from chosen order by
      case when p_direction='asc' and p_sort='created_at' then created_at end asc,case when p_direction='desc' and p_sort='created_at' then created_at end desc,
      case when p_direction='asc' and p_sort='invoice_number' then invoice_number end asc,case when p_direction='desc' and p_sort='invoice_number' then invoice_number end desc,
      case when p_direction='asc' and p_sort='customer_name' then customer_name end asc,case when p_direction='desc' and p_sort='customer_name' then customer_name end desc,
      case when p_direction='asc' and p_sort='issue_date' then issue_date end asc,case when p_direction='desc' and p_sort='issue_date' then issue_date end desc,
      case when p_direction='asc' and p_sort='due_date' then due_date end asc,case when p_direction='desc' and p_sort='due_date' then due_date end desc,
      case when p_direction='asc' and p_sort='total' then total_incl_gst end asc,case when p_direction='desc' and p_sort='total' then total_incl_gst end desc,
      case when p_direction='asc' and p_sort='balance' then (financials->>'balance')::numeric end asc,case when p_direction='desc' and p_sort='balance' then (financials->>'balance')::numeric end desc,
      case when p_direction='asc' and p_sort='status' then display_status end asc,case when p_direction='desc' and p_sort='status' then display_status end desc,id
    offset p_offset limit p_limit
  ), page_json as (
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'invoice_number',invoice_number,'location_id',location_id,'customer_id',customer_id,
      'customer_name',customer_name,'source_type',source_type,'job_id',job_id,'status',status,'issue_date',issue_date,'due_date',due_date,
      'total_incl_gst',total_incl_gst,'gst_amount',gst_amount,'revision_number',revision_number,'version',version,'created_at',created_at,
      'payment_state',financials->>'payment_state','is_overdue',(financials->>'is_overdue')::boolean,'balance',financials->>'balance',
      'effective_paid',financials->>'effective_paid','display_status',display_status) order by
      case when p_direction='asc' and p_sort='created_at' then created_at end asc,case when p_direction='desc' and p_sort='created_at' then created_at end desc,
      case when p_direction='asc' and p_sort='invoice_number' then invoice_number end asc,case when p_direction='desc' and p_sort='invoice_number' then invoice_number end desc,
      case when p_direction='asc' and p_sort='customer_name' then customer_name end asc,case when p_direction='desc' and p_sort='customer_name' then customer_name end desc,
      case when p_direction='asc' and p_sort='issue_date' then issue_date end asc,case when p_direction='desc' and p_sort='issue_date' then issue_date end desc,
      case when p_direction='asc' and p_sort='due_date' then due_date end asc,case when p_direction='desc' and p_sort='due_date' then due_date end desc,
      case when p_direction='asc' and p_sort='total' then total_incl_gst end asc,case when p_direction='desc' and p_sort='total' then total_incl_gst end desc,
      case when p_direction='asc' and p_sort='balance' then (financials->>'balance')::numeric end asc,case when p_direction='desc' and p_sort='balance' then (financials->>'balance')::numeric end desc,
      case when p_direction='asc' and p_sort='status' then display_status end asc,case when p_direction='desc' and p_sort='status' then display_status end desc,id),'[]'::jsonb) rows_json
    from page
  )
  select counted.total, page_json.rows_json into total, rows from counted, page_json;
  return jsonb_build_object('rows',rows,'total',total,'offset',p_offset,'limit',p_limit);
end; $$;

-- ---------------------------------------------------------------------------
-- 4. cancel_invoice: the idempotency fingerprint covers exactly the caller's
-- request (invoice, expected version, trimmed reason). Data the function
-- generates (credit lines, refund allocations) lives in the credit note, the
-- refunds, and the audit event — never in the request fingerprint — so an
-- identical retry replays the stored result and a changed payload is rejected.
-- Requests already stored with the previous (generated-data) fingerprint are
-- immutable; finance_cancel_legacy_replay recognises identical retries of them.
-- ---------------------------------------------------------------------------
-- Compatibility for cancellation requests stored by the previous cancel_invoice, whose
-- fingerprint also covered the generated credit lines and refund allocations. Those
-- values are reconstructible from the immutable credit note the request created
-- (credit_notes.request_id = request id), so an identical retry can still be
-- recognised and replayed without rewriting finance_action_requests.
create or replace function private.finance_cancel_legacy_replay(p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior public.finance_action_requests%rowtype; actor uuid:=(select auth.uid()); cn public.credit_notes%rowtype; lines jsonb; payments jsonb; legacy_hash text;
begin
  select * into prior from public.finance_action_requests r where r.request_id=p_request;
  if not found or prior.action<>p_action or prior.actor_user_id is distinct from actor then return null; end if;
  select * into cn from public.credit_notes c where c.request_id=p_request and c.is_cancellation and c.invoice_id=(p_payload->>'invoice_id')::uuid;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('invoice_line_id',l.invoice_line_id,'amount',l.credited_incl_gst) order by l.position),'[]') into lines from public.credit_note_lines l where l.credit_note_id=cn.id;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id',f.payment_id,'amount',f.amount) order by f.payment_id),'[]') into payments from public.refunds f where f.credit_note_id=cn.id and f.retry_of is null;
  legacy_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('actor',actor,'action',p_action,'payload',p_payload||jsonb_build_object('generated_credit_lines',lines,'generated_payments',payments))::text,'UTF8'),'sha256'),'hex');
  if prior.payload_hash<>legacy_hash then return null; end if;
  return prior.result;
end; $$;
revoke execute on function private.finance_cancel_legacy_replay(uuid,text,jsonb) from public,anon,authenticated,service_role;

-- Reconciliation: lets the same actor (or an Admin) read back what a request id
-- already recorded, so a lost response never forces a blind second submission.
create or replace function public.finance_request_outcome(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior public.finance_action_requests%rowtype; actor uuid:=(select auth.uid()); i public.invoices%rowtype;
begin
  if actor is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into prior from public.finance_action_requests r where r.request_id=p_request_id;
  if not found then return jsonb_build_object('found',false); end if;
  if prior.actor_user_id is distinct from actor and not (select private.app_is_admin()) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if prior.location_id is not null then perform private.finance_guard('invoices.view',prior.location_id); end if;
  if prior.entity_type='finance' and prior.entity_id is not null then select * into i from public.invoices where id=prior.entity_id; end if;
  return jsonb_build_object('found',true,'action',prior.action,'entity_id',prior.entity_id,'recorded_at',prior.created_at,'result',prior.result,
    'invoice_status',i.status,'invoice_version',i.version,'invoice_number',i.invoice_number);
end; $$;
revoke execute on function public.finance_request_outcome(uuid) from public,anon,service_role;
grant execute on function public.finance_request_outcome(uuid) to authenticated;

create or replace function public.cancel_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; lines jsonb:='[]'; payments jsonb:='[]'; total numeric; paid numeric; auth numeric; payload jsonb; replay jsonb; result jsonb; projection jsonb; actor uuid;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if; actor:=private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('invoices.cancel',i.location_id); if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'reason',btrim(p_reason));
  replay:=private.finance_cancel_legacy_replay(p_request_id,'cancel_invoice',payload); if replay is not null then return replay; end if;
  replay:=private.finance_request(p_request_id,'cancel_invoice',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update; if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if; if i.status='cancelled' then raise exception 'INVALID_INVOICE_TRANSITION' using errcode='22023'; end if;
  if i.status='draft' then update public.invoices set status='cancelled',cancelled_at=pg_catalog.now(),cancelled_by=actor,cancellation_reason=btrim(p_reason),version=version+1 where id=i.id; result:=jsonb_build_object('invoice_id',i.id,'status','cancelled','version',i.version+1); perform private.sales_audit('INVOICE_CANCELLED','invoice',i.id,i.location_id,jsonb_build_object('reason',p_reason,'request_id',p_request_id)); perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,i.id,result); return result; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id; select coalesce(sum(pay.amount),0)-coalesce(sum(case when pr.id is not null then pay.amount else 0 end),0) into paid from public.payments pay left join public.payment_reversals pr on pr.payment_id=pay.id where pay.invoice_id=i.id and pay.status='succeeded'; select coalesce(sum(c.authorised_refund_amount),0) into auth from public.credit_notes c where c.invoice_id=i.id and c.status='issued';
  select coalesce(jsonb_agg(jsonb_build_object('invoice_line_id',il.id,'amount',round(il.total_incl_gst-coalesce(x.credited,0),2)) order by il.position),'[]') into lines from public.invoice_lines il left join lateral (select sum(cnl.credited_incl_gst) credited from public.credit_note_lines cnl join public.credit_notes cn on cn.id=cnl.credit_note_id and cn.status='issued' where cnl.invoice_line_id=il.id) x on true where il.revision_id=r.id and il.total_incl_gst>coalesce(x.credited,0);
  total:=r.total_incl_gst-coalesce((select sum(c.total_incl_gst) from public.credit_notes c where c.invoice_id=i.id and c.status='issued'),0); auth:=paid-auth; if auth<0 then raise exception 'REFUND_EXCEEDS_CAPACITY' using errcode='22023'; end if;
  if jsonb_array_length(lines)=0 then
    projection:=private.finance_invoice_projection(i.id,false);
    if (projection->>'balance')::numeric<>0 or (projection->>'refund_due')::numeric<>0 or (projection->>'actual_net_cash')::numeric<>0 then raise exception 'CANCELLATION_LIABILITY_REMAINS' using errcode='22023'; end if;
    update public.invoices set status='cancelled',cancelled_at=pg_catalog.now(),cancelled_by=actor,cancellation_reason=btrim(p_reason),version=version+1 where id=i.id;
    result:=projection||jsonb_build_object('invoice_id',i.id,'status','cancelled','version',i.version+1); perform private.sales_audit('INVOICE_CANCELLED','invoice',i.id,i.location_id,jsonb_build_object('reason',p_reason,'zero_value',true,'request_id',p_request_id)); perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,i.id,result); return result;
  end if;
  if auth>0 then select coalesce(jsonb_agg(jsonb_build_object('payment_id',pay.id,'amount',round(pay.amount-coalesce(x.reserved,0),2)) order by pay.id),'[]') into payments from public.payments pay left join lateral (select sum(f.amount) reserved from public.refunds f where f.payment_id=pay.id and f.status in ('pending','uncertain','succeeded')) x on true left join public.payment_reversals pr on pr.payment_id=pay.id where pay.invoice_id=i.id and pay.status='succeeded' and pr.id is null and pay.amount>coalesce(x.reserved,0); end if;
  -- Generated financial data is recorded on the audit trail, separate from the request fingerprint.
  perform private.sales_audit('INVOICE_CANCELLATION_GENERATED','invoice',i.id,i.location_id,jsonb_build_object('request_id',p_request_id,'generated_credit_lines',lines,'generated_payments',payments,'authorised_refund_amount',auth));
  result:=private.finance_insert_credit_refund(p_request_id,i.id,p_expected_version,jsonb_build_object('reason',btrim(p_reason),'credit_lines',lines,'authorised_refund_amount',auth,'payments',payments),true);
  projection:=private.finance_invoice_projection(i.id,false); if (projection->>'balance')::numeric<>0 then raise exception 'CANCELLATION_LIABILITY_REMAINS' using errcode='22023'; end if;
  if (projection->>'refund_due')::numeric<>0 or (projection->>'actual_net_cash')::numeric<>0 then
    result:=result||jsonb_build_object('status','issued','cancellation_pending',true,'version',i.version+1); perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,i.id,result); return result;
  end if;
  update public.invoices set status='cancelled',cancelled_at=pg_catalog.now(),cancelled_by=actor,cancellation_reason=btrim(p_reason),version=version+1 where id=i.id; result:=result||jsonb_build_object('status','cancelled','version',i.version+2); perform private.sales_audit('INVOICE_CANCELLED','invoice',i.id,i.location_id,jsonb_build_object('reason',p_reason,'request_id',p_request_id)); perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,i.id,result); return result;
end; $$;

-- ---------------------------------------------------------------------------
-- 8. Durable invoice e-mail send requests. One logical request is bound to
-- (invoice revision, recipient, actor) and carries the provider idempotency key
-- for every retry. An intentional resend opens a new request (new sequence,
-- new key). invoice_email_deliveries remains the immutable per-attempt log; the
-- request row is the mutable state machine. Resend keeps idempotency keys for
-- 24 hours, so a retry after that window must be an explicit resend.
-- ---------------------------------------------------------------------------
create table public.invoice_email_send_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_revision_id uuid not null references public.invoice_revisions(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  recipient text not null check (recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  send_sequence integer not null check (send_sequence > 0),
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  -- pending: opened, provider outcome not yet recorded.
  -- accepted: provider returned a message id (acceptance, not delivery confirmation).
  -- uncertain: provider outcome unknown (timeout / transport error / provider fault); retry reuses the key.
  -- failed: provider definitively rejected the request; retry reuses the key.
  -- disabled: delivery disabled at the time of the attempt.
  state text not null default 'pending' check (state in ('pending','accepted','uncertain','failed','disabled')),
  provider text not null default 'resend' check (provider in ('resend','disabled')),
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  updated_at timestamptz not null default now(),
  key_expires_at timestamptz not null,
  unique (invoice_revision_id, recipient, actor_user_id, send_sequence),
  check ((state = 'accepted') = (provider_message_id is not null))
);
alter table public.invoice_email_send_requests enable row level security;
revoke all on public.invoice_email_send_requests from public,anon,authenticated,service_role;
create index invoice_email_send_requests_lookup_idx on public.invoice_email_send_requests(invoice_revision_id, recipient, actor_user_id, send_sequence desc);
create index invoice_email_send_requests_invoice_idx on public.invoice_email_send_requests(invoice_id, created_at desc);

alter table public.invoice_email_deliveries add column send_request_id uuid references public.invoice_email_send_requests(id) on delete restrict;
alter table public.invoice_email_deliveries add column attempt_number integer check (attempt_number > 0);
alter table public.invoice_email_deliveries drop constraint invoice_email_deliveries_delivery_state_check;
alter table public.invoice_email_deliveries add constraint invoice_email_deliveries_delivery_state_check check (delivery_state in ('sent','failed','disabled','uncertain'));
create index invoice_email_deliveries_request_idx on public.invoice_email_deliveries(send_request_id, attempted_at desc);

create or replace function private.invoice_email_send_request_json(p_request public.invoice_email_send_requests)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_request.id,'invoice_id',p_request.invoice_id,'invoice_revision_id',p_request.invoice_revision_id,
    'revision_number',p_request.revision_number,'recipient',p_request.recipient,'send_sequence',p_request.send_sequence,
    'idempotency_key',p_request.idempotency_key,'state',p_request.state,'provider',p_request.provider,'provider_message_id',p_request.provider_message_id,
    'attempt_count',p_request.attempt_count,'last_error',p_request.last_error,'created_at',p_request.created_at,'last_attempted_at',p_request.last_attempted_at,
    'key_expires_at',p_request.key_expires_at,'key_expired',p_request.key_expires_at<=pg_catalog.now());
$$;
revoke execute on function private.invoice_email_send_request_json(public.invoice_email_send_requests) from public,anon,authenticated,service_role;

-- Opens or reuses the logical send request for this actor. p_mode:
--   'send'   first send; reuses an open (non-accepted, unexpired) request if one exists.
--   'retry'  must reuse the latest open request; refuses if it was accepted or the key window expired.
--   'resend' always opens a fresh request with a new provider key (intentional duplicate e-mail).
create or replace function public.begin_invoice_email_send(p_invoice_id uuid,p_invoice_revision_id uuid,p_recipient text,p_mode text default 'send')
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; actor uuid; latest public.invoice_email_send_requests%rowtype; created public.invoice_email_send_requests%rowtype; v_recipient text:=lower(btrim(p_recipient)); next_seq integer;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('documents.send',i.location_id); perform private.finance_guard('invoices.view',i.location_id);
  select * into r from public.invoice_revisions where id=p_invoice_revision_id and invoice_id=i.id;
  if not found or i.status<>'issued' or r.lifecycle<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  if p_mode not in ('send','retry','resend') or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-email:'||r.id::text||':'||v_recipient||':'||actor::text,0));
  select * into latest from public.invoice_email_send_requests q where q.invoice_revision_id=r.id and q.recipient=v_recipient and q.actor_user_id=actor order by q.send_sequence desc limit 1;
  if found and p_mode<>'resend' then
    if latest.state='accepted' then raise exception 'EMAIL_ALREADY_ACCEPTED' using errcode='23505'; end if;
    if latest.key_expires_at<=pg_catalog.now() then
      if p_mode='retry' then raise exception 'EMAIL_RETRY_WINDOW_EXPIRED' using errcode='22023'; end if;
    else
      update public.invoice_email_send_requests set attempt_count=attempt_count+1,last_attempted_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=latest.id returning * into latest;
      return private.invoice_email_send_request_json(latest)||jsonb_build_object('reused',true);
    end if;
  elsif not found and p_mode='retry' then raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;
  next_seq:=coalesce(latest.send_sequence,0)+1;
  insert into public.invoice_email_send_requests(invoice_id,invoice_revision_id,revision_number,recipient,actor_user_id,send_sequence,idempotency_key,attempt_count,last_attempted_at,key_expires_at)
    values(i.id,r.id,r.revision_number,v_recipient,actor,next_seq,'invoice-email/'||r.id::text||'/'||next_seq::text||'/'||extensions.gen_random_uuid()::text,1,pg_catalog.now(),pg_catalog.now()+interval '24 hours')
    returning * into created;
  perform private.sales_audit(case when p_mode='resend' then 'INVOICE_EMAIL_RESEND_REQUESTED' else 'INVOICE_EMAIL_SEND_REQUESTED' end,'invoice',i.id,i.location_id,jsonb_build_object('send_request_id',created.id,'revision_id',r.id,'recipient',v_recipient,'send_sequence',next_seq));
  return private.invoice_email_send_request_json(created)||jsonb_build_object('reused',false);
end; $$;

-- Records one attempt outcome against the request and appends the immutable delivery row.
-- p_outcome: accepted | failed | uncertain | disabled.
create or replace function public.finish_invoice_email_send(p_send_request_id uuid,p_outcome text,p_sender text,p_provider_message_id text default null,p_error_message text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.invoice_email_send_requests%rowtype; i public.invoices%rowtype; actor uuid; delivery_id uuid; prior uuid; new_state text; delivery_state text; provider_name text;
begin
  select * into q from public.invoice_email_send_requests where id=p_send_request_id for update; if not found then raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  select * into i from public.invoices where id=q.invoice_id;
  actor:=private.finance_guard('documents.send',i.location_id);
  if actor<>q.actor_user_id then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_outcome not in ('accepted','failed','uncertain','disabled') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_outcome='accepted' and (p_provider_message_id is null or p_error_message is not null) then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if q.state='accepted' then
    -- Provider dedupe on a reused key returns the same message id; that is not a new acceptance.
    if p_outcome='accepted' and q.provider_message_id=p_provider_message_id then return private.invoice_email_send_request_json(q)||jsonb_build_object('already_recorded',true); end if;
    raise exception 'EMAIL_ALREADY_ACCEPTED' using errcode='23505';
  end if;
  new_state:=case p_outcome when 'accepted' then 'accepted' when 'uncertain' then 'uncertain' when 'disabled' then 'disabled' else 'failed' end;
  delivery_state:=case p_outcome when 'accepted' then 'sent' when 'uncertain' then 'uncertain' when 'disabled' then 'disabled' else 'failed' end;
  provider_name:=case when p_outcome='disabled' then 'disabled' else 'resend' end;
  select d.id into prior from public.invoice_email_deliveries d where d.send_request_id=q.id order by d.attempted_at desc limit 1;
  insert into public.invoice_email_deliveries(invoice_id,invoice_revision_id,revision_number,recipient,sender,provider,provider_message_id,delivery_state,error_message,actor_user_id,retry_of,send_request_id,attempt_number)
    values(q.invoice_id,q.invoice_revision_id,q.revision_number,q.recipient,coalesce(nullif(btrim(p_sender),''),'disabled'),provider_name,case when p_outcome='accepted' then p_provider_message_id end,delivery_state,left(nullif(btrim(p_error_message),''),2000),actor,prior,q.id,greatest(q.attempt_count,1))
    returning id into delivery_id;
  update public.invoice_email_send_requests set state=new_state,provider=provider_name,provider_message_id=case when p_outcome='accepted' then p_provider_message_id end,last_error=left(nullif(btrim(p_error_message),''),2000),updated_at=pg_catalog.now() where id=q.id returning * into q;
  perform private.sales_audit('INVOICE_EMAIL_ATTEMPT_RECORDED','invoice',i.id,i.location_id,jsonb_build_object('send_request_id',q.id,'delivery_id',delivery_id,'outcome',p_outcome,'attempt',q.attempt_count));
  return private.invoice_email_send_request_json(q)||jsonb_build_object('delivery_id',delivery_id);
end; $$;

-- Latest send request per recipient for the invoice's current revision, so the UI can offer retry vs. resend.
create or replace function public.invoice_email_send_status(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; actor uuid;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('documents.send',i.location_id);
  return coalesce((select jsonb_agg(private.invoice_email_send_request_json(q) order by q.recipient,q.send_sequence desc) from (
    select distinct on (x.recipient) x.* from public.invoice_email_send_requests x where x.invoice_id=i.id and x.invoice_revision_id=i.current_revision_id and x.actor_user_id=actor order by x.recipient,x.send_sequence desc) q),'[]'::jsonb);
end; $$;

revoke execute on function public.begin_invoice_email_send(uuid,uuid,text,text),public.finish_invoice_email_send(uuid,text,text,text,text),public.invoice_email_send_status(uuid) from public,anon,service_role;
grant execute on function public.begin_invoice_email_send(uuid,uuid,text,text),public.finish_invoice_email_send(uuid,text,text,text,text),public.invoice_email_send_status(uuid) to authenticated;
