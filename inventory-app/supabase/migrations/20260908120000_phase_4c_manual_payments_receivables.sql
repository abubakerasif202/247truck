-- Phase 4C: immutable manual payments, full reversals and derived receivables.
-- Provider reconciliation, credits, refunds and external delivery remain inactive.

alter table public.finance_action_requests drop constraint finance_action_requests_action_check;
alter table public.finance_action_requests add constraint finance_action_requests_action_check check (action in (
  'update_finance_settings','finance_draft','finance_issue','finance_revise',
  'create_invoice_from_job','complete_job_and_create_invoice','create_manual_invoice','update_invoice_draft',
  'issue_invoice','revise_unpaid_invoice','cancel_invoice','record_invoice_payment',
  'reverse_manual_payment','finalise_pos_sale'
));

alter table public.financial_documents drop constraint financial_documents_invoice_revision_id_document_type_key;
alter table public.financial_documents drop constraint financial_documents_document_type_check;
alter table public.financial_documents add constraint financial_documents_document_type_check
  check (document_type in ('tax_invoice','payment_receipt','payment_correction'));
create unique index financial_documents_tax_invoice_revision_uidx
  on public.financial_documents(invoice_revision_id,document_type) where document_type='tax_invoice';

create table public.payments (
  id uuid primary key,
  request_id uuid not null unique,
  invoice_id uuid not null,
  invoice_revision_id uuid not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  method text not null check (method in ('cash','eftpos','bank_transfer')),
  currency text not null default 'AUD' check (currency='AUD'),
  amount numeric(14,2) not null check (amount>0),
  status text not null default 'succeeded' check (status='succeeded'),
  reference text check (reference is null or (nullif(btrim(reference),'') is not null and length(reference)<=200)),
  notes text check (notes is null or (nullif(btrim(notes),'') is not null and length(notes)<=1000)),
  received_at timestamptz not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version=1),
  foreign key (invoice_id,invoice_revision_id) references public.invoice_revisions(invoice_id,id) on delete restrict
);

create table public.payment_reversals (
  id uuid primary key,
  request_id uuid not null unique,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  amount numeric(14,2) not null check (amount>0),
  reason text not null check (nullif(btrim(reason),'') is not null and length(reason)<=500),
  reversed_by uuid not null references auth.users(id) on delete restrict,
  reversed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version=1)
);

alter table public.financial_documents add column payment_reversal_id uuid
  references public.payment_reversals(id) on delete restrict;

alter table public.payments enable row level security;
alter table public.payment_reversals enable row level security;
revoke all on public.payments,public.payment_reversals from public,anon,authenticated,service_role;

create index payments_invoice_received_idx on public.payments(invoice_id,received_at,id);
create index payments_location_received_idx on public.payments(location_id,received_at,id);
create index payments_customer_idx on public.payments(customer_id,received_at,id);
create index payments_revision_idx on public.payments(invoice_id,invoice_revision_id);
create index payments_actor_idx on public.payments(recorded_by,recorded_at);
create index payments_reference_idx on public.payments(method,lower(reference)) where reference is not null;
create index payment_reversals_invoice_idx on public.payment_reversals(invoice_id,reversed_at,id);
create index payment_reversals_location_idx on public.payment_reversals(location_id,reversed_at,id);
create index payment_reversals_actor_idx on public.payment_reversals(reversed_by,reversed_at);
create index financial_documents_reversal_idx on public.financial_documents(payment_reversal_id) where payment_reversal_id is not null;

create policy payments_branch_read on public.payments for select to authenticated using (
  (select private.app_has_permission('payments.view')) and
  ((select private.app_is_admin()) or location_id=(select private.app_user_location_id()))
);
create policy payment_reversals_branch_read on public.payment_reversals for select to authenticated using (
  (select private.app_has_permission('payments.view')) and
  ((select private.app_is_admin()) or location_id=(select private.app_user_location_id()))
);

create trigger payments_immutable before update or delete on public.payments
  for each row execute function private.finance_immutable();
create trigger payment_reversals_immutable before update or delete on public.payment_reversals
  for each row execute function private.finance_immutable();

create or replace function private.finance_child_uuid(p_request_id uuid,p_kind text,p_position integer)
returns uuid language sql immutable set search_path='' as $$
  select (substr(x,1,8)||'-'||substr(x,9,4)||'-4'||substr(x,14,3)||'-a'||substr(x,18,3)||'-'||substr(x,21,12))::uuid
  from (select pg_catalog.md5(p_request_id::text||':'||p_kind||':'||p_position::text) x) s;
$$;

