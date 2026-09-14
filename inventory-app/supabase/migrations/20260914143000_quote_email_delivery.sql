-- Quote customer-document delivery. This follows the invoice delivery state
-- machine: the exact provider payload is persisted before Resend is called,
-- provider calls are leased, retries reuse the same idempotency key, and an
-- intentional resend creates a new immutable sequence.

create table public.quote_email_send_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete restrict,
  recipient text not null check (recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  actor_user_id uuid not null references auth.users(id),
  send_sequence integer not null check (send_sequence > 0),
  idempotency_key text not null unique,
  state text not null default 'pending' check (state in ('pending','sending','accepted','uncertain','failed','disabled')),
  provider text,
  provider_message_id text,
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  provider_payload jsonb,
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  provider_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now(),
  key_expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (quote_id, recipient, actor_user_id, send_sequence)
);
create index quote_email_send_requests_quote_idx on public.quote_email_send_requests(quote_id, recipient, send_sequence desc);

create table public.quote_email_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete restrict,
  recipient text not null,
  sender text not null,
  provider text not null,
  provider_message_id text,
  delivery_state text not null check (delivery_state in ('sent','uncertain','failed','disabled')),
  error_message text,
  actor_user_id uuid not null references auth.users(id),
  retry_of uuid references public.quote_email_deliveries(id),
  send_request_id uuid not null references public.quote_email_send_requests(id),
  attempt_number integer not null check (attempt_number > 0),
  attempted_at timestamptz not null default now()
);
create index quote_email_deliveries_quote_idx on public.quote_email_deliveries(quote_id, attempted_at desc);
alter table public.quote_email_send_requests enable row level security;
alter table public.quote_email_deliveries enable row level security;
revoke all on public.quote_email_send_requests, public.quote_email_deliveries from public, anon, authenticated, service_role;
grant select on public.quote_email_send_requests, public.quote_email_deliveries to service_role;
create trigger quote_email_deliveries_immutable before update or delete on public.quote_email_deliveries for each row execute function private.finance_immutable();

create or replace function private.quote_email_send_request_json(p_request public.quote_email_send_requests)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_request.id,'quote_id',p_request.quote_id,'recipient',p_request.recipient,'send_sequence',p_request.send_sequence,'idempotency_key',p_request.idempotency_key,'state',p_request.state,'provider',p_request.provider,'provider_message_id',p_request.provider_message_id,'attempt_count',p_request.attempt_count,'last_error',p_request.last_error,'created_at',p_request.created_at,'last_attempted_at',p_request.last_attempted_at,'key_expires_at',p_request.key_expires_at,'key_expired',p_request.key_expires_at<=pg_catalog.now(),'payload_bound',p_request.payload_sha256 is not null,'provider_claimed_at',p_request.provider_claimed_at);
$$;
revoke execute on function private.quote_email_send_request_json(public.quote_email_send_requests) from public, anon, authenticated, service_role;

