-- Phase 4B: invoice UI workflows, atomic job invoicing, POS invoice-awareness prep.
-- No payment/credit/refund/provider tables. No inventory writes from finance RPCs.
-- The released public.complete_job stays the only stock-consuming authority.

-- ---------------------------------------------------------------------------
-- 1. Extend the finance action-request vocabulary (additive; 4A rows preserved).
-- ---------------------------------------------------------------------------
alter table public.finance_action_requests drop constraint finance_action_requests_action_check;
alter table public.finance_action_requests add constraint finance_action_requests_action_check check (action in (
  'update_finance_settings','finance_draft','finance_issue','finance_revise',
  'create_invoice_from_job','complete_job_and_create_invoice','create_manual_invoice',
  'update_invoice_draft','revise_unpaid_invoice','issue_invoice','cancel_invoice'
));

-- ---------------------------------------------------------------------------
-- 2. Private helpers
-- ---------------------------------------------------------------------------

-- 2a. Completion proof for a stock job. Raises JOB_CONSUMPTION_UNVERIFIED on any
-- inconsistency; never repairs inventory. Labour-only jobs pass with no movement.
create or replace function private.finance_completion_proof(p_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; l public.job_lines%rowtype; m public.inventory_movements%rowtype;
begin
  select * into j from public.jobs where id=p_job_id;
  if not found or j.status<>'completed' or j.completed_at is null then
    raise exception 'JOB_CONSUMPTION_UNVERIFIED' using errcode='23514';
  end if;
  if exists(select 1 from public.inventory_reservations where job_id=p_job_id and status='active') then
    raise exception 'JOB_CONSUMPTION_UNVERIFIED' using errcode='23514';
  end if;
  for l in select * from public.job_lines where job_id=p_job_id and is_active and line_type='product' order by line_position loop
    if l.inventory_movement_id is null then raise exception 'JOB_CONSUMPTION_UNVERIFIED' using errcode='23514'; end if;
    select * into m from public.inventory_movements where id=l.inventory_movement_id;
    if not found
      or m.product_id<>l.product_id
      or m.location_id<>j.location_id
      or m.source_type<>'job'
      or m.source_id<>j.id::text
      or m.movement_type not in ('stock_out','used_unit_out')
      or m.quantity_delta<> -(l.quantity::integer)
      or m.used_tyre_unit_id is distinct from l.used_tyre_unit_id then
      raise exception 'JOB_CONSUMPTION_UNVERIFIED' using errcode='23514';
    end if;
    if not exists(select 1 from public.inventory_reservations r
      where r.job_line_id=l.id and r.status='consumed' and r.location_id=j.location_id
        and r.quantity=l.quantity::integer and r.used_tyre_unit_id is not distinct from l.used_tyre_unit_id) then
      raise exception 'JOB_CONSUMPTION_UNVERIFIED' using errcode='23514';
    end if;
    if l.used_tyre_unit_id is not null and not exists(select 1 from public.used_tyre_units u
      where u.id=l.used_tyre_unit_id and u.status='sold' and u.product_id=l.product_id and u.location_id=j.location_id) then
      raise exception 'JOB_CONSUMPTION_UNVERIFIED' using errcode='23514';
    end if;
  end loop;
end;
$$;

-- 2b. Write draft revision lines with deterministic largest-remainder GST
-- allocation and (for job product lines) restricted cost snapshots. Sets the
-- revision totals + pricing_complete. Never touches lifecycle.
create or replace function private.finance_write_revision_lines(p_invoice_id uuid,p_revision_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare pending boolean; total_incl numeric; header_gst numeric; elem jsonb;
  base numeric; disc numeric; incl numeric; lid uuid;
begin
  if p_lines is null or pg_catalog.jsonb_typeof(p_lines)<>'array' or pg_catalog.jsonb_array_length(p_lines)=0 then
    raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023';
  end if;
  select bool_or((e->>'unit_price') is null) into pending from pg_catalog.jsonb_array_elements(p_lines) e;

  if pending then
    for elem in select value from pg_catalog.jsonb_array_elements(p_lines) loop
      if (elem->>'unit_price') is null then
        insert into public.invoice_lines(invoice_id,revision_id,position,source_job_line_id,product_id,used_tyre_unit_id,
          line_type,description,quantity,unit_price_incl_gst,discount_percent,discount_reason,discount_actor_user_id,discount_authorised_at)
        values(p_invoice_id,p_revision_id,(elem->>'position')::int,nullif(elem->>'source_job_line_id','')::uuid,
          nullif(elem->>'product_id','')::uuid,nullif(elem->>'used_tyre_unit_id','')::uuid,elem->>'line_type',elem->>'description',
          (elem->>'quantity')::numeric,null,coalesce((elem->>'discount_percent')::numeric,0),
          nullif(elem->>'discount_reason',''),nullif(elem->>'discount_actor','')::uuid,nullif(elem->>'discount_authorised_at','')::timestamptz)
        returning id into lid;
      else
        base:=round((elem->>'quantity')::numeric*(elem->>'unit_price')::numeric,2);
        disc:=round(base*coalesce((elem->>'discount_percent')::numeric,0)/100,2);
        incl:=base-disc;
        insert into public.invoice_lines(invoice_id,revision_id,position,source_job_line_id,product_id,used_tyre_unit_id,
          line_type,description,quantity,unit_price_incl_gst,discount_percent,discount_reason,discount_actor_user_id,discount_authorised_at,
          base_incl_gst,discount_amount,total_incl_gst,gst_amount,subtotal_ex_gst)
        values(p_invoice_id,p_revision_id,(elem->>'position')::int,nullif(elem->>'source_job_line_id','')::uuid,
          nullif(elem->>'product_id','')::uuid,nullif(elem->>'used_tyre_unit_id','')::uuid,elem->>'line_type',elem->>'description',
          (elem->>'quantity')::numeric,(elem->>'unit_price')::numeric,coalesce((elem->>'discount_percent')::numeric,0),
          nullif(elem->>'discount_reason',''),nullif(elem->>'discount_actor','')::uuid,nullif(elem->>'discount_authorised_at','')::timestamptz,
          base,disc,incl,round(incl/11,2),incl-round(incl/11,2))
        returning id into lid;
      end if;
      if (elem->>'line_type')='product' then
        insert into public.invoice_line_costs(invoice_line_id,inventory_movement_id,source_job_line_id,captured_unit_cost,captured_quantity,capture_source)
        values(lid,nullif(elem->>'inventory_movement_id','')::uuid,nullif(elem->>'source_job_line_id','')::uuid,
          nullif(elem->>'captured_unit_cost','')::numeric,(elem->>'quantity')::numeric,coalesce(nullif(elem->>'capture_source',''),'job_consumption'));
      end if;
    end loop;
    update public.invoice_revisions set total_incl_gst=null,subtotal_ex_gst=null,gst_amount=null,pricing_complete=false where id=p_revision_id;
    return;
  end if;

  select sum(round((e->>'quantity')::numeric*(e->>'unit_price')::numeric,2)
    - round(round((e->>'quantity')::numeric*(e->>'unit_price')::numeric,2)*coalesce((e->>'discount_percent')::numeric,0)/100,2))
  into total_incl from pg_catalog.jsonb_array_elements(p_lines) e;
  header_gst:=round(total_incl/11,2);

  insert into public.invoice_lines(id,invoice_id,revision_id,position,source_job_line_id,product_id,used_tyre_unit_id,
    line_type,description,quantity,unit_price_incl_gst,discount_percent,discount_reason,discount_actor_user_id,discount_authorised_at,
    base_incl_gst,discount_amount,total_incl_gst,gst_amount,subtotal_ex_gst)
  select f.lid,p_invoice_id,p_revision_id,f.pos,f.sjl,f.pid,f.utu,f.lt,f.descr,f.qty,f.price,f.dp,f.dr,f.da,f.dat,
    f.base,f.disc,f.incl,f.line_gst,f.incl-f.line_gst
  from (
    -- Deterministic largest-remainder GST allocation over positive-inclusive
    -- lines only; a zero-inclusive line always carries zero GST and zero ex-GST.
    select r.*,
      case when r.incl<=0 then 0::numeric
        else (r.fl + case when r.rn<=r.deficit then 1 else 0 end)::numeric/100 end as line_gst
    from (
      select c.*,
        pg_catalog.floor(c.incl*100/11)::bigint as fl,
        case when c.incl>0 then row_number() over (partition by (c.incl>0)
          order by (c.incl*100/11 - pg_catalog.floor(c.incl*100/11)) desc, c.pos asc) end as rn,
        (round(sum(c.incl) over ()/11,2)*100)::bigint
          - sum(pg_catalog.floor(c.incl*100/11)::bigint) over (partition by (c.incl>0)) as deficit
      from (
        select extensions.gen_random_uuid() lid,(e->>'position')::int pos,
          nullif(e->>'source_job_line_id','')::uuid sjl,nullif(e->>'product_id','')::uuid pid,
          nullif(e->>'used_tyre_unit_id','')::uuid utu,e->>'line_type' lt,e->>'description' descr,
          (e->>'quantity')::numeric qty,(e->>'unit_price')::numeric price,
          coalesce((e->>'discount_percent')::numeric,0) dp,nullif(e->>'discount_reason','') dr,
          nullif(e->>'discount_actor','')::uuid da,nullif(e->>'discount_authorised_at','')::timestamptz dat,
          round((e->>'quantity')::numeric*(e->>'unit_price')::numeric,2) base,
          round(round((e->>'quantity')::numeric*(e->>'unit_price')::numeric,2)*coalesce((e->>'discount_percent')::numeric,0)/100,2) disc,
          round((e->>'quantity')::numeric*(e->>'unit_price')::numeric,2)
            - round(round((e->>'quantity')::numeric*(e->>'unit_price')::numeric,2)*coalesce((e->>'discount_percent')::numeric,0)/100,2) incl
        from pg_catalog.jsonb_array_elements(p_lines) e
      ) c
    ) r
  ) f;

  insert into public.invoice_line_costs(invoice_line_id,inventory_movement_id,source_job_line_id,captured_unit_cost,captured_quantity,capture_source)
  select l.id,nullif(e->>'inventory_movement_id','')::uuid,nullif(e->>'source_job_line_id','')::uuid,
    nullif(e->>'captured_unit_cost','')::numeric,(e->>'quantity')::numeric,coalesce(nullif(e->>'capture_source',''),'job_consumption')
  from pg_catalog.jsonb_array_elements(p_lines) e
  join public.invoice_lines l on l.revision_id=p_revision_id and l.position=(e->>'position')::int
  where (e->>'line_type')='product';

  update public.invoice_revisions
    set total_incl_gst=total_incl,gst_amount=header_gst,subtotal_ex_gst=total_incl-header_gst,pricing_complete=true
    where id=p_revision_id;
end;
$$;

-- 2b-ii. Recompute money + deterministic GST allocation for an existing draft
-- revision IN PLACE (no line delete), so job-sourced lines keep their id and the
-- restricted invoice_line_costs rows FK'd to them (on delete restrict + append-only).
create or replace function private.finance_reallocate_revision(p_revision_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pending boolean; total_incl numeric; header_gst numeric;
begin
  select bool_or(unit_price_incl_gst is null) into pending from public.invoice_lines where revision_id=p_revision_id;
  if not found then raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023'; end if;

  update public.invoice_lines l set
    base_incl_gst = case when l.unit_price_incl_gst is null then null else round(l.quantity*l.unit_price_incl_gst,2) end,
    discount_amount = case when l.unit_price_incl_gst is null then null else round(round(l.quantity*l.unit_price_incl_gst,2)*l.discount_percent/100,2) end,
    total_incl_gst = case when l.unit_price_incl_gst is null then null
      else round(l.quantity*l.unit_price_incl_gst,2) - round(round(l.quantity*l.unit_price_incl_gst,2)*l.discount_percent/100,2) end
  where l.revision_id=p_revision_id;

  if pending then
    update public.invoice_lines l set
      gst_amount = case when l.total_incl_gst is null then null else round(l.total_incl_gst/11,2) end,
      subtotal_ex_gst = case when l.total_incl_gst is null then null else l.total_incl_gst - round(l.total_incl_gst/11,2) end
    where l.revision_id=p_revision_id;
    update public.invoice_revisions set total_incl_gst=null,subtotal_ex_gst=null,gst_amount=null,pricing_complete=false where id=p_revision_id;
    return;
  end if;

  select sum(total_incl_gst) into total_incl from public.invoice_lines where revision_id=p_revision_id;
  header_gst := round(total_incl/11,2);
  update public.invoice_lines l set
    gst_amount = a.line_gst,
    subtotal_ex_gst = l.total_incl_gst - a.line_gst
  from (
    select id,
      case when incl<=0 then 0::numeric else (fl + case when rn<=deficit then 1 else 0 end)::numeric/100 end as line_gst
    from (
      select id, incl,
        pg_catalog.floor(incl*100/11)::bigint fl,
        case when incl>0 then row_number() over (partition by (incl>0) order by (incl*100/11 - pg_catalog.floor(incl*100/11)) desc, position asc) end rn,
        (round(sum(incl) over ()/11,2)*100)::bigint - sum(pg_catalog.floor(incl*100/11)::bigint) over (partition by (incl>0)) deficit
      from (select id, position, total_incl_gst as incl from public.invoice_lines where revision_id=p_revision_id) s0
    ) s1
  ) a
  where a.id=l.id;
  update public.invoice_revisions
    set total_incl_gst=total_incl, gst_amount=header_gst, subtotal_ex_gst=total_incl-header_gst, pricing_complete=true
    where id=p_revision_id;
end;
$$;

-- 2c. Build job/manual line specs into the jsonb shape finance_write_revision_lines expects.
create or replace function private.finance_job_line_specs(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare specs jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'position',s.pos,
    'source_job_line_id',s.id,
    'product_id',s.product_id,
    'used_tyre_unit_id',s.used_tyre_unit_id,
    'line_type',s.line_type,
    'description',s.description,
    'quantity',s.quantity::text,
    'unit_price',s.unit_price_incl_gst::text,
    'discount_percent',s.discount_percent::text,
    'discount_reason',s.discount_reason,
    'discount_actor',s.discount_actor_user_id,
    'discount_authorised_at',s.discount_authorised_at,
    'inventory_movement_id',s.inventory_movement_id,
    'captured_unit_cost',s.cost_basis::text,
    'capture_source',case when s.line_type='product' then 'job_consumption' else null end
  ) order by s.pos),'[]'::jsonb) into specs
  from (
    select l.*, row_number() over (order by l.line_position) as pos
    from public.job_lines l where l.job_id=p_job_id and l.is_active
  ) s;
  return specs;
end;
$$;

-- 2d. Draft-invoice constructor shared by create_invoice_from_job and
-- complete_job_and_create_invoice. Never calls stock/inventory functions.
create or replace function private.finance_build_job_invoice(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; iid uuid:=extensions.gen_random_uuid(); rid uuid:=extensions.gen_random_uuid();
  number text; specs jsonb; pricing boolean;
begin
  select * into j from public.jobs where id=p_job_id;
  perform private.finance_completion_proof(p_job_id);
  number:=private.next_location_document_number(j.location_id,'invoice','INV');
  specs:=private.finance_job_line_specs(p_job_id);
  insert into public.invoices(id,invoice_number,location_id,customer_id,customer_vehicle_id,job_id,source_type,status,created_by)
  values(iid,number,j.location_id,j.customer_id,j.customer_vehicle_id,p_job_id,
    case when j.source_type='pos' then 'pos' else 'job' end,'draft',(select auth.uid()));
  insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,payment_terms,source_job_number,created_by)
  values(rid,iid,1,'draft','due_on_receipt',j.job_number,(select auth.uid()));
  perform private.finance_write_revision_lines(iid,rid,specs);
  update public.invoices set current_revision_id=rid where id=iid;
  select r.pricing_complete into pricing from public.invoice_revisions r where r.id=rid;
  perform private.sales_audit('INVOICE_CREATED','invoice',iid,j.location_id,
    pg_catalog.jsonb_build_object('invoice_number',number,'job_id',p_job_id,'source_type',j.source_type,'pricing_complete',pricing));
  return pg_catalog.jsonb_build_object('invoice_id',iid,'invoice_number',number,'revision_id',rid,
    'status','draft','version',1,'pricing_complete',pricing);
end;
$$;

-- 2e. Snapshot + identity guard used at issue.
create or replace function private.finance_issue_snapshots(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; s public.finance_settings%rowtype; ls public.finance_location_settings%rowtype;
  c public.customers%rowtype; v public.customer_vehicles%rowtype; bc public.customer_contacts%rowtype;
begin
  select * into i from public.invoices where id=p_invoice_id;
  select * into s from public.finance_settings where singleton;
  if s.business_name is null or coalesce(s.abn,'') !~ '^[0-9]{11}$' or s.address is null or s.phone is null or s.shared_email is null then
    raise exception 'FINANCE_IDENTITY_INCOMPLETE' using errcode='22023';
  end if;
  select * into ls from public.finance_location_settings where location_id=i.location_id;
  if ls.location_id is null or ls.branch_name is null or ls.address is null or ls.phone is null or ls.contact_email is null then
    raise exception 'FINANCE_IDENTITY_INCOMPLETE' using errcode='22023';
  end if;
  if i.customer_id is not null then
    select * into c from public.customers where id=i.customer_id;
    if i.customer_vehicle_id is not null then select * into v from public.customer_vehicles where id=i.customer_vehicle_id; end if;
    select * into bc from public.customer_contacts where customer_id=i.customer_id and active and billing_contact
      order by primary_contact desc, created_at, id limit 1;
  end if;
  return pg_catalog.jsonb_build_object(
    'business',pg_catalog.jsonb_build_object('schema_version',1,'business_name',s.business_name,'abn',s.abn,'address',s.address,
      'phone',s.phone,'shared_email',s.shared_email,'logo_asset_path',s.logo_asset_path,'logo_sha256',s.logo_sha256,
      'bank_instructions',s.bank_instructions,'invoice_footer',s.invoice_footer,'timezone',s.timezone,'currency',s.currency),
    'branch',pg_catalog.jsonb_build_object('location_id',i.location_id,'branch_name',ls.branch_name,'address',ls.address,
      'phone',ls.phone,'contact_email',ls.contact_email,'document_footer',ls.document_footer),
    'customer',case when i.customer_id is null then pg_catalog.jsonb_build_object('label','Walk-In Customer')
      else pg_catalog.jsonb_build_object('customer_id',c.id,'customer_type',c.customer_type,'display_name',c.display_name,
        'legal_name',c.legal_name,'company_name',c.company_name,'abn',c.abn,'payment_terms',c.payment_terms,
        'street_address',c.street_address,'suburb',c.suburb,'state',c.state,'postcode',c.postcode) end,
    'billing_contact',case when bc.id is null then null else pg_catalog.jsonb_build_object('contact_id',bc.id,
      'first_name',bc.first_name,'last_name',bc.last_name,'email',bc.email,'phone',coalesce(bc.mobile,bc.phone)) end,
    'vehicle',case when v.id is null then null else pg_catalog.jsonb_build_object('vehicle_id',v.id,'registration',v.registration,
      'fleet_number',v.fleet_number,'vehicle_type',v.vehicle_type) end,
    'recipient_email',coalesce(i.delivery_email_override,bc.email,c.billing_email,c.accounts_email,c.email));
end;
$$;

-- 2f. Adelaide business date + terms-derived due date.
create or replace function private.finance_due_date(p_terms text,p_customer_type text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare issue date:=(pg_catalog.now() at time zone 'Australia/Adelaide')::date; days integer; terms text:=p_terms;
begin
  if p_customer_type is distinct from 'business' then terms:='due_on_receipt'; end if;
  days:=case terms when 'due_on_receipt' then 0 when '7_days' then 7 when '14_days' then 14 when '30_days' then 30 else null end;
  if days is null then raise exception 'INVALID_PAYMENT_TERMS' using errcode='22023'; end if;
  return pg_catalog.jsonb_build_object('issue_date',issue,'due_date',issue+days,'payment_terms',terms);
end;
$$;

revoke execute on function
  private.finance_completion_proof(uuid),
  private.finance_write_revision_lines(uuid,uuid,jsonb),
  private.finance_reallocate_revision(uuid),
  private.finance_job_line_specs(uuid),
  private.finance_build_job_invoice(uuid),
  private.finance_issue_snapshots(uuid),
  private.finance_due_date(text,text)
  from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Staff RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_invoice_from_job(p_request_id uuid,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; payload jsonb; replay jsonb; result jsonb;
begin
  select * into j from public.jobs where id=p_job_id;
  if j.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',j.location_id);
  perform private.finance_guard('invoices.create',j.location_id);
  if not private.app_has_permission('jobs.view') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  payload:=pg_catalog.jsonb_build_object('job_id',p_job_id);
  replay:=private.finance_request(p_request_id,'create_invoice_from_job',payload);
  if replay is not null then return replay; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if j.status<>'completed' then raise exception 'JOB_NOT_COMPLETED' using errcode='22023'; end if;
  if exists(select 1 from public.invoices where job_id=p_job_id) then raise exception 'JOB_ALREADY_INVOICED' using errcode='23505'; end if;
  begin
    result:=private.finance_build_job_invoice(p_job_id);
  exception when unique_violation then raise exception 'JOB_ALREADY_INVOICED' using errcode='23505';
  end;
  perform private.finance_request_finish(p_request_id,'create_invoice_from_job',payload,j.location_id,(result->>'invoice_id')::uuid,result);
  return result;
end;
$$;

create or replace function public.complete_job_and_create_invoice(p_request_id uuid,p_job_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; child uuid; payload jsonb; replay jsonb; completion jsonb; result jsonb;
begin
  select * into j from public.jobs where id=p_job_id;
  if j.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',j.location_id);
  perform private.finance_guard('invoices.create',j.location_id);
  if not private.app_has_permission('jobs.view') or not private.app_has_permission('jobs.complete') then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  payload:=pg_catalog.jsonb_build_object('job_id',p_job_id,'expected_version',p_expected_version);
  replay:=private.finance_request(p_request_id,'complete_job_and_create_invoice',payload);
  if replay is not null then return replay; end if;
  if exists(select 1 from public.invoices where job_id=p_job_id) then raise exception 'JOB_ALREADY_INVOICED' using errcode='23505'; end if;
  -- Derived child commercial-request key; acquire its sales-request lock BEFORE
  -- complete_job locks the job, matching the released completion lock graph.
  child:=pg_catalog.md5('complete_job_and_create_invoice:'||p_request_id::text||':'||p_job_id::text)::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||child::text,0));
  completion:=public.complete_job(p_job_id,p_expected_version,child);
  begin
    result:=private.finance_build_job_invoice(p_job_id);
  exception when unique_violation then raise exception 'JOB_ALREADY_INVOICED' using errcode='23505';
  end;
  result:=result||pg_catalog.jsonb_build_object('job_id',p_job_id,'job_version',(completion->>'version')::integer,'job_status',completion->>'status');
  perform private.finance_request_finish(p_request_id,'complete_job_and_create_invoice',payload,j.location_id,(result->>'invoice_id')::uuid,result);
  return result;
end;
$$;

create or replace function public.create_manual_invoice(p_request_id uuid,p_location_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; iid uuid:=extensions.gen_random_uuid(); rid uuid:=extensions.gen_random_uuid();
  number text; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0;
  specs jsonb:='[]'::jsonb; qty numeric; price text; disc numeric; terms text; payload jsonb; replay jsonb; result jsonb; pricing boolean;
begin
  actor:=private.finance_guard('invoices.create',p_location_id);
  perform private.finance_guard('invoices.view',p_location_id);
  perform private.finance_json_keys(p_input,array['customer_id','customer_vehicle_id','payment_terms','customer_reference','customer_notes','lines']);
  if p_input->'lines' is null or pg_catalog.jsonb_typeof(p_input->'lines')<>'array' or pg_catalog.jsonb_array_length(p_input->'lines')=0 then
    raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023';
  end if;
  if p_input->>'customer_id' is not null then
    select * into c from public.customers where id=(p_input->>'customer_id')::uuid and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
    if p_input->>'customer_vehicle_id' is not null then
      select * into v from public.customer_vehicles where id=(p_input->>'customer_vehicle_id')::uuid and customer_id=c.id and active;
      if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
    end if;
  elsif p_input->>'customer_vehicle_id' is not null then
    raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023';
  end if;
  terms:=coalesce(nullif(p_input->>'payment_terms',''),'due_on_receipt');
  if terms not in ('due_on_receipt','7_days','14_days','30_days') then raise exception 'INVALID_PAYMENT_TERMS' using errcode='22023'; end if;
  if c.customer_type is distinct from 'business' then terms:='due_on_receipt'; end if;
  for row in select value from pg_catalog.jsonb_array_elements(p_input->'lines') loop
    pos:=pos+1;
    if coalesce(row->>'line_type','labour')<>'labour' or row->>'product_id' is not null or row->>'used_tyre_unit_id' is not null
      or row->>'source_job_line_id' is not null then
      raise exception 'MANUAL_INVOICE_SERVICE_ONLY' using errcode='22023';
    end if;
    if nullif(btrim(row->>'description'),'') is null then raise exception 'INVOICE_LINE_DESCRIPTION_REQUIRED' using errcode='22023'; end if;
    qty:=private.finance_decimal(row->>'quantity',3,12);
    if qty<=0 then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    if row->>'unit_price_incl_gst' is null then price:=null;
    else perform private.finance_decimal(row->>'unit_price_incl_gst',2,14); price:=row->>'unit_price_incl_gst'; end if;
    disc:=private.finance_discount(coalesce(row->>'discount_percent','0'),row->>'discount_reason','invoices.create',p_location_id);
    specs:=specs||pg_catalog.jsonb_build_object('position',pos,'line_type','labour','description',btrim(row->>'description'),
      'quantity',qty::text,'unit_price',price,'discount_percent',disc::text,
      'discount_reason',case when disc>0 then btrim(row->>'discount_reason') else null end,
      'discount_actor',case when disc>0 then actor else null end,
      'discount_authorised_at',case when disc>0 then pg_catalog.now() else null end);
  end loop;
  payload:=pg_catalog.jsonb_build_object('location',p_location_id,'input',p_input);
  replay:=private.finance_request(p_request_id,'create_manual_invoice',payload);
  if replay is not null then return replay; end if;
  number:=private.next_location_document_number(p_location_id,'invoice','INV');
  insert into public.invoices(id,invoice_number,location_id,customer_id,customer_vehicle_id,job_id,source_type,status,created_by,
    delivery_email_override)
  values(iid,number,p_location_id,nullif(p_input->>'customer_id','')::uuid,nullif(p_input->>'customer_vehicle_id','')::uuid,null,'manual','draft',actor,null);
  insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,payment_terms,customer_reference,customer_notes,created_by)
  values(rid,iid,1,'draft',terms,nullif(btrim(p_input->>'customer_reference'),''),nullif(btrim(p_input->>'customer_notes'),''),actor);
  perform private.finance_write_revision_lines(iid,rid,specs);
  update public.invoices set current_revision_id=rid where id=iid;
  select r.pricing_complete into pricing from public.invoice_revisions r where r.id=rid;
  result:=pg_catalog.jsonb_build_object('invoice_id',iid,'invoice_number',number,'revision_id',rid,'status','draft','version',1,'pricing_complete',pricing);
  perform private.sales_audit('INVOICE_CREATED','invoice',iid,p_location_id,pg_catalog.jsonb_build_object('invoice_number',number,'source_type','manual','pricing_complete',pricing));
  perform private.finance_request_finish(p_request_id,'create_manual_invoice',payload,p_location_id,iid,result);
  return result;
end;
$$;

create or replace function public.update_invoice_draft(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; i public.invoices%rowtype; r public.invoice_revisions%rowtype; existing public.invoice_lines%rowtype;
  row jsonb; disc numeric; terms text; payload jsonb; replay jsonb; result jsonb;
  discount_changed boolean:=false; pricing boolean; keep_ids uuid[]:='{}';
  nqty numeric; nprice numeric; nbase numeric; ndisc numeric; nincl numeric;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.edit',i.location_id);
  perform private.finance_json_keys(p_input,array['payment_terms','customer_reference','customer_notes','lines']);
  payload:=pg_catalog.jsonb_build_object('expected_version',p_expected_version,'input',p_input);
  replay:=private.finance_request(p_request_id,'update_invoice_draft',payload);
  if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  if i.status<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id;
  if r.lifecycle<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  if p_input->'lines' is null or pg_catalog.jsonb_typeof(p_input->'lines')<>'array' or pg_catalog.jsonb_array_length(p_input->'lines')=0 then
    raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023';
  end if;
  -- 4B draft editing changes EXISTING lines in place only: no add / remove /
  -- reorder. Job-sourced product lines keep identity, quantity and price and
  -- their restricted invoice_line_costs rows; only discount and wording change.
  for row in select value from pg_catalog.jsonb_array_elements(p_input->'lines') loop
    if row->>'id' is null then raise exception 'INVOICE_LINE_NOT_EDITABLE' using errcode='22023'; end if;
    select * into existing from public.invoice_lines where id=(row->>'id')::uuid and revision_id=r.id;
    if not found then raise exception 'INVOICE_LINE_NOT_FOUND' using errcode='22023'; end if;
    keep_ids:=keep_ids||existing.id;
    disc:=private.finance_discount(coalesce(row->>'discount_percent',existing.discount_percent::text),
      coalesce(row->>'discount_reason',existing.discount_reason),'invoices.edit',i.location_id);
    if disc<>existing.discount_percent then discount_changed:=true; end if;
    if existing.source_job_line_id is not null then
      nqty:=existing.quantity; nprice:=existing.unit_price_incl_gst;
    else
      nqty:=coalesce(nullif(row->>'quantity','')::numeric,existing.quantity);
      nprice:=case when row ? 'unit_price_incl_gst' then nullif(row->>'unit_price_incl_gst','')::numeric else existing.unit_price_incl_gst end;
    end if;
    if nprice is null then nbase:=null; ndisc:=null; nincl:=null;
    else nbase:=round(nqty*nprice,2); ndisc:=round(nbase*disc/100,2); nincl:=nbase-ndisc; end if;
    update public.invoice_lines set
      description=coalesce(nullif(btrim(row->>'description'),''),description),
      quantity=nqty, unit_price_incl_gst=nprice,
      discount_percent=disc,
      discount_reason=case when disc>0 then coalesce(btrim(row->>'discount_reason'),discount_reason) else null end,
      discount_actor_user_id=case when disc>0 then actor else null end,
      discount_authorised_at=case when disc>0 then pg_catalog.now() else null end,
      base_incl_gst=nbase, discount_amount=ndisc, total_incl_gst=nincl,
      gst_amount=case when nincl is null then null else round(nincl/11,2) end,
      subtotal_ex_gst=case when nincl is null then null else nincl-round(nincl/11,2) end
    where id=existing.id;
  end loop;
  -- every line in the revision must have been addressed by the input
  if exists(select 1 from public.invoice_lines l where l.revision_id=r.id and not (l.id=any(keep_ids))) then
    raise exception 'INVOICE_LINE_NOT_EDITABLE' using errcode='22023';
  end if;
  perform private.finance_reallocate_revision(r.id);
  terms:=coalesce(nullif(p_input->>'payment_terms',''),r.payment_terms);
  update public.invoice_revisions set payment_terms=terms,
    customer_reference=coalesce(nullif(btrim(p_input->>'customer_reference'),''),customer_reference),
    customer_notes=coalesce(nullif(btrim(p_input->>'customer_notes'),''),customer_notes),
    version=version+1 where id=r.id;
  update public.invoices set version=version+1 where id=p_invoice_id;
  select r2.pricing_complete into pricing from public.invoice_revisions r2 where r2.id=r.id;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'revision_id',r.id,'version',i.version+1,'pricing_complete',pricing);
  perform private.sales_audit('INVOICE_DRAFT_UPDATED','invoice',p_invoice_id,i.location_id,
    pg_catalog.jsonb_build_object('version_before',i.version,'version_after',i.version+1,'pricing_complete',pricing));
  if discount_changed then
    perform private.sales_audit('DISCOUNT_CHANGED','invoice',p_invoice_id,i.location_id,pg_catalog.jsonb_build_object('request_id',p_request_id));
  end if;
  perform private.finance_request_finish(p_request_id,'update_invoice_draft',payload,i.location_id,p_invoice_id,result);
  return result;
end;
$$;

create or replace function public.issue_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; snap jsonb; dates jsonb; ctype text;
  payload jsonb; replay jsonb; result jsonb; doc_number text;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.issue',i.location_id);
  payload:=pg_catalog.jsonb_build_object('expected_version',p_expected_version);
  replay:=private.finance_request(p_request_id,'issue_invoice',payload);
  if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  if i.status<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id for update;
  if r.lifecycle<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  if not r.pricing_complete then raise exception 'INVOICE_PRICE_PENDING' using errcode='22023'; end if;
  if not exists(select 1 from public.invoice_lines where revision_id=r.id) then raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023'; end if;
  snap:=private.finance_issue_snapshots(p_invoice_id);
  ctype:=coalesce(snap->'customer'->>'customer_type',case when i.customer_id is null then 'walk_in' else 'individual' end);
  dates:=private.finance_due_date(r.payment_terms,ctype);
  update public.invoice_revisions set lifecycle='issued',issued_at=pg_catalog.now(),
    issue_date=(dates->>'issue_date')::date,due_date=(dates->>'due_date')::date,payment_terms=dates->>'payment_terms',
    business_snapshot=snap->'business',branch_snapshot=snap->'branch',customer_snapshot=snap->'customer',
    billing_contact_snapshot=snap->'billing_contact',vehicle_snapshot=snap->'vehicle',
    version=version+1 where id=r.id;
  update public.invoices set status='issued',first_issued_at=coalesce(first_issued_at,pg_catalog.now()),version=version+1 where id=p_invoice_id;
  doc_number:=case when r.revision_number=1 then i.invoice_number else i.invoice_number||'-R'||r.revision_number end;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version)
  values(p_invoice_id,i.location_id,r.id,'tax_invoice',doc_number,'tax_invoice/'||p_invoice_id::text||'/'||r.id::text||'/v1',
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',r.revision_number,'issue_date',dates->>'issue_date',
      'due_date',dates->>'due_date','business',snap->'business','branch',snap->'branch','customer',snap->'customer',
      'vehicle',snap->'vehicle','total_incl_gst',r.total_incl_gst,'gst_amount',r.gst_amount,'subtotal_ex_gst',r.subtotal_ex_gst),'v1')
  on conflict (invoice_revision_id,document_type) do nothing;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'status','issued','version',i.version+1,'revision_id',r.id,
    'issue_date',dates->>'issue_date','due_date',dates->>'due_date');
  perform private.sales_audit('INVOICE_ISSUED','invoice',p_invoice_id,i.location_id,
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',r.revision_number,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'issue_invoice',payload,i.location_id,p_invoice_id,result);
  return result;
end;
$$;

create or replace function public.revise_unpaid_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; i public.invoices%rowtype; cur public.invoice_revisions%rowtype; nrid uuid:=extensions.gen_random_uuid();
  nrev integer; reason text; specs jsonb:='[]'::jsonb; existing public.invoice_lines%rowtype; row jsonb; pos integer:=0;
  disc numeric; terms text; snap jsonb; dates jsonb; ctype text; payload jsonb; replay jsonb; result jsonb; doc_number text;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.edit',i.location_id);
  perform private.finance_guard('invoices.issue',i.location_id);
  perform private.finance_json_keys(p_input,array['revision_reason','payment_terms','customer_reference','customer_notes','lines']);
  reason:=nullif(btrim(p_input->>'revision_reason'),'');
  if reason is null or length(reason)>500 then raise exception 'REVISION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=pg_catalog.jsonb_build_object('expected_version',p_expected_version,'input',p_input);
  replay:=private.finance_request(p_request_id,'revise_unpaid_invoice',payload);
  if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  if i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  if i.first_payment_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
  select * into cur from public.invoice_revisions where id=i.current_revision_id;
  select coalesce(max(revision_number),0)+1 into nrev from public.invoice_revisions where invoice_id=p_invoice_id;
  terms:=coalesce(nullif(p_input->>'payment_terms',''),cur.payment_terms);
  insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,payment_terms,
    customer_reference,customer_notes,source_job_number,source_quote_number,revision_reason,created_by)
  values(nrid,p_invoice_id,nrev,'draft',terms,
    coalesce(nullif(btrim(p_input->>'customer_reference'),''),cur.customer_reference),
    coalesce(nullif(btrim(p_input->>'customer_notes'),''),cur.customer_notes),cur.source_job_number,cur.source_quote_number,reason,actor);
  for existing in select * from public.invoice_lines where revision_id=cur.id order by position loop
    pos:=pos+1;
    row:=coalesce((select value from pg_catalog.jsonb_array_elements(coalesce(p_input->'lines','[]'::jsonb)) value
      where (value->>'id')::uuid=existing.id),'{}'::jsonb);
    disc:=private.finance_discount(coalesce(row->>'discount_percent',existing.discount_percent::text),
      coalesce(row->>'discount_reason',existing.discount_reason),'invoices.edit',i.location_id);
    specs:=specs||pg_catalog.jsonb_build_object('position',pos,'source_job_line_id',existing.source_job_line_id,
      'product_id',existing.product_id,'used_tyre_unit_id',existing.used_tyre_unit_id,'line_type',existing.line_type,
      'description',case when existing.source_job_line_id is not null
        then coalesce(nullif(btrim(row->>'description'),''),existing.description)
        else coalesce(nullif(btrim(row->>'description'),''),existing.description) end,
      'quantity',case when existing.source_job_line_id is not null then existing.quantity::text
        else coalesce(nullif(row->>'quantity',''),existing.quantity::text) end,
      'unit_price',case when existing.source_job_line_id is not null then existing.unit_price_incl_gst::text
        when row ? 'unit_price_incl_gst' then row->>'unit_price_incl_gst' else existing.unit_price_incl_gst::text end,
      'discount_percent',disc::text,
      'discount_reason',case when disc>0 then coalesce(btrim(row->>'discount_reason'),existing.discount_reason) else null end,
      'discount_actor',case when disc>0 then actor else null end,
      'discount_authorised_at',case when disc>0 then pg_catalog.now() else null end,
      'inventory_movement_id',(select c.inventory_movement_id from public.invoice_line_costs c where c.invoice_line_id=existing.id),
      'captured_unit_cost',(select c.captured_unit_cost::text from public.invoice_line_costs c where c.invoice_line_id=existing.id),
      'capture_source',(select c.capture_source from public.invoice_line_costs c where c.invoice_line_id=existing.id));
  end loop;
  perform private.finance_write_revision_lines(p_invoice_id,nrid,specs);
  select * into cur from public.invoice_revisions where id=nrid;
  if not cur.pricing_complete then raise exception 'INVOICE_PRICE_PENDING' using errcode='22023'; end if;
  snap:=private.finance_issue_snapshots(p_invoice_id);
  ctype:=coalesce(snap->'customer'->>'customer_type',case when i.customer_id is null then 'walk_in' else 'individual' end);
  dates:=private.finance_due_date(terms,ctype);
  update public.invoice_revisions set lifecycle='issued',issued_at=pg_catalog.now(),
    issue_date=coalesce((select issue_date from public.invoice_revisions where invoice_id=p_invoice_id and revision_number=1),(dates->>'issue_date')::date),
    due_date=(select coalesce((select issue_date from public.invoice_revisions where invoice_id=p_invoice_id and revision_number=1),(dates->>'issue_date')::date))
      + case dates->>'payment_terms' when 'due_on_receipt' then 0 when '7_days' then 7 when '14_days' then 14 when '30_days' then 30 end,
    payment_terms=dates->>'payment_terms',
    business_snapshot=snap->'business',branch_snapshot=snap->'branch',customer_snapshot=snap->'customer',
    billing_contact_snapshot=snap->'billing_contact',vehicle_snapshot=snap->'vehicle',version=version+1 where id=nrid;
  update public.invoices set current_revision_id=nrid,version=version+1 where id=p_invoice_id;
  select * into cur from public.invoice_revisions where id=nrid;
  doc_number:=i.invoice_number||'-R'||nrev;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version)
  values(p_invoice_id,i.location_id,nrid,'tax_invoice',doc_number,'tax_invoice/'||p_invoice_id::text||'/'||nrid::text||'/v1',
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'issue_date',cur.issue_date,'due_date',cur.due_date,
      'revision_reason',reason,'total_incl_gst',cur.total_incl_gst,'gst_amount',cur.gst_amount,'subtotal_ex_gst',cur.subtotal_ex_gst),'v1')
  on conflict (invoice_revision_id,document_type) do nothing;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'revision_id',nrid,'revision_number',nrev,'version',i.version+1,
    'issue_date',cur.issue_date,'due_date',cur.due_date);
  perform private.sales_audit('INVOICE_REVISED','invoice',p_invoice_id,i.location_id,
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'reason',reason,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'revise_unpaid_invoice',payload,i.location_id,p_invoice_id,result);
  return result;