create or replace function private.finance_invoice_projection(p_invoice_id uuid,p_include_history boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare total numeric(14,2); gross numeric(14,2); reversed numeric(14,2); effective numeric(14,2);
  due date; state text; bucket text; history jsonb:='[]'::jsonb; business_date date;
begin
  select r.total_incl_gst,r.due_date into total,due from public.invoices i
    join public.invoice_revisions r on r.id=i.current_revision_id where i.id=p_invoice_id;
  if total is null then total:=0; end if;
  select coalesce(sum(p.amount),0),coalesce(sum(case when pr.id is not null then p.amount else 0 end),0)
    into gross,reversed from public.payments p left join public.payment_reversals pr on pr.payment_id=p.id
    where p.invoice_id=p_invoice_id and p.status='succeeded';
  effective:=gross-reversed;
  if effective<0 or effective>total then raise exception 'FINANCE_INVARIANT_VIOLATION' using errcode='23514'; end if;
  state:=case when effective=0 then 'unpaid' when effective=total then 'paid' else 'partial' end;
  business_date:=(pg_catalog.now() at time zone 'Australia/Adelaide')::date;
  bucket:=case when due is null or due>=business_date then 'current' when business_date-due between 1 and 7 then '1_7'
    when business_date-due between 8 and 14 then '8_14' when business_date-due between 15 and 29 then '15_29' else '30_plus' end;
  if p_include_history then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id,'method',p.method,'amount',p.amount,'reference',p.reference,'notes',p.notes,
      'received_at',p.received_at,'recorded_at',p.recorded_at,'recorded_by',p.recorded_by,
      'reversed',pr.id is not null,'reversal',case when pr.id is null then null else pg_catalog.jsonb_build_object(
        'id',pr.id,'reason',pr.reason,'reversed_at',pr.reversed_at,'reversed_by',pr.reversed_by) end
    ) order by p.received_at,p.id),'[]'::jsonb) into history
    from public.payments p left join public.payment_reversals pr on pr.payment_id=p.id where p.invoice_id=p_invoice_id;
  end if;
  return pg_catalog.jsonb_build_object('total',total,'credits',0,'gross_paid',gross,'reversed',reversed,
    'effective_paid',effective,'applied_to_sale',effective,'actual_net_cash',effective,'balance',total-effective,
    'refund_due',0,'payment_state',state,'due_date',due,'is_overdue',state<>'paid' and due<business_date,
    'aging_bucket',bucket,'payments',history);
end;
$$;

create or replace function private.finance_record_tenders(p_request_id uuid,p_invoice_id uuid,p_tenders jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; actor uuid:=(select auth.uid()); row jsonb;
  pos integer:=0; amount numeric; tender_total numeric:=0; projection jsonb; ids jsonb:='[]'::jsonb;
  warnings jsonb:='[]'::jsonb; payment_id uuid; child_request uuid; received timestamptz;
  tender_method text; ref text; note text;
begin
  if actor is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('payments.view',i.location_id);
  perform private.finance_guard('payments.record',i.location_id);
  if p_tenders is null or pg_catalog.jsonb_typeof(p_tenders)<>'array' or pg_catalog.jsonb_array_length(p_tenders)=0 then
    raise exception 'PAYMENT_TENDERS_REQUIRED' using errcode='22023';
  end if;
  if pg_catalog.jsonb_array_length(p_tenders)>20 then raise exception 'PAYMENT_TENDER_LIMIT' using errcode='22023'; end if;
  if i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id;
  if r.lifecycle<>'issued' or not r.pricing_complete then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  projection:=private.finance_invoice_projection(i.id,false);
  for row in select value from pg_catalog.jsonb_array_elements(p_tenders) loop
    pos:=pos+1;
    perform private.finance_json_keys(row,array['method','amount','reference','notes','received_at']);
    tender_method:=row->>'method'; ref:=nullif(btrim(row->>'reference'),''); note:=nullif(btrim(row->>'notes'),'');
    if tender_method not in ('cash','eftpos','bank_transfer') then raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023'; end if;
    if row->>'amount' is null or row->>'amount' !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'INVALID_PAYMENT_AMOUNT' using errcode='22023'; end if;
    begin amount:=(row->>'amount')::numeric(14,2); exception when numeric_value_out_of_range then raise exception 'INVALID_PAYMENT_AMOUNT' using errcode='22023'; end;
    if amount<=0 then raise exception 'INVALID_PAYMENT_AMOUNT' using errcode='22023'; end if;
    if ref is not null and length(ref)>200 or note is not null and length(note)>1000 then raise exception 'INVALID_PAYMENT_INPUT' using errcode='22023'; end if;
    begin received:=coalesce((row->>'received_at')::timestamptz,pg_catalog.now()); exception when others then raise exception 'INVALID_PAYMENT_INPUT' using errcode='22023'; end;
    if received>pg_catalog.now()+interval '5 minutes' then raise exception 'INVALID_PAYMENT_INPUT' using errcode='22023'; end if;
    tender_total:=tender_total+amount;
  end loop;
  if tender_total>(projection->>'balance')::numeric then raise exception 'PAYMENT_EXCEEDS_BALANCE' using errcode='22023'; end if;
  pos:=0;
  for row in select value from pg_catalog.jsonb_array_elements(p_tenders) loop
    pos:=pos+1; tender_method:=row->>'method'; amount:=(row->>'amount')::numeric(14,2);
    ref:=nullif(btrim(row->>'reference'),''); note:=nullif(btrim(row->>'notes'),'');
    received:=coalesce((row->>'received_at')::timestamptz,pg_catalog.now());
    payment_id:=private.finance_child_uuid(p_request_id,'payment',pos);
    child_request:=private.finance_child_uuid(p_request_id,'payment-request',pos);
    if ref is not null and exists(select 1 from public.payments p where p.method=tender_method and lower(p.reference)=lower(ref)) then
      warnings:=warnings||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('code','DUPLICATE_PAYMENT_REFERENCE','position',pos));
    end if;
    insert into public.payments(id,request_id,invoice_id,invoice_revision_id,location_id,customer_id,method,amount,reference,notes,received_at,recorded_by)
    values(payment_id,child_request,i.id,r.id,i.location_id,i.customer_id,tender_method,amount,ref,note,received,actor);
    ids:=ids||pg_catalog.jsonb_build_array(payment_id);
    insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version,created_by)
    values(i.id,i.location_id,r.id,'payment_receipt',null,'payment_receipt/'||payment_id::text||'/v1',
      pg_catalog.jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,'payment_id',payment_id,'method',tender_method,
        'amount',amount,'received_at',received),'v1',actor);
  end loop;
  update public.invoices set first_payment_at=coalesce(first_payment_at,pg_catalog.now()),updated_at=pg_catalog.now(),version=version+1 where id=i.id;
  projection:=private.finance_invoice_projection(i.id,false);
  perform private.sales_audit('PAYMENT_RECORDED','invoice',i.id,i.location_id,
    pg_catalog.jsonb_build_object('request_id',p_request_id,'payment_ids',ids,'amount',tender_total,'version_after',i.version+1));
  return projection- 'payments'||pg_catalog.jsonb_build_object('invoice_id',i.id,'version',i.version+1,
    'payment_ids',ids,'warnings',warnings,'total_tendered',tender_total);
