-- Production invoicing extensions. Additive over Phases 4A-4C.
-- Finance RPCs never create inventory movements; catalogue references are descriptive only.

alter table public.finance_settings
  add column invoice_prefix text not null default 'INV',
  add column default_payment_terms text not null default '7_days',
  add column invoice_terms jsonb not null default jsonb_build_array(
    'Please note wheels require retention within 50kms of fitting',
    'All parts and tyres remain the property of 24/7 Truck tyre until this invoice is paid in full.'
  ),
  add constraint finance_settings_invoice_prefix_check check (invoice_prefix ~ '^[A-Z][A-Z0-9-]{0,11}$'),
  add constraint finance_settings_default_terms_check check (default_payment_terms in ('due_on_receipt','7_days','14_days','30_days')),
  add constraint finance_settings_invoice_terms_check check (jsonb_typeof(invoice_terms)='array');

alter table public.invoices drop constraint invoices_invoice_number_check;
alter table public.invoices add constraint invoices_invoice_number_check
  check (invoice_number ~ '^[A-Z0-9]{2,12}-[A-Z][A-Z0-9-]{0,11}-[0-9]{6,}$');

alter table public.invoice_revisions
  add column internal_notes text,
  add column payment_method text,
  add column job_details jsonb not null default '{}',
  add constraint invoice_revisions_payment_method_check check
    (payment_method is null or payment_method in ('bank_transfer','cash','card','eftpos','other')),
  add constraint invoice_revisions_job_details_check check (jsonb_typeof(job_details)='object');

alter table public.invoice_lines
  add column pricing_basis text not null default 'inclusive',
  add column gst_treatment text not null default 'taxable',
  add column unit_price_ex_gst numeric(14,2),
  add column discount_type text not null default 'percent',
  add column discount_value numeric(14,2) not null default 0,
  add column tyre_details jsonb not null default '{}',
  add constraint invoice_lines_pricing_basis_check check (pricing_basis in ('exclusive','inclusive')),
  add constraint invoice_lines_gst_treatment_check check (gst_treatment in ('taxable','gst_free')),
  add constraint invoice_lines_discount_type_check check (discount_type in ('percent','fixed')),
  add constraint invoice_lines_discount_value_check check (discount_value>=0),
  add constraint invoice_lines_tyre_details_check check (jsonb_typeof(tyre_details)='object');

-- Replace the original inclusive-only arithmetic checks with checks that support
-- inclusive, exclusive and GST-free lines. Locate generated names by definition
-- because PostgreSQL numbered the unnamed Phase 4A constraints.
do $$ declare c record; begin
  for c in select conname,pg_get_constraintdef(oid) def from pg_constraint
    where conrelid='public.invoice_lines'::regclass and contype='c'
  loop
    if c.def like '%gst_rate = 0.1000%' or c.def like '%base_incl_gst = round((quantity * unit_price_incl_gst)%' then
      execute format('alter table public.invoice_lines drop constraint %I',c.conname);
    end if;
  end loop;
end $$;
alter table public.invoice_lines add constraint invoice_lines_v2_amounts_check check (
  (unit_price_incl_gst is null and unit_price_ex_gst is null and total_incl_gst is null and gst_amount is null and subtotal_ex_gst is null)
  or (unit_price_incl_gst is not null and total_incl_gst is not null and gst_amount is not null and subtotal_ex_gst is not null
    and total_incl_gst=subtotal_ex_gst+gst_amount and gst_amount>=0 and subtotal_ex_gst>=0)
);
alter table public.invoice_lines add constraint invoice_lines_v2_gst_rate_check check (
  (gst_treatment='taxable' and gst_rate=0.1000) or (gst_treatment='gst_free' and gst_rate=0)
);