end;
$$;

create or replace function public.cancel_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; reason text; payload jsonb; replay jsonb; result jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.cancel',i.location_id);
  reason:=nullif(btrim(p_reason),'');
  if reason is null or length(reason)>500 then raise exception 'CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=pg_catalog.jsonb_build_object('expected_version',p_expected_version,'reason',reason);
  replay:=private.finance_request(p_request_id,'cancel_invoice',payload);
  if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  if i.status='cancelled' then raise exception 'INVALID_INVOICE_TRANSITION' using errcode='22023'; end if;
  if i.status='issued' then raise exception 'ISSUED_CANCELLATION_NOT_AVAILABLE' using errcode='22023'; end if;
  update public.invoices set status='cancelled',cancelled_at=pg_catalog.now(),cancelled_by=(select auth.uid()),
    cancellation_reason=reason,version=version+1 where id=p_invoice_id;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'status','cancelled','version',i.version+1);
  perform private.sales_audit('INVOICE_CANCELLED','invoice',p_invoice_id,i.location_id,
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'reason',reason,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,p_invoice_id,result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Read RPCs
-- ---------------------------------------------------------------------------

create or replace function public.invoice_summary(p_location_id uuid default null,p_status text default null,
  p_source_type text default null,p_cursor timestamptz default null,p_limit integer default 50)
returns table(id uuid,invoice_number text,location_id uuid,customer_id uuid,customer_name text,source_type text,
  job_id uuid,status text,issue_date date,due_date date,pricing_complete boolean,total_incl_gst numeric,
  gst_amount numeric,revision_number integer,version integer,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.finance_guard('invoices.view');
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  if p_status is not null and p_status not in ('draft','issued','cancelled') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_source_type is not null and p_source_type not in ('job','pos','manual') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  return query
    select i.id,i.invoice_number,i.location_id,i.customer_id,
      coalesce(r.customer_snapshot->>'display_name',c.display_name,
        case when i.customer_id is null then 'Walk-In Customer' else null end),
      i.source_type,i.job_id,i.status,r.issue_date,r.due_date,r.pricing_complete,r.total_incl_gst,r.gst_amount,
      r.revision_number,i.version,i.created_at
    from public.invoices i
    join public.invoice_revisions r on r.id=i.current_revision_id
    left join public.customers c on c.id=i.customer_id
    where ((select private.app_is_admin()) or i.location_id=(select private.app_user_location_id()))
      and (p_location_id is null or i.location_id=p_location_id)
      and (p_status is null or i.status=p_status)
      and (p_source_type is null or i.source_type=p_source_type)
      and (p_cursor is null or i.created_at<p_cursor)
    order by i.created_at desc,i.id desc limit p_limit;
end;
$$;

create or replace function public.eligible_jobs_for_invoice(p_location_id uuid default null,p_query text default null,p_limit integer default 30)
returns table(id uuid,job_number text,location_id uuid,customer_name text,vehicle_registration text,
  completed_at timestamptz,total_incl_gst numeric,pricing_complete boolean)
language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_query,'')));
begin
  perform private.finance_guard('invoices.create');
  if not private.app_has_permission('jobs.view') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  return query
    select j.id,j.job_number,j.location_id,j.customer_snapshot->>'display_name',j.vehicle_snapshot->>'registration',
      j.completed_at,j.total_incl_gst,j.pricing_complete
    from public.jobs j
    where j.status='completed'
      and not exists(select 1 from public.invoices i where i.job_id=j.id)
      and ((select private.app_is_admin()) or j.location_id=(select private.app_user_location_id()))
      and (p_location_id is null or j.location_id=p_location_id)
      and (term='' or lower(concat_ws(' ',j.job_number,j.customer_snapshot->>'display_name',j.vehicle_snapshot->>'registration')) like '%'||term||'%')
    order by j.completed_at desc,j.id desc limit p_limit;