end;
$$;

create or replace function public.record_invoice_payment(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_tenders jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; payload jsonb; replay jsonb; result jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('payments.view',i.location_id);
  perform private.finance_guard('payments.record',i.location_id);
  payload:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'tenders',p_tenders);
  replay:=private.finance_request(p_request_id,'record_invoice_payment',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  result:=private.finance_record_tenders(p_request_id,p_invoice_id,p_tenders);
  perform private.finance_request_finish(p_request_id,'record_invoice_payment',payload,i.location_id,i.id,result);
  return result;
end;
$$;

create or replace function public.reverse_manual_payment(p_request_id uuid,p_invoice_id uuid,p_payment_id uuid,
  p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; p public.payments%rowtype; actor uuid; payload jsonb; replay jsonb; result jsonb;
  reversal_id uuid:=private.finance_child_uuid(p_request_id,'reversal',1); reason text:=nullif(btrim(p_reason),''); projection jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('payments.view',i.location_id);
  perform private.finance_guard('payments.reverse',i.location_id);
  if reason is null or length(reason)>500 then raise exception 'PAYMENT_REVERSAL_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'payment_id',p_payment_id,'expected_version',p_expected_version,'reason',reason);
  replay:=private.finance_request(p_request_id,'reverse_manual_payment',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  select * into p from public.payments where id=p_payment_id for update;
  if p.id is null or p.invoice_id<>i.id or p.location_id<>i.location_id then raise exception 'PAYMENT_NOT_FOUND' using errcode='22023'; end if;
  if exists(select 1 from public.payment_reversals x where x.payment_id=p.id) then raise exception 'PAYMENT_ALREADY_REVERSED' using errcode='22023'; end if;
  insert into public.payment_reversals(id,request_id,payment_id,invoice_id,location_id,amount,reason,reversed_by)
  values(reversal_id,private.finance_child_uuid(p_request_id,'reversal-request',1),p.id,i.id,i.location_id,p.amount,reason,actor);
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,payment_reversal_id,document_type,document_number,source_key,snapshot,template_version,created_by)
  values(i.id,i.location_id,p.invoice_revision_id,reversal_id,'payment_correction',null,'payment_correction/'||reversal_id::text||'/v1',
    pg_catalog.jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,'payment_id',p.id,'payment_reversal_id',reversal_id,
      'amount',p.amount,'reason',reason),'v1',actor);
  update public.invoices set updated_at=pg_catalog.now(),version=version+1 where id=i.id;
  projection:=private.finance_invoice_projection(i.id,false);
  result:=projection-'payments'||pg_catalog.jsonb_build_object('invoice_id',i.id,'payment_id',p.id,'payment_reversal_id',reversal_id,'version',i.version+1);
  perform private.sales_audit('PAYMENT_REVERSED','invoice',i.id,i.location_id,
    pg_catalog.jsonb_build_object('request_id',p_request_id,'payment_id',p.id,'payment_reversal_id',reversal_id,'amount',p.amount,'reason',reason,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'reverse_manual_payment',payload,i.location_id,i.id,result);
  return result;
end;
$$;

-- Preserve the 4B detail contract and add separately permissioned finance fields.
create or replace function public.invoice_detail(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; revisions jsonb; documents jsonb:='[]'::jsonb; job jsonb; projection jsonb; can_payments boolean;
begin
  perform private.finance_guard('invoices.view');
  select * into i from public.invoices x where x.id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  can_payments:=private.app_has_permission('payments.view');
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
  if can_payments then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',d.id,'document_type',d.document_type,
      'document_number',d.document_number,'invoice_revision_id',d.invoice_revision_id,'render_status',d.render_status) order by d.created_at),'[]'::jsonb)
      into documents from public.financial_documents d where d.invoice_id=i.id;
  end if;
  if i.job_id is not null then select pg_catalog.jsonb_build_object('id',j.id,'job_number',j.job_number,'status',j.status,'completed_at',j.completed_at)
    into job from public.jobs j where j.id=i.job_id; end if;
  projection:=private.finance_invoice_projection(i.id,can_payments);
  return pg_catalog.jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'location_id',i.location_id,
    'customer_id',i.customer_id,'customer_vehicle_id',i.customer_vehicle_id,'job_id',i.job_id,'job',job,
    'source_type',i.source_type,'status',i.status,'version',i.version,'current_revision_id',i.current_revision_id,
    'first_issued_at',i.first_issued_at,'first_payment_at',i.first_payment_at,'cancelled_at',i.cancelled_at,
    'cancellation_reason',i.cancellation_reason,'operational_notes',i.operational_notes,
    'reminders_suppressed',i.reminders_suppressed,'suppression_reason',i.suppression_reason,
    'delivery_email_override',i.delivery_email_override,'created_at',i.created_at,'updated_at',i.updated_at,
    'revisions',coalesce(revisions,'[]'::jsonb),'documents',documents,'financials',projection-'payments',
    'payments',case when can_payments then projection->'payments' else '[]'::jsonb end);
