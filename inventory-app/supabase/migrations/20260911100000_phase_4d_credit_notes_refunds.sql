-- Phase 4D: invoice-scoped credit notes and ordinary manual refund liabilities.
-- No provider evidence, Stripe, stock, email, or customer-credit ledger belongs here.

alter table public.finance_action_requests drop constraint finance_action_requests_action_check;
alter table public.finance_action_requests add constraint finance_action_requests_action_check check (action in (
  'update_finance_settings','finance_draft','finance_issue','finance_revise',
  'create_invoice_from_job','complete_job_and_create_invoice','create_manual_invoice','update_invoice_draft',
  'issue_invoice','revise_unpaid_invoice','cancel_invoice','record_invoice_payment','reverse_manual_payment',
  'finalise_pos_sale','create_manual_invoice_v2','update_invoice_draft_v2','duplicate_invoice_draft','void_issued_invoice',
  'create_invoice_credit_refund','confirm_manual_refund','retry_invoice_refund'
));

create table public.credit_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  credit_note_number text not null unique,
  reason text not null check (nullif(btrim(reason),'') is not null and length(reason)<=500),
  subtotal_ex_gst numeric(14,2) not null check (subtotal_ex_gst>=0),
  gst_amount numeric(14,2) not null check (gst_amount>=0),
  total_incl_gst numeric(14,2) not null check (total_incl_gst=subtotal_ex_gst+gst_amount and total_incl_gst>=0),
  authorised_refund_amount numeric(14,2) not null default 0 check (authorised_refund_amount>=0 and authorised_refund_amount<=total_incl_gst),
  status text not null default 'issued' check (status='issued'),
  is_cancellation boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  version integer not null default 1 check (version=1)
);

create table public.credit_note_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  credit_note_id uuid not null references public.credit_notes(id) on delete restrict,
  invoice_line_id uuid not null references public.invoice_lines(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  position integer not null check (position>0),
  description text not null check (nullif(btrim(description),'') is not null),
  credited_incl_gst numeric(14,2) not null check (credited_incl_gst>=0),
  gst_amount numeric(14,2) not null check (gst_amount>=0 and gst_amount<=credited_incl_gst),
  subtotal_ex_gst numeric(14,2) not null check (subtotal_ex_gst=credited_incl_gst-gst_amount and subtotal_ex_gst>=0),
  created_at timestamptz not null default pg_catalog.now(),
  unique(credit_note_id,position),
  unique(credit_note_id,invoice_line_id)
);