end;
$$;

-- Richer invoice detail: revisions with lines, source links, documents, lifecycle.
create or replace function public.invoice_detail(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; revisions jsonb; documents jsonb; job jsonb;
begin
  perform private.finance_guard('invoices.view');
  select * into i from public.invoices x where x.id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'revision_number',r.revision_number,'lifecycle',r.lifecycle,
    'issued_at',r.issued_at,'issue_date',r.issue_date,'due_date',r.due_date,'payment_terms',r.payment_terms,
    'total_incl_gst',r.total_incl_gst,'subtotal_ex_gst',r.subtotal_ex_gst,'gst_amount',r.gst_amount,
    'pricing_complete',r.pricing_complete,'revision_reason',r.revision_reason,'customer_reference',r.customer_reference,
    'customer_notes',r.customer_notes,'customer_snapshot',r.customer_snapshot,'vehicle_snapshot',r.vehicle_snapshot,
    'business_snapshot',r.business_snapshot,'branch_snapshot',r.branch_snapshot,'billing_contact_snapshot',r.billing_contact_snapshot,
    'lines',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',l.id,'position',l.position,'line_type',l.line_type,
      'description',l.description,'quantity',l.quantity,'unit_price_incl_gst',l.unit_price_incl_gst,'discount_percent',l.discount_percent,
      'discount_reason',l.discount_reason,'base_incl_gst',l.base_incl_gst,'discount_amount',l.discount_amount,
      'total_incl_gst',l.total_incl_gst,'gst_amount',l.gst_amount,'subtotal_ex_gst',l.subtotal_ex_gst,
      'source_job_line_id',l.source_job_line_id,'product_id',l.product_id,'used_tyre_unit_id',l.used_tyre_unit_id) order by l.position),'[]'::jsonb)
      from public.invoice_lines l where l.revision_id=r.id)) order by r.revision_number) into revisions
    from public.invoice_revisions r where r.invoice_id=i.id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',d.id,'document_type',d.document_type,
    'document_number',d.document_number,'invoice_revision_id',d.invoice_revision_id,'render_status',d.render_status) order by d.created_at),'[]'::jsonb)
    into documents from public.financial_documents d where d.invoice_id=i.id;
  if i.job_id is not null then
    select pg_catalog.jsonb_build_object('id',j.id,'job_number',j.job_number,'status',j.status,'completed_at',j.completed_at) into job
      from public.jobs j where j.id=i.job_id;
  end if;
  return pg_catalog.jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'location_id',i.location_id,
    'customer_id',i.customer_id,'customer_vehicle_id',i.customer_vehicle_id,'job_id',i.job_id,'job',job,
    'source_type',i.source_type,'status',i.status,'version',i.version,'current_revision_id',i.current_revision_id,
    'first_issued_at',i.first_issued_at,'first_payment_at',i.first_payment_at,'cancelled_at',i.cancelled_at,
    'cancellation_reason',i.cancellation_reason,'operational_notes',i.operational_notes,
    'revisions',coalesce(revisions,'[]'::jsonb),'documents',documents);