end;
$$;

drop function public.invoice_summary(uuid,text,text,timestamptz,integer);
create function public.invoice_summary(p_location_id uuid default null,p_status text default null,
  p_source_type text default null,p_cursor timestamptz default null,p_limit integer default 50)
returns table(id uuid,invoice_number text,location_id uuid,customer_id uuid,customer_name text,source_type text,
  job_id uuid,status text,issue_date date,due_date date,pricing_complete boolean,total_incl_gst numeric,
  gst_amount numeric,revision_number integer,version integer,created_at timestamptz,gross_paid numeric,reversed numeric,
  effective_paid numeric,balance numeric,payment_state text,is_overdue boolean,aging_bucket text)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.finance_guard('invoices.view');
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  if p_status is not null and p_status not in ('draft','issued','cancelled') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_source_type is not null and p_source_type not in ('job','pos','manual') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  return query select i.id,i.invoice_number,i.location_id,i.customer_id,
    coalesce(r.customer_snapshot->>'display_name',c.display_name,case when i.customer_id is null then 'Walk-In Customer' end),
    i.source_type,i.job_id,i.status,r.issue_date,r.due_date,r.pricing_complete,r.total_incl_gst,r.gst_amount,r.revision_number,i.version,i.created_at,
    (x.j->>'gross_paid')::numeric,(x.j->>'reversed')::numeric,(x.j->>'effective_paid')::numeric,(x.j->>'balance')::numeric,
    x.j->>'payment_state',(x.j->>'is_overdue')::boolean,x.j->>'aging_bucket'
  from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id left join public.customers c on c.id=i.customer_id
  cross join lateral (select private.finance_invoice_projection(i.id,false) j) x
  where ((select private.app_is_admin()) or i.location_id=(select private.app_user_location_id()))
    and (p_location_id is null or i.location_id=p_location_id) and (p_status is null or i.status=p_status)
    and (p_source_type is null or i.source_type=p_source_type) and (p_cursor is null or i.created_at<p_cursor)
  order by i.created_at desc,i.id desc limit p_limit;
end;
$$;

create function public.receivables_summary(p_location_id uuid default null,p_as_of date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d date:=coalesce(p_as_of,(pg_catalog.now() at time zone 'Australia/Adelaide')::date); result jsonb;
begin
  perform private.finance_guard('receivables.view',p_location_id);
  if d<(pg_catalog.now() at time zone 'Australia/Adelaide')::date-3660 or d>(pg_catalog.now() at time zone 'Australia/Adelaide')::date+1 then
    raise exception 'INVALID_DATE_RANGE' using errcode='22023'; end if;
  select pg_catalog.jsonb_build_object('as_of',d,'invoice_count',count(*) filter(where balance>0),'total',coalesce(sum(total),0),
    'gross_paid',coalesce(sum(gross),0),'reversed',coalesce(sum(rev),0),'effective_paid',coalesce(sum(effective),0),'balance',coalesce(sum(balance),0),
    'aging',pg_catalog.jsonb_build_object('current',coalesce(sum(balance) filter(where bucket='current'),0),'1_7',coalesce(sum(balance) filter(where bucket='1_7'),0),
      '8_14',coalesce(sum(balance) filter(where bucket='8_14'),0),'15_29',coalesce(sum(balance) filter(where bucket='15_29'),0),'30_plus',coalesce(sum(balance) filter(where bucket='30_plus'),0))) into result
  from (select (x->>'total')::numeric total,(x->>'gross_paid')::numeric gross,(x->>'reversed')::numeric rev,
      (x->>'effective_paid')::numeric effective,(x->>'balance')::numeric balance,
      case when r.due_date is null or r.due_date>=d then 'current' when d-r.due_date<=7 then '1_7' when d-r.due_date<=14 then '8_14'
        when d-r.due_date<=29 then '15_29' else '30_plus' end bucket
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id
    cross join lateral private.finance_invoice_projection(i.id,false) x
    where i.status='issued' and ((select private.app_is_admin()) or i.location_id=(select private.app_user_location_id()))
      and (p_location_id is null or i.location_id=p_location_id) and coalesce(r.issue_date,d)<=d) q;
  return result;
end;
$$;

create function public.customer_receivables(p_location_id uuid default null,p_customer_id uuid default null,p_state text default null,
  p_search text default null,p_due_from date default null,p_due_to date default null,p_cursor_due_date date default null,
  p_cursor_invoice_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_search,''))); rows jsonb;