create table public.refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  credit_note_id uuid not null references public.credit_notes(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  amount numeric(14,2) not null check (amount>0),
  payout_method text check (payout_method is null or payout_method in ('cash','eftpos','bank_transfer')),
  payout_reference text check (payout_reference is null or (nullif(btrim(payout_reference),'') is not null and length(payout_reference)<=200)),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','uncertain')),
  failure_reason text check (failure_reason is null or length(failure_reason)<=500),
  evidence text check (evidence is null or (nullif(btrim(evidence),'') is not null and length(evidence)<=1000)),
  retry_of uuid references public.refunds(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  version integer not null default 1 check (version=1),
  check ((status='succeeded' and payout_method is not null and payout_reference is not null and evidence is not null and confirmed_by is not null and confirmed_at is not null)
    or status<>'succeeded')
);

alter table public.financial_documents drop constraint financial_documents_document_type_check;
alter table public.financial_documents add constraint financial_documents_document_type_check
  check (document_type in ('tax_invoice','payment_receipt','payment_correction','credit_note','refund_confirmation'));
alter table public.financial_documents add column credit_note_id uuid references public.credit_notes(id) on delete restrict;
alter table public.financial_documents add column refund_id uuid references public.refunds(id) on delete restrict;
create unique index financial_documents_credit_note_uidx on public.financial_documents(credit_note_id) where credit_note_id is not null;
create unique index financial_documents_refund_uidx on public.financial_documents(refund_id) where refund_id is not null;

alter table public.credit_notes enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.refunds enable row level security;
revoke all on public.credit_notes,public.credit_note_lines,public.refunds from public,anon,authenticated,service_role;
create policy credit_notes_branch_read on public.credit_notes for select to authenticated using (
  (select private.app_has_permission('invoices.view')) and (select private.app_has_permission('payments.view'))
  and ((select private.app_is_admin()) or location_id=(select private.app_user_location_id()))
);
create policy credit_note_lines_branch_read on public.credit_note_lines for select to authenticated using (
  (select private.app_has_permission('invoices.view')) and ((select private.app_is_admin()) or location_id=(select private.app_user_location_id()))
);
create policy refunds_branch_read on public.refunds for select to authenticated using (
  (select private.app_has_permission('invoices.view')) and (select private.app_has_permission('payments.view'))
  and ((select private.app_is_admin()) or location_id=(select private.app_user_location_id()))
);
create trigger credit_notes_immutable before update or delete on public.credit_notes for each row execute function private.finance_immutable();
create trigger credit_note_lines_immutable before update or delete on public.credit_note_lines for each row execute function private.finance_immutable();

create or replace function private.finance_refund_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  if old.id<>new.id or old.request_id<>new.request_id or old.invoice_id<>new.invoice_id or old.credit_note_id<>new.credit_note_id
    or old.payment_id<>new.payment_id or old.location_id<>new.location_id or old.amount<>new.amount or old.created_by<>new.created_by
    or old.created_at<>new.created_at or old.retry_of is distinct from new.retry_of then
    raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501';
  end if;
  if old.status='succeeded' then raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  if new.status not in ('pending','succeeded') or (old.status not in ('pending','uncertain') and old.status<>'failed') then
    raise exception 'REFUND_STATE_INVALID' using errcode='22023';
  end if;
  if new.status='succeeded' and (new.payout_method is null or new.payout_reference is null or new.evidence is null or new.confirmed_by is null or new.confirmed_at is null) then
    raise exception 'REFUND_EVIDENCE_REQUIRED' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger refunds_state_guard before update or delete on public.refunds for each row execute function private.finance_refund_guard();

create or replace function private.finance_payment_reversal_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.refunds r where r.payment_id=new.payment_id) then
    raise exception 'PAYMENT_REVERSAL_NOT_ALLOWED' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger payment_reversal_refund_guard before insert on public.payment_reversals for each row execute function private.finance_payment_reversal_guard();

create index credit_notes_invoice_idx on public.credit_notes(invoice_id,issued_at,id);
create index credit_notes_location_idx on public.credit_notes(location_id,issued_at,id);
create index credit_note_lines_note_idx on public.credit_note_lines(credit_note_id,position);
create index credit_note_lines_line_idx on public.credit_note_lines(invoice_line_id);
create index refunds_invoice_idx on public.refunds(invoice_id,created_at,id);
create index refunds_payment_idx on public.refunds(payment_id,created_at,id);
create index refunds_credit_idx on public.refunds(credit_note_id,created_at,id);
create index refunds_location_status_idx on public.refunds(location_id,status,created_at,id);