end;
$$;

-- Small read used by the job detail page to link a job to its invoice. Direct
-- table reads on public.invoices are revoked for `authenticated`, so job/invoice
-- integration must go through an RPC that repeats the permission + branch check.
create or replace function public.invoice_for_job(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j public.jobs%rowtype; inv public.invoices%rowtype; rev public.invoice_revisions%rowtype;
begin
  perform private.finance_guard('invoices.view');
  select * into j from public.jobs where id=p_job_id;
  if j.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',j.location_id);
  select * into inv from public.invoices where job_id=p_job_id;
  if inv.id is null then return null; end if;
  select * into rev from public.invoice_revisions where id=inv.current_revision_id;
  return pg_catalog.jsonb_build_object('id',inv.id,'invoice_number',inv.invoice_number,'status',inv.status,
    'source_type',inv.source_type,'pricing_complete',rev.pricing_complete,'total_incl_gst',rev.total_incl_gst);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
revoke execute on function
  public.create_invoice_from_job(uuid,uuid),
  public.complete_job_and_create_invoice(uuid,uuid,integer),
  public.create_manual_invoice(uuid,uuid,jsonb),
  public.update_invoice_draft(uuid,uuid,integer,jsonb),
  public.issue_invoice(uuid,uuid,integer),
  public.revise_unpaid_invoice(uuid,uuid,integer,jsonb),
  public.cancel_invoice(uuid,uuid,integer,text),
  public.invoice_summary(uuid,text,text,timestamptz,integer),
  public.eligible_jobs_for_invoice(uuid,text,integer),
  public.invoice_detail(uuid),
  public.invoice_for_job(uuid)
  from public,anon,service_role;
grant execute on function
  public.create_invoice_from_job(uuid,uuid),
  public.complete_job_and_create_invoice(uuid,uuid,integer),
  public.create_manual_invoice(uuid,uuid,jsonb),
  public.update_invoice_draft(uuid,uuid,integer,jsonb),
  public.issue_invoice(uuid,uuid,integer),
  public.revise_unpaid_invoice(uuid,uuid,integer,jsonb),
  public.cancel_invoice(uuid,uuid,integer,text),
  public.invoice_summary(uuid,text,text,timestamptz,integer),
  public.eligible_jobs_for_invoice(uuid,text,integer),
  public.invoice_detail(uuid),
  public.invoice_for_job(uuid)
  to authenticated;