-- Manual catalogue lines reference a product for description/defaults only. They deliberately
-- have no source job line, invoice cost row, reservation, or stock movement.
alter table public.invoice_lines drop constraint invoice_lines_check;
alter table public.invoice_lines add constraint invoice_lines_source_check check (
  (line_type='product' and product_id is not null and quantity>0
    and (source_job_line_id is null or quantity=trunc(quantity)))
  or (line_type='labour' and product_id is null and used_tyre_unit_id is null)
);

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash','eftpos','card','bank_transfer','other'));

alter table public.finance_action_requests drop constraint finance_action_requests_action_check;
alter table public.finance_action_requests add constraint finance_action_requests_action_check check (action in (
  'update_finance_settings','finance_draft','finance_issue','finance_revise',
  'create_invoice_from_job','complete_job_and_create_invoice','create_manual_invoice',
  'update_invoice_draft','revise_unpaid_invoice','issue_invoice','cancel_invoice',
  'record_invoice_payment','reverse_manual_payment','finalise_pos_sale',
  'create_manual_invoice_v2','update_invoice_draft_v2','duplicate_invoice_draft','void_issued_invoice'
));

create index invoices_number_search_idx on public.invoices (lower(invoice_number));
create index invoice_revisions_reference_search_idx on public.invoice_revisions (lower(customer_reference));
create index invoice_revisions_service_date_idx on public.invoice_revisions ((job_details->>'service_date'));