-- The projection is the only authoritative place that derives T/C/G/A/R.
create or replace function private.finance_invoice_projection(p_invoice_id uuid,p_include_history boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare total numeric; credits numeric; gross numeric; reversed numeric; g numeric; authorised numeric; refunded numeric; e numeric; applied numeric; bal numeric; due_amount numeric; state text; bucket text; due date; business_date date; history jsonb:='[]'::jsonb; credit_history jsonb:='[]'::jsonb; refund_history jsonb:='[]'::jsonb;
begin
  select r.total_incl_gst,r.due_date into total,due from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id where i.id=p_invoice_id;
  total:=coalesce(total,0);
  select coalesce(sum(c.total_incl_gst),0),coalesce(sum(c.authorised_refund_amount),0) into credits,authorised from public.credit_notes c where c.invoice_id=p_invoice_id and c.status='issued';
  select coalesce(sum(pay.amount),0),coalesce(sum(case when pr.id is not null then pay.amount else 0 end),0) into gross,reversed from public.payments pay left join public.payment_reversals pr on pr.payment_id=pay.id where pay.invoice_id=p_invoice_id and pay.status='succeeded';
  g:=gross-reversed;
  select coalesce(sum(r.amount) filter (where r.status='succeeded'),0) into refunded from public.refunds r where r.invoice_id=p_invoice_id;
  e:=total-credits; applied:=g-authorised; bal:=e-applied; due_amount:=authorised-refunded;
  if total<0 or credits<0 or credits>total or authorised<0 or authorised>credits or authorised>g or refunded<0 or refunded>authorised or applied<0 or applied>e or bal<0 or due_amount<0 then raise exception 'FINANCE_INVARIANT_VIOLATION' using errcode='23514'; end if;
  state:=case when bal=0 then 'paid' when applied=0 then 'unpaid' else 'partial' end;
  business_date:=(pg_catalog.now() at time zone 'Australia/Adelaide')::date;
  bucket:=case when due is null or due>=business_date then 'current' when business_date-due between 1 and 7 then '1_7' when business_date-due between 8 and 14 then '8_14' when business_date-due between 15 and 29 then '15_29' else '30_plus' end;
  if p_include_history then
    select coalesce(jsonb_agg(to_jsonb(pay)||jsonb_build_object('reversed',pr.id is not null,'reversal_id',pr.id) order by pay.received_at,pay.id),'[]') into history from public.payments pay left join public.payment_reversals pr on pr.payment_id=pay.id where pay.invoice_id=p_invoice_id;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.issued_at,c.id),'[]') into credit_history from public.credit_notes c where c.invoice_id=p_invoice_id;
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]') into refund_history from public.refunds r where r.invoice_id=p_invoice_id;
  end if;
  return jsonb_build_object('total',total,'credits',credits,'gross_paid',gross,'reversed',reversed,'effective_paid',g,'applied_to_sale',applied,'actual_net_cash',g-refunded,'balance',bal,'refund_due',due_amount,'payment_state',state,'due_date',due,'is_overdue',state<>'paid' and due<business_date,'aging_bucket',bucket,'payments',history,'credit_notes',credit_history,'refunds',refund_history);
end; $$;