begin
  perform private.finance_guard('receivables.view',p_location_id);
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  if length(term)>100 or (p_state is not null and p_state not in ('unpaid','partial','paid','overdue')) or p_due_from>p_due_to
    or (p_cursor_due_date is null)<>(p_cursor_invoice_id is null) then raise exception 'INVALID_RECEIVABLE_FILTER' using errcode='22023'; end if;
  select coalesce(pg_catalog.jsonb_agg(row_data order by due_date,invoice_id),'[]'::jsonb) into rows from (
    select i.id invoice_id,r.due_date,pg_catalog.jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,
      'location_id',i.location_id,'customer_id',i.customer_id,'customer_name',coalesce(r.customer_snapshot->>'display_name',c.display_name,'Walk-In Customer'),
      'issue_date',r.issue_date,'due_date',r.due_date,'total',(x->>'total')::numeric,'gross_paid',(x->>'gross_paid')::numeric,
      'reversed',(x->>'reversed')::numeric,'effective_paid',(x->>'effective_paid')::numeric,'balance',(x->>'balance')::numeric,
      'payment_state',x->>'payment_state','is_overdue',(x->>'is_overdue')::boolean,'aging_bucket',x->>'aging_bucket',
      'invoice_link_allowed',private.app_has_permission('invoices.view')) row_data
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id left join public.customers c on c.id=i.customer_id
    cross join lateral private.finance_invoice_projection(i.id,false) x
    where i.status='issued' and ((select private.app_is_admin()) or i.location_id=(select private.app_user_location_id()))
      and (p_location_id is null or i.location_id=p_location_id) and (p_customer_id is null or i.customer_id=p_customer_id)
      and (p_state is null or x->>'payment_state'=p_state or p_state='overdue' and (x->>'is_overdue')::boolean)
      and (term='' or lower(concat_ws(' ',i.invoice_number,r.customer_snapshot->>'display_name',c.display_name)) like '%'||term||'%')
      and (p_due_from is null or r.due_date>=p_due_from) and (p_due_to is null or r.due_date<=p_due_to)
      and (p_cursor_due_date is null or (r.due_date,i.id)>(p_cursor_due_date,p_cursor_invoice_id))
    order by r.due_date,i.id limit p_limit) q;
  return rows;
end;
$$;