create or replace function public.prepare_quote_email_send(p_quote_id uuid,p_recipient text,p_mode text,p_payload_sha256 text,p_provider_payload jsonb,p_claim_provider boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; actor uuid; latest public.quote_email_send_requests%rowtype; created public.quote_email_send_requests%rowtype; v_recipient text:=lower(btrim(p_recipient)); fingerprint text:=lower(btrim(coalesce(p_payload_sha256,''))); next_seq integer; durable_key text; stored jsonb;
begin
  if not private.sales_permission('quotes.edit') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and private.sales_location_allowed(location_id) for update;
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if q.status not in ('draft','sent') or not q.pricing_complete then raise exception 'QUOTE_NOT_SENDABLE' using errcode='22023'; end if;
  if p_mode not in ('send','retry','resend') or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or fingerprint !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_provider_payload)<>'object' or p_provider_payload->>'idempotencyKey'<>'pending-durable-key' or p_provider_payload->'to'->>0<>v_recipient or jsonb_array_length(p_provider_payload->'to')<>1 or nullif(p_provider_payload->>'subject','') is null or nullif(p_provider_payload->>'html','') is null or nullif(p_provider_payload->'attachment'->>'filename','') is null or nullif(p_provider_payload->'attachment'->>'contentBase64','') is null then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  actor:=auth.uid(); perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('quote-email:'||q.id::text||':'||v_recipient,0));
  select * into latest from public.quote_email_send_requests x where x.quote_id=q.id and x.recipient=v_recipient order by x.send_sequence desc limit 1;
  if found and latest.state in ('sending','uncertain') then raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;
  if found and p_mode<>'resend' then
    if latest.actor_user_id<>actor then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
    if latest.state='accepted' then raise exception 'EMAIL_ALREADY_ACCEPTED' using errcode='23505'; end if;
    if latest.key_expires_at<=now() then raise exception 'EMAIL_RETRY_WINDOW_EXPIRED' using errcode='22023'; end if;
    if latest.payload_sha256<>fingerprint then raise exception 'EMAIL_PAYLOAD_MISMATCH' using errcode='22023'; end if;
    update public.quote_email_send_requests set state=case when p_claim_provider then 'sending' else state end, provider_claimed_at=case when p_claim_provider then now() else null end, attempt_count=attempt_count+1,last_attempted_at=now() where id=latest.id returning * into latest;
    return private.quote_email_send_request_json(latest)||jsonb_build_object('provider_payload',latest.provider_payload,'reused',true);
  elsif not found and p_mode='retry' then raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  next_seq:=coalesce(latest.send_sequence,0)+1; durable_key:='quote-email/'||q.id::text||'/'||next_seq::text||'/'||extensions.gen_random_uuid()::text; stored:=jsonb_set(p_provider_payload,'{idempotencyKey}',to_jsonb(durable_key),false);
  insert into public.quote_email_send_requests(quote_id,recipient,actor_user_id,send_sequence,idempotency_key,state,payload_sha256,provider_payload,provider_claimed_at,attempt_count,last_attempted_at) values(q.id,v_recipient,actor,next_seq,durable_key,case when p_claim_provider then 'sending' else 'pending' end,fingerprint,stored,case when p_claim_provider then now() end,1,now()) returning * into created;
  perform private.sales_audit(case when p_mode='resend' then 'QUOTE_EMAIL_RESEND_REQUESTED' else 'QUOTE_EMAIL_SEND_REQUESTED' end,'quote',q.id,q.location_id,jsonb_build_object('send_request_id',created.id,'recipient',v_recipient,'send_sequence',next_seq));
  return private.quote_email_send_request_json(created)||jsonb_build_object('provider_payload',created.provider_payload,'reused',false);
end; $$;