create or replace function private.finance_insert_credit_refund(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb,p_cancellation boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; l public.invoice_lines%rowtype; p public.payments%rowtype; row jsonb; alloc jsonb; actor uuid:=(select auth.uid()); reason text; cn_id uuid:=extensions.gen_random_uuid(); cn_number text; total numeric:=0; credit_gst numeric:=0; auth_amount numeric:=0; old_credits numeric:=0; old_auth numeric:=0; g numeric:=0; reversed numeric:=0; line_amount numeric; line_gst numeric; payment_amount numeric; previous_gst numeric; payment_capacity numeric; reserved numeric; pos integer:=0; payload jsonb; projection jsonb; result jsonb; refund_id uuid; child_request uuid;
begin
  select * into i from public.invoices where id=p_invoice_id for update; if not found then raise exception 'INVOICE_NOT_FOUND' using errcode='P0002'; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id; if r.lifecycle<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  reason:=nullif(btrim(p_input->>'reason'),''); if reason is null or length(reason)>500 then raise exception 'CREDIT_NOTE_REASON_REQUIRED' using errcode='22023'; end if;
  select coalesce(sum(c.total_incl_gst),0),coalesce(sum(c.authorised_refund_amount),0) into old_credits,old_auth from public.credit_notes c where c.invoice_id=i.id and c.status='issued';
  select coalesce(sum(pay.amount),0)-coalesce(sum(case when pr.id is not null then pay.amount else 0 end),0) into g from public.payments pay left join public.payment_reversals pr on pr.payment_id=pay.id where pay.invoice_id=i.id and pay.status='succeeded';
  if p_input->'credit_lines' is null or jsonb_typeof(p_input->'credit_lines')<>'array' then raise exception 'CREDIT_LINES_REQUIRED' using errcode='22023'; end if;
  for row in select value from jsonb_array_elements(p_input->'credit_lines') loop
    perform private.finance_json_keys(row,array['invoice_line_id','amount']);
    if row->>'invoice_line_id' is null or row->>'amount' is null then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
    select * into l from public.invoice_lines where id=(row->>'invoice_line_id')::uuid and invoice_id=i.id and revision_id=r.id for update;
    if not found or l.total_incl_gst is null then raise exception 'INVALID_CREDIT_LINE' using errcode='22023'; end if;
    line_amount:=private.finance_decimal(row->>'amount',2,14);
    select coalesce(sum(x.credited_incl_gst),0),coalesce(sum(x.gst_amount),0) into payment_amount,previous_gst from public.credit_note_lines x join public.credit_notes c on c.id=x.credit_note_id where x.invoice_line_id=l.id and c.status='issued';
    if line_amount<=0 or payment_amount+line_amount>l.total_incl_gst then raise exception 'CREDIT_EXCEEDS_LINE' using errcode='22023'; end if;
    line_gst:=case when l.total_incl_gst=0 then 0 else round(l.gst_amount*(payment_amount+line_amount)/l.total_incl_gst,2)-previous_gst end; total:=total+line_amount; credit_gst:=credit_gst+line_gst; pos:=pos+1;
  end loop;
  auth_amount:=case when nullif(p_input->>'authorised_refund_amount','') is null then 0 else private.finance_decimal(p_input->>'authorised_refund_amount',2,14) end;
  if auth_amount>total or old_credits+total>r.total_incl_gst or old_auth+auth_amount>g or g-(old_auth+auth_amount)>r.total_incl_gst-(old_credits+total) then raise exception 'REFUND_EXCEEDS_CAPACITY' using errcode='22023'; end if;
  if auth_amount>0 and (p_input->'payments' is null or jsonb_typeof(p_input->'payments')<>'array') then raise exception 'REFUND_PAYMENT_REQUIRED' using errcode='22023'; end if;
  cn_number:=private.next_location_document_number(i.location_id,'credit_note','CRN');
  insert into public.credit_notes(id,request_id,invoice_id,location_id,credit_note_number,reason,subtotal_ex_gst,gst_amount,total_incl_gst,authorised_refund_amount,is_cancellation,created_by)
  values(cn_id,p_request_id,i.id,i.location_id,cn_number,reason,total-credit_gst,credit_gst,total,auth_amount,p_cancellation,actor);
  pos:=0;
  for row in select value from jsonb_array_elements(p_input->'credit_lines') loop
    pos:=pos+1; select * into l from public.invoice_lines where id=(row->>'invoice_line_id')::uuid; select coalesce(sum(x.credited_incl_gst),0),coalesce(sum(x.gst_amount),0) into payment_amount,previous_gst from public.credit_note_lines x join public.credit_notes c on c.id=x.credit_note_id where x.invoice_line_id=l.id and c.status='issued';
    line_amount:=private.finance_decimal(row->>'amount',2,14); line_gst:=case when l.total_incl_gst=0 then 0 else round(l.gst_amount*(payment_amount+line_amount)/l.total_incl_gst,2)-previous_gst end;
    insert into public.credit_note_lines(credit_note_id,invoice_line_id,location_id,position,description,credited_incl_gst,gst_amount,subtotal_ex_gst) values(cn_id,l.id,i.location_id,pos,l.description,line_amount,line_gst,line_amount-line_gst);
  end loop;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,credit_note_id,document_type,document_number,source_key,snapshot,template_version,created_by)
    values(i.id,i.location_id,r.id,cn_id,'credit_note',cn_number,'credit_note/'||cn_id::text||'/v1',jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,'credit_note_id',cn_id,'credit_note_number',cn_number,'reason',reason,'total_incl_gst',total,'gst_amount',credit_gst,'authorised_refund_amount',auth_amount),'v1',actor);
  if auth_amount>0 then
    pos:=0;
    for alloc in select value from jsonb_array_elements(p_input->'payments') order by value->>'payment_id' loop
      pos:=pos+1;
      perform private.finance_json_keys(alloc,array['payment_id','amount']);
      select * into p from public.payments where id=(alloc->>'payment_id')::uuid and invoice_id=i.id for update;
      if not found or exists(select 1 from public.payment_reversals x where x.payment_id=p.id) then raise exception 'INVALID_PAYMENT_RELATION' using errcode='22023'; end if;
      payment_amount:=private.finance_decimal(alloc->>'amount',2,14); select coalesce(sum(x.amount),0) into reserved from public.refunds x where x.payment_id=p.id and x.status in ('pending','uncertain','succeeded'); payment_capacity:=p.amount-reserved;
      if payment_amount<=0 or payment_amount>payment_capacity then raise exception 'REFUND_EXCEEDS_PAYMENT_CAPACITY' using errcode='22023'; end if;
      refund_id:=private.finance_child_uuid(p_request_id,'refund',pos); child_request:=private.finance_child_uuid(p_request_id,'refund-request',pos);
      insert into public.refunds(id,request_id,invoice_id,credit_note_id,payment_id,location_id,amount,created_by) values(refund_id,child_request,i.id,cn_id,p.id,i.location_id,payment_amount,actor);
    end loop;
    if (select coalesce(sum(amount),0) from public.refunds where credit_note_id=cn_id)<>auth_amount then raise exception 'REFUND_ALLOCATION_MISMATCH' using errcode='22023'; end if;
  end if;
  update public.invoices set updated_at=pg_catalog.now(),version=version+1 where id=i.id;
  perform private.sales_audit(case when p_cancellation then 'INVOICE_CANCELLATION_CREDIT_CREATED' else 'CREDIT_NOTE_ISSUED' end,'invoice',i.id,i.location_id,jsonb_build_object('credit_note_id',cn_id,'amount',total,'authorised_refund_amount',auth_amount,'request_id',p_request_id));
  projection:=private.finance_invoice_projection(i.id,false);
  return (projection-'payments')||jsonb_build_object('invoice_id',i.id,'credit_note_id',cn_id,'version',i.version+1,'status','issued');