-- The released 4B issue function targets a partial unique index with an
-- inference clause that PostgreSQL cannot match. Rebind it here without
-- changing the historical migration source.
create or replace function private.finance_issue_locked(p_invoice_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; snap jsonb; dates jsonb; ctype text;
  result jsonb; doc_number text;
begin
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.id is null then raise exception 'INVOICE_NOT_FOUND' using errcode='P0002'; end if;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if;
  if i.status<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id for update;
  if r.lifecycle<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  if not r.pricing_complete then raise exception 'INVOICE_PRICE_PENDING' using errcode='22023'; end if;
  if not exists(select 1 from public.invoice_lines where revision_id=r.id) then raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023'; end if;
  snap:=private.finance_issue_snapshots(p_invoice_id);
  ctype:=coalesce(snap->'customer'->>'customer_type',case when i.customer_id is null then 'walk_in' else 'individual' end);
  dates:=private.finance_due_date(r.payment_terms,ctype);
  update public.invoice_revisions set lifecycle='issued',issued_at=pg_catalog.now(),issue_date=(dates->>'issue_date')::date,due_date=(dates->>'due_date')::date,payment_terms=dates->>'payment_terms',business_snapshot=snap->'business',branch_snapshot=snap->'branch',customer_snapshot=snap->'customer',billing_contact_snapshot=snap->'billing_contact',vehicle_snapshot=snap->'vehicle',version=version+1 where id=r.id;
  update public.invoices set status='issued',first_issued_at=coalesce(first_issued_at,pg_catalog.now()),version=version+1 where id=p_invoice_id;
  doc_number:=case when r.revision_number=1 then i.invoice_number else i.invoice_number||'-R'||r.revision_number end;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version)
  values(p_invoice_id,i.location_id,r.id,'tax_invoice',doc_number,'tax_invoice/'||p_invoice_id::text||'/'||r.id::text||'/v1',pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',r.revision_number,'issue_date',dates->>'issue_date','due_date',dates->>'due_date','business',snap->'business','branch',snap->'branch','customer',snap->'customer','vehicle',snap->'vehicle','total_incl_gst',r.total_incl_gst,'gst_amount',r.gst_amount,'subtotal_ex_gst',r.subtotal_ex_gst),'v1')
  on conflict (invoice_revision_id,document_type) where document_type='tax_invoice' do nothing;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'status','issued','version',i.version+1,'revision_id',r.id,'issue_date',dates->>'issue_date','due_date',dates->>'due_date');
  perform private.sales_audit('INVOICE_ISSUED','invoice',p_invoice_id,i.location_id,pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',r.revision_number,'version_after',i.version+1));
  return result;
end;
$$;

create or replace function public.issue_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; payload jsonb; replay jsonb; result jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('invoices.issue',i.location_id);
  payload:=pg_catalog.jsonb_build_object('expected_version',p_expected_version);
  replay:=private.finance_request(p_request_id,'issue_invoice',payload); if replay is not null then return replay; end if;
  result:=private.finance_issue_locked(p_invoice_id,p_expected_version);
  perform private.finance_request_finish(p_request_id,'issue_invoice',payload,i.location_id,p_invoice_id,result);
  return result;
end;
$$;

-- POS finalisation composes the released job completion authority with the
-- released finance helpers.  It owns only the outer finance request; every
-- child request is deterministic and the entire operation remains one
-- PostgreSQL transaction.
-- Define the recovered POS implementation with deterministic child locks. It uses
-- separate local identifiers and acquires deterministic child locks before
-- invoking the released job authority.
create or replace function public.finalise_pos_sale(
  p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,
  p_job_id uuid,p_expected_job_version integer,p_job jsonb,p_lines jsonb,p_tenders jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); existing public.jobs%rowtype; customer public.customers%rowtype;
  payload jsonb; replay jsonb; created jsonb; updated jsonb; completed jsonb; draft jsonb; issued jsonb; payment jsonb;
  create_child uuid:=pg_catalog.md5('finalise_pos_sale:create:'||p_request_id::text)::uuid;
  complete_child uuid:=pg_catalog.md5('finalise_pos_sale:complete:'||p_request_id::text)::uuid;
  jid uuid; job_version integer; iid uuid; total numeric; customer_type text; result jsonb; child uuid;
begin
  if actor is null or p_request_id is null or p_location_id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if (p_job_id is null)<>(p_expected_job_version is null) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_job is null or pg_catalog.jsonb_typeof(p_job)<>'object' or exists(select 1 from pg_catalog.jsonb_object_keys(p_job) k where k not in ('source_type','walk_in_label','customer_reference','technician_notes','customer_notes')) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if coalesce(p_job->>'source_type','pos')<>'pos' then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_lines is null or pg_catalog.jsonb_typeof(p_lines)<>'array' or pg_catalog.jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_lines) as line(value) where pg_catalog.jsonb_typeof(line.value)<>'object' or exists(select 1 from pg_catalog.jsonb_object_keys(line.value) as key(name) where key.name not in ('line_type','product_id','used_tyre_unit_id','description','quantity','unit_price_incl_gst'))) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_tenders is null or pg_catalog.jsonb_typeof(p_tenders)<>'array' then raise exception 'INVALID_TENDERS' using errcode='22023'; end if;
  perform private.finance_guard('invoices.view',p_location_id); perform private.finance_guard('invoices.create',p_location_id); perform private.finance_guard('invoices.issue',p_location_id);
  if not private.app_has_permission('pos.use') or not private.app_has_permission('jobs.view') or not private.app_has_permission('jobs.create') or not private.app_has_permission('jobs.edit') or not private.app_has_permission('jobs.complete') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if pg_catalog.jsonb_array_length(p_tenders)>0 then perform private.finance_guard('payments.view',p_location_id); perform private.finance_guard('payments.record',p_location_id); end if;
  if p_customer_id is null then
    customer_type:='walk_in';
    if nullif(pg_catalog.btrim(p_job->>'walk_in_label'),'') is null then raise exception 'CUSTOMER_REQUIRED' using errcode='22023'; end if;
    if p_customer_vehicle_id is not null then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  else
    select * into customer from public.customers where id=p_customer_id and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
    customer_type:=customer.customer_type;
  end if;
  payload:=pg_catalog.jsonb_build_object('location_id',p_location_id,'customer_id',p_customer_id,'customer_vehicle_id',p_customer_vehicle_id,'job_id',p_job_id,'expected_job_version',p_expected_job_version,'job',p_job,'lines',p_lines,'tenders',p_tenders);
  replay:=private.finance_request(p_request_id,'finalise_pos_sale',payload); if replay is not null then return replay; end if;
  for child in select x from (values(create_child),(complete_child)) s(x) order by x::text loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||child::text,0)); end loop;
  if p_job_id is null then
    created:=public.create_job(create_child,p_location_id,p_customer_id,p_customer_vehicle_id,p_job||pg_catalog.jsonb_build_object('source_type','pos'),p_lines);
    jid:=(created->>'job_id')::uuid; job_version:=(created->>'version')::integer;
  else
    select * into existing from public.jobs where id=p_job_id for update;
    if not found or existing.location_id<>p_location_id or existing.source_type<>'pos' or existing.customer_id is distinct from p_customer_id or existing.customer_vehicle_id is distinct from p_customer_vehicle_id then raise exception 'POS_JOB_MISMATCH' using errcode='22023'; end if;
    updated:=public.update_job(p_job_id,p_expected_job_version,p_job,p_lines); jid:=p_job_id; job_version:=(updated->>'version')::integer;
  end if;
  completed:=public.complete_job(jid,job_version,complete_child); job_version:=(completed->>'version')::integer;
  draft:=private.finance_build_job_invoice(jid); iid:=(draft->>'invoice_id')::uuid;
  if customer_type='business' then update public.invoice_revisions set payment_terms=customer.payment_terms where id=(draft->>'revision_id')::uuid; end if;
  issued:=private.finance_issue_locked(iid,(draft->>'version')::integer);
  select r.total_incl_gst into total from public.invoice_revisions r where r.id=(draft->>'revision_id')::uuid;
  if total=0 and pg_catalog.jsonb_array_length(p_tenders)>0 then raise exception 'ZERO_TOTAL_TENDERS_NOT_ALLOWED' using errcode='22023'; end if;
  if total>0 and customer_type<>'business' and pg_catalog.jsonb_array_length(p_tenders)=0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  if pg_catalog.jsonb_array_length(p_tenders)>0 then payment:=private.finance_record_tenders(pg_catalog.md5('finalise_pos_sale:payment:'||p_request_id::text)::uuid,iid,p_tenders); if customer_type<>'business' and coalesce((payment->>'balance')::numeric,-1)<>0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  else payment:=pg_catalog.jsonb_build_object('payments','[]'::jsonb,'balance',total,'version',(issued->>'version')::integer); end if;
  result:=pg_catalog.jsonb_build_object('job_id',jid,'job_number',coalesce(created->>'job_number',existing.job_number),'job_version',job_version,'invoice_id',iid,'invoice_number',draft->>'invoice_number','invoice_version',coalesce((payment->>'version')::integer,(issued->>'version')::integer),'status','issued','total_incl_gst',total,'payment',payment);
  perform private.finance_request_finish(p_request_id,'finalise_pos_sale',payload,p_location_id,iid,result); return result;
