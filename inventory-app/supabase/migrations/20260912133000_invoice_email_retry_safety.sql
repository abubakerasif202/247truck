-- Bind each durable invoice e-mail request to its exact provider payload and
-- lease the provider call to one worker. Forward-only: historical request and
-- delivery rows are retained unchanged.

alter table public.invoice_email_send_requests
  add column payload_sha256 text,
  add column provider_payload jsonb,
  add column provider_claimed_at timestamptz;

alter table public.invoice_email_send_requests
  drop constraint invoice_email_send_requests_state_check;
alter table public.invoice_email_send_requests
  add constraint invoice_email_send_requests_state_check
  check (state in ('pending','sending','accepted','uncertain','failed','disabled'));
alter table public.invoice_email_send_requests
  add constraint invoice_email_send_requests_payload_sha256_check
  check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$');

-- Existing rows have no payload fingerprint. They can be bound on their first
-- post-upgrade claim while their original provider key is still valid. Once
-- bound, any changed payload is rejected. Expired unresolved rows require
-- reconciliation or an explicit resend; immutable history is not rewritten.
create or replace function public.claim_invoice_email_send(
  p_send_request_id uuid,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  q public.invoice_email_send_requests%rowtype;
  i public.invoices%rowtype;
  actor uuid;
  fingerprint text := lower(btrim(coalesce(p_payload_sha256,'')));
begin
  select * into q
  from public.invoice_email_send_requests
  where id=p_send_request_id
  for update;
  if not found then raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002'; end if;

  select * into i from public.invoices where id=q.invoice_id;
  actor:=private.finance_guard('documents.send',i.location_id);
  perform private.finance_guard('invoices.view',i.location_id);
  if actor<>q.actor_user_id then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if q.state='accepted' then raise exception 'EMAIL_ALREADY_ACCEPTED' using errcode='23505'; end if;
  if q.state='uncertain' then raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;
  if q.key_expires_at<=pg_catalog.now() then raise exception 'EMAIL_RETRY_WINDOW_EXPIRED' using errcode='22023'; end if;
  if q.payload_sha256 is null or q.provider_payload is null then
    raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000';
  end if;
  if q.payload_sha256<>fingerprint then
    raise exception 'EMAIL_PAYLOAD_MISMATCH' using errcode='22023';
  end if;

  -- A short lease prevents simultaneous server actions from independently
  -- contacting the provider. A crashed worker may be retried with the same key
  -- after the lease, while the provider deduplication window is still valid.
  if q.state='sending' and q.provider_claimed_at>pg_catalog.now()-interval '2 minutes' then
    raise exception 'EMAIL_SEND_IN_PROGRESS' using errcode='55P03';
  end if;
  if q.state='sending' then raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;

  update public.invoice_email_send_requests
  set payload_sha256=coalesce(payload_sha256,fingerprint),
      state='sending',provider_claimed_at=pg_catalog.now(),updated_at=pg_catalog.now()
  where id=q.id
  returning * into q;

  return private.invoice_email_send_request_json(q)
    || jsonb_build_object('payload_sha256',q.payload_sha256,'claimed',true);
end;
$$;

revoke execute on function public.claim_invoice_email_send(uuid,text) from public,anon,service_role;
grant execute on function public.claim_invoice_email_send(uuid,text) to authenticated;

-- Include the binding and lease state in status/readback without exposing the
-- payload itself. The boolean tells operators whether a legacy request has
-- acquired a stable payload identity.
create or replace function private.invoice_email_send_request_json(p_request public.invoice_email_send_requests)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_request.id,'invoice_id',p_request.invoice_id,'invoice_revision_id',p_request.invoice_revision_id,
    'revision_number',p_request.revision_number,'recipient',p_request.recipient,'send_sequence',p_request.send_sequence,
    'idempotency_key',p_request.idempotency_key,'state',p_request.state,'provider',p_request.provider,'provider_message_id',p_request.provider_message_id,
    'attempt_count',p_request.attempt_count,'last_error',p_request.last_error,'created_at',p_request.created_at,'last_attempted_at',p_request.last_attempted_at,
    'key_expires_at',p_request.key_expires_at,'key_expired',p_request.key_expires_at<=pg_catalog.now(),
    'payload_bound',p_request.payload_sha256 is not null,'provider_claimed_at',p_request.provider_claimed_at);
$$;