end; $$;

create or replace function public.create_invoice_credit_refund(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; payload jsonb; result jsonb; replay jsonb; actor uuid;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('payments.view',i.location_id); perform private.finance_guard('refunds.create',i.location_id);
  perform private.finance_json_keys(p_input,array['reason','credit_lines','authorised_refund_amount','payments']);
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'input',p_input); replay:=private.finance_request(p_request_id,'create_invoice_credit_refund',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update; if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if; if i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  result:=private.finance_insert_credit_refund(p_request_id,p_invoice_id,p_expected_version,p_input,false);
  perform private.finance_request_finish(p_request_id,'create_invoice_credit_refund',payload,i.location_id,i.id,result); return result;
end; $$;

create or replace function public.confirm_manual_refund(p_request_id uuid,p_refund_id uuid,p_expected_version integer,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.refunds%rowtype; i public.invoices%rowtype; payload jsonb; replay jsonb; result jsonb; actor uuid:=(select auth.uid()); method text; reference text; evidence_text text; confirmed_at_value timestamptz;
begin
  select * into f from public.refunds where id=p_refund_id; if not found then raise exception 'REFUND_NOT_FOUND' using errcode='22023'; end if; select * into i from public.invoices where id=f.invoice_id;
  actor:=private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('payments.view',i.location_id); perform private.finance_guard('refunds.create',i.location_id);
  perform private.finance_json_keys(p_evidence,array['payout_method','payout_reference','evidence','confirmed_at']); method:=nullif(btrim(p_evidence->>'payout_method'),''); reference:=nullif(btrim(p_evidence->>'payout_reference'),''); evidence_text:=nullif(btrim(p_evidence->>'evidence'),''); if method not in ('cash','eftpos','bank_transfer') or reference is null or evidence_text is null then raise exception 'REFUND_EVIDENCE_REQUIRED' using errcode='22023'; end if;
  begin confirmed_at_value:=coalesce((p_evidence->>'confirmed_at')::timestamptz,pg_catalog.now()); exception when others then raise exception 'REFUND_EVIDENCE_REQUIRED' using errcode='22023'; end;
  payload:=jsonb_build_object('refund_id',p_refund_id,'expected_version',p_expected_version,'evidence',p_evidence); replay:=private.finance_request(p_request_id,'confirm_manual_refund',payload); if replay is not null then return replay; end if;
  select * into f from public.refunds where id=p_refund_id for update; if f.version<>p_expected_version then raise exception 'REFUND_VERSION_CONFLICT' using errcode='PT409'; end if; if f.status<>'pending' then raise exception 'REFUND_NOT_PENDING' using errcode='22023'; end if;
  update public.refunds set status='succeeded',payout_method=method,payout_reference=reference,evidence=evidence_text,confirmed_by=actor,confirmed_at=confirmed_at_value where id=f.id;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,refund_id,document_type,document_number,source_key,snapshot,template_version,created_by)
    values(i.id,i.location_id,(select current_revision_id from public.invoices where id=i.id),f.id,'refund_confirmation',null,'refund_confirmation/'||f.id::text||'/v1',jsonb_build_object('invoice_id',i.id,'refund_id',f.id,'amount',f.amount,'payout_method',method,'payout_reference',reference,'confirmed_at',confirmed_at_value),'v1',actor);
  update public.invoices set updated_at=pg_catalog.now(),version=version+1 where id=i.id;
  perform private.sales_audit('MANUAL_REFUND_CONFIRMED','invoice',i.id,i.location_id,jsonb_build_object('refund_id',f.id,'amount',f.amount,'request_id',p_request_id));
  result:=private.finance_invoice_projection(i.id,false)||jsonb_build_object('invoice_id',i.id,'refund_id',f.id,'version',i.version+1); perform private.finance_request_finish(p_request_id,'confirm_manual_refund',payload,i.location_id,i.id,result); return result;
end; $$;

create or replace function public.retry_invoice_refund(p_request_id uuid,p_refund_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.refunds%rowtype; i public.invoices%rowtype; payload jsonb; replay jsonb; result jsonb; actor uuid:=(select auth.uid()); new_id uuid:=private.finance_child_uuid(p_request_id,'refund-retry',1); child uuid:=private.finance_child_uuid(p_request_id,'refund-retry-request',1); reserved numeric; capacity numeric;
begin
  select * into old from public.refunds where id=p_refund_id; if not found then raise exception 'REFUND_NOT_FOUND' using errcode='22023'; end if; select * into i from public.invoices where id=old.invoice_id;
  actor:=private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('payments.view',i.location_id); perform private.finance_guard('refunds.create',i.location_id);
  payload:=jsonb_build_object('refund_id',p_refund_id,'expected_version',p_expected_version); replay:=private.finance_request(p_request_id,'retry_invoice_refund',payload); if replay is not null then return replay; end if;
  select * into old from public.refunds where id=p_refund_id for update; if old.version<>p_expected_version then raise exception 'REFUND_VERSION_CONFLICT' using errcode='PT409'; end if; if old.status<>'failed' then raise exception 'REFUND_RETRY_NOT_ALLOWED' using errcode='22023'; end if;
  select coalesce(sum(x.amount),0) into reserved from public.refunds x where x.payment_id=old.payment_id and x.status in ('pending','uncertain','succeeded'); capacity:=(select p.amount from public.payments p where p.id=old.payment_id)-reserved; if old.amount>capacity then raise exception 'REFUND_EXCEEDS_PAYMENT_CAPACITY' using errcode='22023'; end if;
  insert into public.refunds(id,request_id,invoice_id,credit_note_id,payment_id,location_id,amount,retry_of,created_by) values(new_id,child,old.invoice_id,old.credit_note_id,old.payment_id,old.location_id,old.amount,old.id,actor);
  update public.invoices set updated_at=pg_catalog.now(),version=version+1 where id=i.id; result:=private.finance_invoice_projection(i.id,false)||jsonb_build_object('invoice_id',i.id,'refund_id',new_id,'version',i.version+1); perform private.finance_request_finish(p_request_id,'retry_invoice_refund',payload,i.location_id,i.id,result); return result;
end; $$;

-- Issued cancellation is a full-sale credit. It cannot complete while a payout is pending.
create or replace function public.cancel_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; l public.invoice_lines%rowtype; row jsonb; lines jsonb:='[]'; payments jsonb:='[]'; total numeric; paid numeric; auth numeric; payload jsonb; replay jsonb; result jsonb; projection jsonb; actor uuid; pos integer:=0; p public.payments%rowtype; amount numeric; remaining numeric;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if; actor:=private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('invoices.cancel',i.location_id); if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'reason',btrim(p_reason)); replay:=private.finance_request(p_request_id,'cancel_invoice',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update; if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if; if i.status='cancelled' then raise exception 'INVALID_INVOICE_TRANSITION' using errcode='22023'; end if;
  if i.status='draft' then update public.invoices set status='cancelled',cancelled_at=pg_catalog.now(),cancelled_by=actor,cancellation_reason=btrim(p_reason),version=version+1 where id=i.id; result:=jsonb_build_object('invoice_id',i.id,'status','cancelled','version',i.version+1); perform private.sales_audit('INVOICE_CANCELLED','invoice',i.id,i.location_id,jsonb_build_object('reason',p_reason)); perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,i.id,result); return result; end if;
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
  payload:=payload||jsonb_build_object('generated_credit_lines',lines,'generated_payments',payments); result:=private.finance_insert_credit_refund(p_request_id,i.id,p_expected_version,jsonb_build_object('reason',btrim(p_reason),'credit_lines',lines,'authorised_refund_amount',auth,'payments',payments),true);
  projection:=private.finance_invoice_projection(i.id,false); if (projection->>'balance')::numeric<>0 then raise exception 'CANCELLATION_LIABILITY_REMAINS' using errcode='22023'; end if;
  if (projection->>'refund_due')::numeric<>0 or (projection->>'actual_net_cash')::numeric<>0 then
    result:=result||jsonb_build_object('status','issued','cancellation_pending',true,'version',i.version+1); perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,i.id,result); return result;
  end if;
  update public.invoices set status='cancelled',cancelled_at=pg_catalog.now(),cancelled_by=actor,cancellation_reason=btrim(p_reason),version=version+1 where id=i.id; result:=result||jsonb_build_object('status','cancelled','version',i.version+2); perform private.sales_audit('INVOICE_CANCELLED','invoice',i.id,i.location_id,jsonb_build_object('reason',p_reason)); perform private.finance_request_finish(p_request_id,'cancel_invoice',payload,i.location_id,i.id,result); return result;