end;
$$;

-- Preserve the released revise_unpaid_invoice contract while making its
-- tax-invoice conflict target inferable against the partial unique index.
create or replace function public.revise_unpaid_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; i public.invoices%rowtype; cur public.invoice_revisions%rowtype; nrid uuid:=extensions.gen_random_uuid(); nrev integer; reason text; specs jsonb:='[]'::jsonb; existing public.invoice_lines%rowtype; row jsonb; pos integer:=0; disc numeric; terms text; snap jsonb; dates jsonb; ctype text; payload jsonb; replay jsonb; result jsonb; doc_number text;
begin
  select * into i from public.invoices where id=p_invoice_id; if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('invoices.edit',i.location_id); perform private.finance_guard('invoices.issue',i.location_id);
  perform private.finance_json_keys(p_input,array['revision_reason','payment_terms','customer_reference','customer_notes','lines']); reason:=nullif(btrim(p_input->>'revision_reason'),''); if reason is null or length(reason)>500 then raise exception 'REVISION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=pg_catalog.jsonb_build_object('expected_version',p_expected_version,'input',p_input); replay:=private.finance_request(p_request_id,'revise_unpaid_invoice',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update; if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='40001'; end if; if i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if; if i.first_payment_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
  select * into cur from public.invoice_revisions where id=i.current_revision_id; select coalesce(max(revision_number),0)+1 into nrev from public.invoice_revisions where invoice_id=p_invoice_id; terms:=coalesce(nullif(p_input->>'payment_terms',''),cur.payment_terms);
  insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,payment_terms,customer_reference,customer_notes,source_job_number,source_quote_number,revision_reason,created_by) values(nrid,p_invoice_id,nrev,'draft',terms,coalesce(nullif(btrim(p_input->>'customer_reference'),''),cur.customer_reference),coalesce(nullif(btrim(p_input->>'customer_notes'),''),cur.customer_notes),cur.source_job_number,cur.source_quote_number,reason,actor);
  for existing in select * from public.invoice_lines where revision_id=cur.id order by position loop
    pos:=pos+1; row:=coalesce((select value from pg_catalog.jsonb_array_elements(coalesce(p_input->'lines','[]'::jsonb)) value where (value->>'id')::uuid=existing.id),'{}'::jsonb);
    disc:=private.finance_discount(coalesce(row->>'discount_percent',existing.discount_percent::text),coalesce(row->>'discount_reason',existing.discount_reason),'invoices.edit',i.location_id);
    specs:=specs||pg_catalog.jsonb_build_object('position',pos,'source_job_line_id',existing.source_job_line_id,'product_id',existing.product_id,'used_tyre_unit_id',existing.used_tyre_unit_id,'line_type',existing.line_type,'description',coalesce(nullif(btrim(row->>'description'),''),existing.description),'quantity',case when existing.source_job_line_id is not null then existing.quantity::text else coalesce(nullif(row->>'quantity',''),existing.quantity::text) end,'unit_price',case when existing.source_job_line_id is not null then existing.unit_price_incl_gst::text when row ? 'unit_price_incl_gst' then row->>'unit_price_incl_gst' else existing.unit_price_incl_gst::text end,'discount_percent',disc::text,'discount_reason',case when disc>0 then coalesce(btrim(row->>'discount_reason'),existing.discount_reason) else null end,'discount_actor',case when disc>0 then actor else null end,'discount_authorised_at',case when disc>0 then pg_catalog.now() else null end,'inventory_movement_id',(select c.inventory_movement_id from public.invoice_line_costs c where c.invoice_line_id=existing.id),'captured_unit_cost',(select c.captured_unit_cost::text from public.invoice_line_costs c where c.invoice_line_id=existing.id),'capture_source',(select c.capture_source from public.invoice_line_costs c where c.invoice_line_id=existing.id));
  end loop;
  perform private.finance_write_revision_lines(p_invoice_id,nrid,specs); select * into cur from public.invoice_revisions where id=nrid; if not cur.pricing_complete then raise exception 'INVOICE_PRICE_PENDING' using errcode='22023'; end if;
  snap:=private.finance_issue_snapshots(p_invoice_id); ctype:=coalesce(snap->'customer'->>'customer_type',case when i.customer_id is null then 'walk_in' else 'individual' end); dates:=private.finance_due_date(terms,ctype);
  update public.invoice_revisions set lifecycle='issued',issued_at=pg_catalog.now(),issue_date=coalesce((select issue_date from public.invoice_revisions where invoice_id=p_invoice_id and revision_number=1),(dates->>'issue_date')::date),due_date=(select coalesce((select issue_date from public.invoice_revisions where invoice_id=p_invoice_id and revision_number=1),(dates->>'issue_date')::date)) + case dates->>'payment_terms' when 'due_on_receipt' then 0 when '7_days' then 7 when '14_days' then 14 when '30_days' then 30 end,payment_terms=dates->>'payment_terms',business_snapshot=snap->'business',branch_snapshot=snap->'branch',customer_snapshot=snap->'customer',billing_contact_snapshot=snap->'billing_contact',vehicle_snapshot=snap->'vehicle',version=version+1 where id=nrid;
  update public.invoices set current_revision_id=nrid,version=version+1 where id=p_invoice_id; select * into cur from public.invoice_revisions where id=nrid; doc_number:=i.invoice_number||'-R'||nrev;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version) values(p_invoice_id,i.location_id,nrid,'tax_invoice',doc_number,'tax_invoice/'||p_invoice_id::text||'/'||nrid::text||'/v1',pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'issue_date',cur.issue_date,'due_date',cur.due_date,'revision_reason',reason,'total_incl_gst',cur.total_incl_gst,'gst_amount',cur.gst_amount,'subtotal_ex_gst',cur.subtotal_ex_gst),'v1') on conflict (invoice_revision_id,document_type) where document_type='tax_invoice' do nothing;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'revision_id',nrid,'revision_number',nrev,'version',i.version+1,'issue_date',cur.issue_date,'due_date',cur.due_date); perform private.sales_audit('INVOICE_REVISED','invoice',p_invoice_id,i.location_id,pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'reason',reason,'version_after',i.version+1)); perform private.finance_request_finish(p_request_id,'revise_unpaid_invoice',payload,i.location_id,p_invoice_id,result); return result;
end;
$$;

revoke execute on function private.finance_child_uuid(uuid,text,integer),private.finance_invoice_projection(uuid,boolean),
  private.finance_record_tenders(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.record_invoice_payment(uuid,uuid,integer,jsonb),
  public.reverse_manual_payment(uuid,uuid,uuid,integer,text),public.invoice_summary(uuid,text,text,timestamptz,integer),
  public.invoice_detail(uuid),public.receivables_summary(uuid,date),
  public.customer_receivables(uuid,uuid,text,text,date,date,date,uuid,integer),
  public.finalise_pos_sale(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb)
  from public,anon,service_role;
grant execute on function public.record_invoice_payment(uuid,uuid,integer,jsonb),
  public.reverse_manual_payment(uuid,uuid,uuid,integer,text),public.invoice_summary(uuid,text,text,timestamptz,integer),
  public.invoice_detail(uuid),public.receivables_summary(uuid,date),
  public.customer_receivables(uuid,uuid,text,text,date,date,date,uuid,integer),
  public.finalise_pos_sale(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb)
  to authenticated;