-- Preserve accepted as terminal and release the provider-call lease for every
-- recorded non-accepted outcome.
create or replace function public.finish_invoice_email_send(p_send_request_id uuid,p_outcome text,p_sender text,p_provider_message_id text default null,p_error_message text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.invoice_email_send_requests%rowtype; i public.invoices%rowtype; actor uuid; delivery_id uuid; prior uuid; new_state text; delivery_state text; provider_name text;
begin
  select * into q from public.invoice_email_send_requests where id=p_send_request_id for update; if not found then raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  select * into i from public.invoices where id=q.invoice_id;
  actor:=private.finance_guard('documents.send',i.location_id); perform private.finance_guard('invoices.view',i.location_id);
  if actor<>q.actor_user_id then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_outcome not in ('accepted','failed','uncertain','disabled') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_outcome='accepted' and (p_provider_message_id is null or p_error_message is not null) then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if q.state='accepted' then
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
  update public.invoice_email_send_requests set state=new_state,provider=provider_name,provider_message_id=case when p_outcome='accepted' then p_provider_message_id end,last_error=left(nullif(btrim(p_error_message),''),2000),provider_claimed_at=null,updated_at=pg_catalog.now() where id=q.id returning * into q;
  perform private.sales_audit('INVOICE_EMAIL_ATTEMPT_RECORDED','invoice',i.id,i.location_id,jsonb_build_object('send_request_id',q.id,'delivery_id',delivery_id,'outcome',p_outcome,'attempt',q.attempt_count));
  return private.invoice_email_send_request_json(q)||jsonb_build_object('delivery_id',delivery_id);
end; $$;

revoke execute on function public.finish_invoice_email_send(uuid,text,text,text,text) from public,anon,service_role;
grant execute on function public.finish_invoice_email_send(uuid,text,text,text,text) to authenticated;

-- Harden the opener as well: neither a different mode nor an intentional
-- resend may bypass an unresolved provider outcome. Reconciliation must first
-- establish whether the customer was already sent this revision.
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

  if found and latest.state in ('sending','uncertain') then
    raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000';
  end if;
  if found and p_mode<>'resend' then
    if latest.state='accepted' then raise exception 'EMAIL_ALREADY_ACCEPTED' using errcode='23505'; end if;
    if latest.key_expires_at<=pg_catalog.now() then raise exception 'EMAIL_RETRY_WINDOW_EXPIRED' using errcode='22023'; end if;
    update public.invoice_email_send_requests set attempt_count=attempt_count+1,last_attempted_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=latest.id returning * into latest;
    return private.invoice_email_send_request_json(latest)||jsonb_build_object('reused',true);
  elsif not found and p_mode='retry' then
    raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;

  next_seq:=coalesce(latest.send_sequence,0)+1;
  insert into public.invoice_email_send_requests(invoice_id,invoice_revision_id,revision_number,recipient,actor_user_id,send_sequence,idempotency_key,attempt_count,last_attempted_at,key_expires_at)
    values(i.id,r.id,r.revision_number,v_recipient,actor,next_seq,'invoice-email/'||r.id::text||'/'||next_seq::text||'/'||extensions.gen_random_uuid()::text,1,pg_catalog.now(),pg_catalog.now()+interval '24 hours') returning * into created;
  perform private.sales_audit(case when p_mode='resend' then 'INVOICE_EMAIL_RESEND_REQUESTED' else 'INVOICE_EMAIL_SEND_REQUESTED' end,'invoice',i.id,i.location_id,jsonb_build_object('send_request_id',created.id,'revision_id',r.id,'recipient',v_recipient,'send_sequence',next_seq));
  return private.invoice_email_send_request_json(created)||jsonb_build_object('reused',false);
end; $$;

revoke execute on function public.begin_invoice_email_send(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.begin_invoice_email_send(uuid,uuid,text,text) to authenticated;

-- Application entry point. It persists the complete provider-visible payload
-- (the PDF is base64 inside the private JSON value), installs the durable key,
-- and acquires the provider-call claim in one transaction.
create or replace function public.prepare_invoice_email_send(
  p_invoice_id uuid,p_invoice_revision_id uuid,p_recipient text,p_mode text,
  p_payload_sha256 text,p_provider_payload jsonb,p_claim_provider boolean default true
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; actor uuid; latest public.invoice_email_send_requests%rowtype; created public.invoice_email_send_requests%rowtype;
  v_recipient text:=lower(btrim(p_recipient)); fingerprint text:=lower(btrim(coalesce(p_payload_sha256,''))); next_seq integer; durable_key text; stored jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('documents.send',i.location_id); perform private.finance_guard('invoices.view',i.location_id);
  select * into r from public.invoice_revisions where id=p_invoice_revision_id and invoice_id=i.id;
  if not found or i.status<>'issued' or i.current_revision_id<>r.id or r.lifecycle<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  if p_mode not in ('send','retry','resend') or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_provider_payload)<>'object' or p_provider_payload->>'idempotencyKey'<>'pending-durable-key'
    or p_provider_payload->'to'->>0<>v_recipient or jsonb_array_length(p_provider_payload->'to')<>1
    or nullif(p_provider_payload->>'subject','') is null or nullif(p_provider_payload->>'html','') is null
    or nullif(p_provider_payload->'attachment'->>'filename','') is null or nullif(p_provider_payload->'attachment'->>'contentBase64','') is null
  then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-email:'||r.id::text||':'||v_recipient,0));
  select * into latest from public.invoice_email_send_requests q where q.invoice_revision_id=r.id and q.recipient=v_recipient order by q.send_sequence desc limit 1;
  if found and latest.state in ('sending','uncertain') then raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;
  if found and latest.state='pending' and (latest.payload_sha256 is null or latest.provider_payload is null or latest.key_expires_at<=pg_catalog.now()) then raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;

  if found and p_mode<>'resend' then
    if latest.actor_user_id<>actor then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
    if latest.state='accepted' then raise exception 'EMAIL_ALREADY_ACCEPTED' using errcode='23505'; end if;
    if latest.payload_sha256 is null or latest.provider_payload is null then raise exception 'EMAIL_RECONCILIATION_REQUIRED' using errcode='55000'; end if;
    if latest.key_expires_at<=pg_catalog.now() then raise exception 'EMAIL_RETRY_WINDOW_EXPIRED' using errcode='22023'; end if;
    if latest.payload_sha256<>fingerprint then raise exception 'EMAIL_PAYLOAD_MISMATCH' using errcode='22023'; end if;
    update public.invoice_email_send_requests set state=case when p_claim_provider then 'sending' else state end,
      provider_claimed_at=case when p_claim_provider then pg_catalog.now() else null end,
      attempt_count=attempt_count+1,last_attempted_at=pg_catalog.now(),updated_at=pg_catalog.now()
      where id=latest.id returning * into latest;
    return private.invoice_email_send_request_json(latest)||jsonb_build_object('provider_payload',latest.provider_payload,'reused',true);
  elsif not found and p_mode='retry' then raise exception 'EMAIL_REQUEST_NOT_FOUND' using errcode='P0002';
  end if;

  next_seq:=coalesce(latest.send_sequence,0)+1;
  durable_key:='invoice-email/'||r.id::text||'/'||next_seq::text||'/'||extensions.gen_random_uuid()::text;
  stored:=jsonb_set(p_provider_payload,'{idempotencyKey}',to_jsonb(durable_key),false);
  insert into public.invoice_email_send_requests(invoice_id,invoice_revision_id,revision_number,recipient,actor_user_id,send_sequence,idempotency_key,state,
    payload_sha256,provider_payload,provider_claimed_at,attempt_count,last_attempted_at,key_expires_at)
    values(i.id,r.id,r.revision_number,v_recipient,actor,next_seq,durable_key,case when p_claim_provider then 'sending' else 'pending' end,
      fingerprint,stored,case when p_claim_provider then pg_catalog.now() end,1,pg_catalog.now(),pg_catalog.now()+interval '24 hours') returning * into created;
  perform private.sales_audit(case when p_mode='resend' then 'INVOICE_EMAIL_RESEND_REQUESTED' else 'INVOICE_EMAIL_SEND_REQUESTED' end,'invoice',i.id,i.location_id,jsonb_build_object('send_request_id',created.id,'revision_id',r.id,'recipient',v_recipient,'send_sequence',next_seq));
  return private.invoice_email_send_request_json(created)||jsonb_build_object('provider_payload',created.provider_payload,'reused',false);
end; $$;

revoke execute on function public.prepare_invoice_email_send(uuid,uuid,text,text,text,jsonb,boolean) from public,anon,service_role;
grant execute on function public.prepare_invoice_email_send(uuid,uuid,text,text,text,jsonb,boolean) to authenticated;