create or replace function private.next_invoice_number(p_location_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare prefix text; n text;
begin
  select coalesce(nullif(fs.invoice_prefix,''),'INV') into prefix
  from public.finance_settings fs where fs.singleton;
  prefix:=coalesce(prefix,'INV');
  n:=private.next_location_document_number(p_location_id,'invoice',prefix);
  return n;
end;
$$;

create or replace function private.finance_validate_job_details(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb:=coalesce(p_value,'{}'::jsonb); odo bigint;
begin
  if jsonb_typeof(v)<>'object' or exists(
    select 1 from jsonb_object_keys(v) k
    where k not in ('registration','vehicle_or_fleet_id','odometer_km','service_date','technician_reference')
  ) then raise exception 'INVALID_JOB_DETAILS' using errcode='22023'; end if;
  if v ? 'odometer_km' then
    begin odo:=(v->>'odometer_km')::bigint; exception when others then raise exception 'INVALID_ODOMETER' using errcode='22023'; end;
    if odo<0 then raise exception 'INVALID_ODOMETER' using errcode='22023'; end if;
  end if;
  if v ? 'service_date' then
    begin perform (v->>'service_date')::date; exception when others then raise exception 'INVALID_SERVICE_DATE' using errcode='22023'; end;
  end if;
  return v;
end;
$$;

create or replace function private.finance_write_v2_lines(p_invoice_id uuid,p_revision_id uuid,p_lines jsonb,p_location_id uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e jsonb; pos integer:=0; qty numeric; price numeric; basis text; treatment text;
  dtype text; dvalue numeric; base numeric; discount numeric; ex numeric; gst numeric; total numeric;
  pid uuid; lt text; tyre jsonb; header_ex numeric:=0; header_gst numeric:=0; header_total numeric:=0;
begin
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023'; end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1;
    if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e) k where k not in
      ('id','line_type','product_id','description','quantity','unit_price','unit_price_incl_gst','pricing_basis',
       'gst_treatment','discount_type','discount_value','discount_percent','discount_reason','tyre_details')) then
      raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    lt:=coalesce(e->>'line_type',case when e->>'product_id' is null then 'labour' else 'product' end);
    if lt not in ('product','labour') then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    pid:=nullif(e->>'product_id','')::uuid;
    if (lt='product')<>(pid is not null) then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    if pid is not null and not exists(select 1 from public.products p where p.id=pid and p.active) then
      raise exception 'PRODUCT_NOT_FOUND' using errcode='22023'; end if;
    if nullif(btrim(e->>'description'),'') is null then raise exception 'INVOICE_LINE_DESCRIPTION_REQUIRED' using errcode='22023'; end if;
    qty:=private.finance_decimal(e->>'quantity',3,12); if qty<=0 then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    price:=private.finance_decimal(coalesce(e->>'unit_price',e->>'unit_price_incl_gst'),2,14);
    basis:=coalesce(e->>'pricing_basis','exclusive'); treatment:=coalesce(e->>'gst_treatment','taxable');
    dtype:=coalesce(e->>'discount_type',case when e ? 'discount_percent' then 'percent' else 'percent' end);
    dvalue:=private.finance_decimal(coalesce(e->>'discount_value',e->>'discount_percent','0'),2,14);
    if basis not in ('exclusive','inclusive') or treatment not in ('taxable','gst_free') or dtype not in ('percent','fixed')
      or (dtype='percent' and dvalue>100) then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    if dvalue>0 then
      perform private.finance_guard('discounts.apply',p_location_id);
      if nullif(btrim(e->>'discount_reason'),'') is null then raise exception 'DISCOUNT_REASON_REQUIRED' using errcode='22023'; end if;
    end if;
    base:=round(qty*price,2); discount:=case when dtype='percent' then round(base*dvalue/100,2) else dvalue end;
    if discount>base then raise exception 'DISCOUNT_EXCEEDS_LINE' using errcode='22023'; end if;
    if basis='exclusive' then
      ex:=base-discount; gst:=case when treatment='taxable' then round(ex*0.10,2) else 0 end; total:=ex+gst;
    else
      total:=base-discount; gst:=case when treatment='taxable' then round(total/11,2) else 0 end; ex:=total-gst;
    end if;
    tyre:=coalesce(e->'tyre_details','{}'::jsonb);
    if jsonb_typeof(tyre)<>'object' or exists(select 1 from jsonb_object_keys(tyre) k where k not in
      ('brand','model','size','position','quantity_fitted','serial_dot')) then raise exception 'INVALID_TYRE_DETAILS' using errcode='22023'; end if;
    insert into public.invoice_lines(invoice_id,revision_id,position,product_id,line_type,description,quantity,
      unit_price_incl_gst,discount_percent,discount_reason,discount_actor_user_id,discount_authorised_at,
      base_incl_gst,discount_amount,total_incl_gst,gst_amount,subtotal_ex_gst,gst_rate,
      pricing_basis,gst_treatment,unit_price_ex_gst,discount_type,discount_value,tyre_details)
    values(p_invoice_id,p_revision_id,pos,pid,lt,btrim(e->>'description'),qty,
      case when basis='inclusive' then price else round(price*(case when treatment='taxable' then 1.1 else 1 end),2) end,
      case when dtype='percent' then dvalue else 0 end,nullif(btrim(e->>'discount_reason'),''),
      case when dvalue>0 then p_actor end,case when dvalue>0 then now() end,
      case when basis='inclusive' then base else round(base*(case when treatment='taxable' then 1.1 else 1 end),2) end,
      discount,total,gst,ex,case when treatment='taxable' then 0.1000 else 0 end,
      basis,treatment,case when basis='exclusive' then price else round(price/(case when treatment='taxable' then 1.1 else 1 end),2) end,
      dtype,dvalue,tyre);
    header_ex:=header_ex+ex; header_gst:=header_gst+gst; header_total:=header_total+total;
  end loop;
  update public.invoice_revisions set subtotal_ex_gst=header_ex,gst_amount=header_gst,total_incl_gst=header_total,
    pricing_complete=true where id=p_revision_id;
end;
$$;

create function public.create_manual_invoice_v2(p_request_id uuid,p_location_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; iid uuid:=extensions.gen_random_uuid(); rid uuid:=extensions.gen_random_uuid(); number text;
  c public.customers%rowtype; v public.customer_vehicles%rowtype; terms text; result jsonb; replay jsonb; payload jsonb;
  issue date; due date; method text; jobs jsonb;
begin
  actor:=private.finance_guard('invoices.create',p_location_id); perform private.finance_guard('invoices.view',p_location_id);
  perform private.finance_json_keys(p_input,array['customer_id','customer_vehicle_id','payment_terms','issue_date','due_date',
    'customer_reference','customer_notes','internal_notes','payment_method','job_details','lines']);
  if p_input->>'customer_id' is not null then
    select * into c from public.customers where id=(p_input->>'customer_id')::uuid and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
  end if;
  if p_input->>'customer_vehicle_id' is not null then
    select * into v from public.customer_vehicles where id=(p_input->>'customer_vehicle_id')::uuid and customer_id=c.id and active;
    if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  end if;
  select coalesce(nullif(p_input->>'payment_terms',''),fs.default_payment_terms,'7_days') into terms from public.finance_settings fs where fs.singleton;
  terms:=coalesce(terms,'7_days'); if terms not in ('due_on_receipt','7_days','14_days','30_days') then raise exception 'INVALID_PAYMENT_TERMS' using errcode='22023'; end if;
  begin issue:=nullif(p_input->>'issue_date','')::date; due:=nullif(p_input->>'due_date','')::date; exception when others then raise exception 'INVALID_INVOICE_DATE' using errcode='22023'; end;
  if issue is not null and due is not null and due<issue then raise exception 'INVALID_INVOICE_DATE' using errcode='22023'; end if;
  method:=nullif(p_input->>'payment_method',''); if method is not null and method not in ('bank_transfer','cash','card','eftpos','other') then raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023'; end if;
  jobs:=private.finance_validate_job_details(p_input->'job_details');
  payload:=jsonb_build_object('location',p_location_id,'input',p_input); replay:=private.finance_request(p_request_id,'create_manual_invoice_v2',payload); if replay is not null then return replay; end if;
  number:=private.next_invoice_number(p_location_id);
  insert into public.invoices(id,invoice_number,location_id,customer_id,customer_vehicle_id,source_type,status,created_by)
  values(iid,number,p_location_id,c.id,v.id,'manual','draft',actor);
  insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,issue_date,due_date,payment_terms,
    customer_reference,customer_notes,internal_notes,payment_method,job_details,created_by)
  values(rid,iid,1,'draft',issue,due,terms,nullif(btrim(p_input->>'customer_reference'),''),nullif(btrim(p_input->>'customer_notes'),''),
    nullif(btrim(p_input->>'internal_notes'),''),method,jobs,actor);
  perform private.finance_write_v2_lines(iid,rid,p_input->'lines',p_location_id,actor);
  update public.invoices set current_revision_id=rid where id=iid;
  result:=jsonb_build_object('invoice_id',iid,'invoice_number',number,'revision_id',rid,'status','draft','version',1,'pricing_complete',true);
  perform private.sales_audit('INVOICE_CREATED','invoice',iid,p_location_id,jsonb_build_object('invoice_number',number,'source_type','manual_v2'));
  perform private.finance_request_finish(p_request_id,'create_manual_invoice_v2',payload,p_location_id,iid,result); return result;
end;
$$;

create function public.update_invoice_draft_v2(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; oldr public.invoice_revisions%rowtype; nr uuid:=extensions.gen_random_uuid(); actor uuid;
  payload jsonb; replay jsonb; result jsonb; jobs jsonb; terms text; issue date; due date; method text;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.edit',i.location_id); perform private.finance_guard('invoices.view',i.location_id);
  payload:=jsonb_build_object('expected_version',p_expected_version,'input',p_input); replay:=private.finance_request(p_request_id,'update_invoice_draft_v2',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  if i.status<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  select * into oldr from public.invoice_revisions where id=i.current_revision_id;
  perform private.finance_json_keys(p_input,array['payment_terms','issue_date','due_date','customer_reference','customer_notes','internal_notes','payment_method','job_details','lines']);
  terms:=coalesce(nullif(p_input->>'payment_terms',''),oldr.payment_terms); issue:=coalesce(nullif(p_input->>'issue_date','')::date,oldr.issue_date); due:=coalesce(nullif(p_input->>'due_date','')::date,oldr.due_date);
  if due is not null and issue is not null and due<issue then raise exception 'INVALID_INVOICE_DATE' using errcode='22023'; end if;
  method:=coalesce(nullif(p_input->>'payment_method',''),oldr.payment_method); jobs:=case when p_input ? 'job_details' then private.finance_validate_job_details(p_input->'job_details') else oldr.job_details end;
  -- Draft revisions are mutable, but replace them atomically so line additions/removals cannot leave partial totals.
  delete from public.invoice_lines where revision_id=oldr.id;
  update public.invoice_revisions set issue_date=issue,due_date=due,payment_terms=terms,
    customer_reference=case when p_input ? 'customer_reference' then nullif(btrim(p_input->>'customer_reference'),'') else customer_reference end,
    customer_notes=case when p_input ? 'customer_notes' then nullif(btrim(p_input->>'customer_notes'),'') else customer_notes end,
    internal_notes=case when p_input ? 'internal_notes' then nullif(btrim(p_input->>'internal_notes'),'') else internal_notes end,
    payment_method=method,job_details=jobs,version=version+1 where id=oldr.id;
  perform private.finance_write_v2_lines(i.id,oldr.id,p_input->'lines',i.location_id,actor);
  update public.invoices set version=version+1,updated_at=now() where id=i.id;
  result:=jsonb_build_object('invoice_id',i.id,'revision_id',oldr.id,'version',i.version+1,'pricing_complete',true);
  perform private.sales_audit('INVOICE_DRAFT_UPDATED','invoice',i.id,i.location_id,jsonb_build_object('version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'update_invoice_draft_v2',payload,i.location_id,i.id,result); return result;
end;
$$;

create function public.duplicate_invoice_draft(p_request_id uuid,p_invoice_id uuid,p_location_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; target uuid; payload jsonb; replay jsonb; input jsonb; result jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id); target:=coalesce(p_location_id,i.location_id); perform private.finance_guard('invoices.create',target);
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'location_id',target); replay:=private.finance_request(p_request_id,'duplicate_invoice_draft',payload); if replay is not null then return replay; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id;
  input:=jsonb_build_object('customer_id',i.customer_id,'customer_vehicle_id',i.customer_vehicle_id,'payment_terms',r.payment_terms,
    'customer_reference',r.customer_reference,'customer_notes',r.customer_notes,'internal_notes',r.internal_notes,'payment_method',r.payment_method,
    'job_details',r.job_details,'lines',(select jsonb_agg(jsonb_build_object('line_type',l.line_type,'product_id',l.product_id,
      'description',l.description,'quantity',l.quantity,'unit_price',case when l.pricing_basis='exclusive' then l.unit_price_ex_gst else l.unit_price_incl_gst end,
      'pricing_basis',l.pricing_basis,'gst_treatment',l.gst_treatment,'discount_type',l.discount_type,'discount_value',l.discount_value,
      'discount_reason',l.discount_reason,'tyre_details',l.tyre_details) order by l.position) from public.invoice_lines l where l.revision_id=r.id));
  -- Child key makes the composed create independently idempotent.
  result:=public.create_manual_invoice_v2(private.finance_child_uuid(p_request_id,'duplicate',1),target,input);
  perform private.finance_request_finish(p_request_id,'duplicate_invoice_draft',payload,target,(result->>'invoice_id')::uuid,result); return result;
end;
$$;

create function public.void_issued_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; reason text:=nullif(btrim(p_reason),''); payload jsonb; replay jsonb; result jsonb; projection jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('invoices.cancel',i.location_id);
  if reason is null or length(reason)>500 then raise exception 'CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=jsonb_build_object('expected_version',p_expected_version,'reason',reason); replay:=private.finance_request(p_request_id,'void_issued_invoice',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  if i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  projection:=private.finance_invoice_projection(i.id,false);
  if (projection->>'effective_paid')::numeric<>0 or i.first_payment_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
  update public.invoices set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=reason,version=version+1,updated_at=now() where id=i.id;
  result:=jsonb_build_object('invoice_id',i.id,'status','cancelled','version',i.version+1,'voided',true);
  perform private.sales_audit('INVOICE_VOIDED','invoice',i.id,i.location_id,jsonb_build_object('invoice_number',i.invoice_number,'reason',reason,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'void_issued_invoice',payload,i.location_id,i.id,result); return result;
end;
$$;

create function public.invoice_summary_v2(p_location_id uuid default null,p_status text default null,p_source_type text default null,p_search text default null,
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
    select i.*,r.issue_date,r.due_date,r.total_incl_gst,r.gst_amount,r.subtotal_ex_gst,r.customer_reference,
      coalesce(r.customer_snapshot->>'display_name',c.display_name,'Walk-In Customer') customer_name,
      private.finance_invoice_projection(i.id,false) financials
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id left join public.customers c on c.id=i.customer_id
    where (private.app_is_admin() or i.location_id=private.app_user_location_id()) and (p_location_id is null or i.location_id=p_location_id)
      and (p_source_type is null or i.source_type=p_source_type)
      and (term is null or lower(concat_ws(' ',i.invoice_number,c.display_name,r.customer_snapshot->>'display_name',r.customer_reference,r.job_details->>'registration',r.job_details->>'vehicle_or_fleet_id')) like '%'||term||'%')
  ), filtered as (
    select *,case when status='cancelled' then 'void' when status='draft' then 'draft'
      when (financials->>'payment_state')='paid' then 'paid' when (financials->>'payment_state')='partial' then 'partial'
      when (financials->>'is_overdue')::boolean then 'overdue' else 'sent' end display_status from data
  ), chosen as (select * from filtered where p_status is null or status=p_status or display_status=p_status)
  select count(*) into total from chosen;
  with data as (
    select i.*,r.issue_date,r.due_date,r.total_incl_gst,r.gst_amount,r.subtotal_ex_gst,r.customer_reference,
      coalesce(r.customer_snapshot->>'display_name',c.display_name,'Walk-In Customer') customer_name,private.finance_invoice_projection(i.id,false) financials
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id left join public.customers c on c.id=i.customer_id
    where (private.app_is_admin() or i.location_id=private.app_user_location_id()) and (p_location_id is null or i.location_id=p_location_id)
      and (p_source_type is null or i.source_type=p_source_type)
      and (term is null or lower(concat_ws(' ',i.invoice_number,c.display_name,r.customer_snapshot->>'display_name',r.customer_reference,r.job_details->>'registration',r.job_details->>'vehicle_or_fleet_id')) like '%'||term||'%')
  ), filtered as (
    select *,case when status='cancelled' then 'void' when status='draft' then 'draft' when (financials->>'payment_state')='paid' then 'paid'
      when (financials->>'payment_state')='partial' then 'partial' when (financials->>'is_overdue')::boolean then 'overdue' else 'sent' end display_status from data
  ), chosen as (select * from filtered where p_status is null or status=p_status or display_status=p_status), page as (
    select * from chosen order by
      case when p_direction='asc' and p_sort='created_at' then created_at end asc,case when p_direction='desc' and p_sort='created_at' then created_at end desc,
      case when p_direction='asc' and p_sort='invoice_number' then invoice_number end asc,case when p_direction='desc' and p_sort='invoice_number' then invoice_number end desc,
      case when p_direction='asc' and p_sort='customer_name' then customer_name end asc,case when p_direction='desc' and p_sort='customer_name' then customer_name end desc,
      case when p_direction='asc' and p_sort='issue_date' then issue_date end asc,case when p_direction='desc' and p_sort='issue_date' then issue_date end desc,
      case when p_direction='asc' and p_sort='due_date' then due_date end asc,case when p_direction='desc' and p_sort='due_date' then due_date end desc,
      case when p_direction='asc' and p_sort='total' then total_incl_gst end asc,case when p_direction='desc' and p_sort='total' then total_incl_gst end desc,
      case when p_direction='asc' and p_sort='balance' then (financials->>'balance')::numeric end asc,case when p_direction='desc' and p_sort='balance' then (financials->>'balance')::numeric end desc,
      case when p_direction='asc' and p_sort='status' then display_status end asc,case when p_direction='desc' and p_sort='status' then display_status end desc,id
    offset p_offset limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'invoice_number',invoice_number,'location_id',location_id,'customer_id',customer_id,
    'customer_name',customer_name,'source_type',source_type,'status',status,'display_status',display_status,'issue_date',issue_date,'due_date',due_date,
    'subtotal_ex_gst',subtotal_ex_gst,'gst_amount',gst_amount,'total_incl_gst',total_incl_gst,'effective_paid',financials->'effective_paid',
    'balance',financials->'balance','version',version,'created_at',created_at) order by array_position(array(select id from page),id)),'[]'::jsonb) into rows from page;
  return jsonb_build_object('rows',rows,'total',total,'offset',p_offset,'limit',p_limit);
end;
$$;

-- Immutable audit trail for explicit invoice email attempts. Provider secrets are
-- intentionally absent; only provider metadata and the failure outcome are kept.
create table public.invoice_email_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_revision_id uuid not null references public.invoice_revisions(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  recipient text not null check (recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  sender text not null check (btrim(sender) <> ''),
  attempted_at timestamptz not null default now(),
  provider text not null check (btrim(provider) <> ''),
  provider_message_id text,
  delivery_state text not null check (delivery_state in ('sent','failed','disabled')),
  error_message text,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  retry_of uuid references public.invoice_email_deliveries(id) on delete restrict
);
alter table public.invoice_email_deliveries enable row level security;
revoke all on public.invoice_email_deliveries from public,anon,authenticated,service_role;
create index invoice_email_deliveries_invoice_idx on public.invoice_email_deliveries(invoice_id, attempted_at desc);
create trigger invoice_email_deliveries_immutable before update or delete on public.invoice_email_deliveries for each row execute function private.finance_immutable();
create or replace function public.record_invoice_email_delivery(
  p_invoice_id uuid,p_invoice_revision_id uuid,p_recipient text,p_sender text,p_provider text,
  p_delivery_state text,p_provider_message_id text default null,p_error_message text default null,p_retry_of uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; actor uuid; id uuid;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('documents.send',i.location_id);
  select * into r from public.invoice_revisions where id=p_invoice_revision_id and invoice_id=i.id;
  if not found or i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  if p_delivery_state not in ('sent','failed','disabled') or p_provider not in ('resend','disabled') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_delivery_state='sent' and (p_provider_message_id is null or p_error_message is not null) then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  insert into public.invoice_email_deliveries(invoice_id,invoice_revision_id,revision_number,recipient,sender,provider,provider_message_id,delivery_state,error_message,actor_user_id,retry_of)
    values(i.id,r.id,r.revision_number,lower(btrim(p_recipient)),btrim(p_sender),p_provider,p_provider_message_id,p_delivery_state,left(nullif(btrim(p_error_message),''),2000),actor,p_retry_of)
    returning id into id;
  return jsonb_build_object('id',id,'delivery_state',p_delivery_state);
end; $$;
revoke execute on function public.record_invoice_email_delivery(uuid,uuid,text,text,text,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.record_invoice_email_delivery(uuid,uuid,text,text,text,text,text,text,uuid) to authenticated;

-- Expose richer snapshots/line metadata without exposing restricted cost data.
create or replace function public.invoice_detail(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; revisions jsonb; documents jsonb:='[]'; email_deliveries jsonb:='[]'; projection jsonb; can_payments boolean; can_send boolean;
begin
  perform private.finance_guard('invoices.view'); select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if; perform private.finance_guard('invoices.view',i.location_id);
  can_payments:=private.app_has_permission('payments.view'); can_send:=private.app_has_permission('documents.send');
  select jsonb_agg(jsonb_build_object('id',r.id,'revision_number',r.revision_number,'lifecycle',r.lifecycle,'issued_at',r.issued_at,
    'issue_date',r.issue_date,'due_date',r.due_date,'payment_terms',r.payment_terms,'total_incl_gst',r.total_incl_gst,
    'subtotal_ex_gst',r.subtotal_ex_gst,'gst_amount',r.gst_amount,'pricing_complete',r.pricing_complete,'revision_reason',r.revision_reason,
    'customer_reference',r.customer_reference,'customer_notes',r.customer_notes,'internal_notes',r.internal_notes,'payment_method',r.payment_method,
    'job_details',r.job_details,'customer_snapshot',r.customer_snapshot,'vehicle_snapshot',r.vehicle_snapshot,'business_snapshot',r.business_snapshot,
    'branch_snapshot',r.branch_snapshot,'billing_contact_snapshot',r.billing_contact_snapshot,'lines',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',l.id,'position',l.position,'line_type',l.line_type,'description',l.description,'quantity',l.quantity,'product_id',l.product_id,
      'unit_price_incl_gst',l.unit_price_incl_gst,'unit_price_ex_gst',l.unit_price_ex_gst,'pricing_basis',l.pricing_basis,
      'gst_treatment',l.gst_treatment,'discount_type',l.discount_type,'discount_value',l.discount_value,'discount_percent',l.discount_percent,
      'discount_reason',l.discount_reason,'discount_amount',l.discount_amount,'subtotal_ex_gst',l.subtotal_ex_gst,'gst_amount',l.gst_amount,
      'total_incl_gst',l.total_incl_gst,'tyre_details',l.tyre_details,'source_job_line_id',l.source_job_line_id,'used_tyre_unit_id',l.used_tyre_unit_id
    ) order by l.position),'[]') from public.invoice_lines l where l.revision_id=r.id)) order by r.revision_number) into revisions
  from public.invoice_revisions r where r.invoice_id=i.id;
  if can_payments then select coalesce(jsonb_agg(to_jsonb(d)-'snapshot' order by d.created_at),'[]') into documents from public.financial_documents d where d.invoice_id=i.id; end if;
  if can_send then select coalesce(jsonb_agg(to_jsonb(d) order by d.attempted_at desc),'[]') into email_deliveries from public.invoice_email_deliveries d where d.invoice_id=i.id; end if;
  projection:=private.finance_invoice_projection(i.id,can_payments);
  return to_jsonb(i)||jsonb_build_object('revisions',coalesce(revisions,'[]'),'documents',documents,'financials',projection-'payments',
    'payments',case when can_payments then projection->'payments' else '[]'::jsonb end,'email_deliveries',email_deliveries);
end;
$$;

revoke execute on function private.next_invoice_number(uuid),private.finance_validate_job_details(jsonb),private.finance_write_v2_lines(uuid,uuid,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.create_manual_invoice_v2(uuid,uuid,jsonb),public.update_invoice_draft_v2(uuid,uuid,integer,jsonb),
  public.duplicate_invoice_draft(uuid,uuid,uuid),public.void_issued_invoice(uuid,uuid,integer,text),
  public.invoice_summary_v2(uuid,text,text,text,text,text,integer,integer) from public,anon,service_role;
grant execute on function public.create_manual_invoice_v2(uuid,uuid,jsonb),public.update_invoice_draft_v2(uuid,uuid,integer,jsonb),
  public.duplicate_invoice_draft(uuid,uuid,uuid),public.void_issued_invoice(uuid,uuid,integer,text),
  public.invoice_summary_v2(uuid,text,text,text,text,text,integer,integer) to authenticated;