end; $$;

create or replace function public.invoice_credit_refund_history(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; projection jsonb; credits jsonb; refunds jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  if not private.app_has_permission('payments.view') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  projection:=private.finance_invoice_projection(i.id,true);
  select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.position),'[]') from public.credit_note_lines l where l.credit_note_id=c.id)) order by c.issued_at,c.id),'[]') into credits from public.credit_notes c where c.invoice_id=i.id;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at,f.id),'[]') into refunds from public.refunds f where f.invoice_id=i.id;
  return jsonb_build_object('financials',projection-'payments','credit_notes',credits,'refunds',refunds);
end; $$;

revoke execute on function private.finance_refund_guard(),private.finance_insert_credit_refund(uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated,service_role;
revoke execute on function public.create_invoice_credit_refund(uuid,uuid,integer,jsonb),public.confirm_manual_refund(uuid,uuid,integer,jsonb),public.retry_invoice_refund(uuid,uuid,integer),public.cancel_invoice(uuid,uuid,integer,text),public.invoice_credit_refund_history(uuid) from public,anon,service_role;
grant execute on function public.create_invoice_credit_refund(uuid,uuid,integer,jsonb),public.confirm_manual_refund(uuid,uuid,integer,jsonb),public.retry_invoice_refund(uuid,uuid,integer),public.cancel_invoice(uuid,uuid,integer,text),public.invoice_credit_refund_history(uuid) to authenticated;