create or replace function public.finish_quote_email_send(p_send_request_id uuid,p_outcome text,p_sender text,p_provider_message_id text default null,p_error_message text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.quote_email_send_requests%rowtype; q public.quotes%rowtype; actor uuid; delivery_id uuid; prior uuid; new_state text; delivery_state text;
begin
  select * into r from public.quote_email_send_requests where id=p_send_request_id for update; if not found then raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  select * into q from public.quotes where id=r.quote_id; actor:=auth.uid(); if not private.sales_permission('quotes.edit') or not private.sales_location_allowed(q.location_id) or actor<>r.actor_user_id then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_outcome not in ('accepted','failed','uncertain','disabled') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_outcome='accepted' and (p_provider_message_id is null or p_error_message is not null) then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if r.state='accepted' then if p_outcome='accepted' and r.provider_message_id=p_provider_message_id then return private.quote_email_send_request_json(r)||jsonb_build_object('already_recorded',true); end if; raise exception 'EMAIL_ALREADY_ACCEPTED' using errcode='23505'; end if;
  new_state:=case p_outcome when 'accepted' then 'accepted' when 'uncertain' then 'uncertain' when 'disabled' then 'disabled' else 'failed' end; delivery_state:=case p_outcome when 'accepted' then 'sent' when 'uncertain' then 'uncertain' when 'disabled' then 'disabled' else 'failed' end;
  select d.id into prior from public.quote_email_deliveries d where d.send_request_id=r.id order by d.attempted_at desc limit 1;
  insert into public.quote_email_deliveries(quote_id,recipient,sender,provider,provider_message_id,delivery_state,error_message,actor_user_id,retry_of,send_request_id,attempt_number) values(r.quote_id,r.recipient,coalesce(nullif(btrim(p_sender),''),'disabled'),case when p_outcome='disabled' then 'disabled' else 'resend' end,case when p_outcome='accepted' then p_provider_message_id end,delivery_state,left(nullif(btrim(p_error_message),''),2000),actor,prior,r.id,greatest(r.attempt_count,1)) returning id into delivery_id;
  update public.quote_email_send_requests set state=new_state,provider=case when p_outcome='disabled' then 'disabled' else 'resend' end,provider_message_id=case when p_outcome='accepted' then p_provider_message_id end,last_error=left(nullif(btrim(p_error_message),''),2000),provider_claimed_at=null,updated_at=now() where id=r.id returning * into r;
  if p_outcome='accepted' and q.status='draft' then update public.quotes set status='sent',sent_at=now(),version=version+1 where id=q.id; end if;
  perform private.sales_audit('QUOTE_EMAIL_ATTEMPT_RECORDED','quote',q.id,q.location_id,jsonb_build_object('send_request_id',r.id,'delivery_id',delivery_id,'outcome',p_outcome,'attempt',r.attempt_count));
  return private.quote_email_send_request_json(r)||jsonb_build_object('delivery_id',delivery_id);
end; $$;

create or replace function public.quote_email_send_status(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.quotes%rowtype; actor uuid;
begin
  if not private.sales_permission('quotes.view') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and private.sales_location_allowed(location_id); if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if; actor:=auth.uid();
  return coalesce((select jsonb_agg(private.quote_email_send_request_json(x) order by x.recipient,x.send_sequence desc) from (select distinct on (recipient) * from public.quote_email_send_requests where quote_id=q.id and actor_user_id=actor order by recipient,send_sequence desc) x),'[]'::jsonb);
end; $$;
revoke execute on function public.prepare_quote_email_send(uuid,text,text,text,jsonb,boolean),public.finish_quote_email_send(uuid,text,text,text,text),public.quote_email_send_status(uuid) from public,anon,service_role;
grant execute on function public.prepare_quote_email_send(uuid,text,text,text,jsonb,boolean),public.finish_quote_email_send(uuid,text,text,text,text),public.quote_email_send_status(uuid) to authenticated;

create or replace function public.quote_detail(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.quotes%rowtype; lines jsonb; result jsonb; location_row public.locations%rowtype; fs public.finance_settings%rowtype; fls public.finance_location_settings%rowtype;
begin
  if not private.sales_permission('quotes.view') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and private.sales_location_allowed(location_id); if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  select * into location_row from public.locations where id=q.location_id; select * into fs from public.finance_settings where singleton; select * into fls from public.finance_location_settings where location_id=q.location_id;
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('product_snapshot',case when p.id is null then null else jsonb_build_object('brand_name',b.display_name,'pattern_name',pat.display_name,'size_name',s.display_size) end) order by l.line_position),'[]'::jsonb) into lines from public.quote_lines l left join public.products p on p.id=l.product_id left join public.tyre_brands b on b.id=p.tyre_brand_id left join public.tyre_patterns pat on pat.id=p.tyre_pattern_id left join public.tyre_sizes s on s.id=p.tyre_size_id where l.quote_id=q.id;
  result:=to_jsonb(q)-'created_by'||jsonb_build_object('lines',lines,'cost_basis',null,'weighted_average_cost',null,'location_name',location_row.name,'business_snapshot',jsonb_build_object('business_name',fs.business_name,'abn',fs.abn,'address',fs.address,'phone',fs.phone,'shared_email',fs.shared_email,'logo_asset_path',fs.logo_asset_path,'invoice_footer',fs.invoice_footer),'branch_snapshot',jsonb_build_object('branch_name',fls.branch_name,'address',fls.address,'phone',fls.phone,'contact_email',fls.contact_email,'document_footer',fls.document_footer));
  return result;
end; $$;
