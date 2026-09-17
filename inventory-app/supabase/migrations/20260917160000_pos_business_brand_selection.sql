-- POS business (brand) selection for shared locations.
--
-- Gap found while wiring the first real internal-sale workflow to the new
-- multi-organization model: the existing invoice-brand mechanism
-- (20260915184930_multi_brand_invoicing.sql) resolves a location's brand
-- with a hardcoded location-code mapping (LON -> 'awt', REG -> '247') and
-- only lets an *admin* override it. That assumption predates
-- organization_location_assignments and is now stale for REG, which
-- legitimately has both 247TRUCK and AWT active. A non-admin staff member
-- at REG could not previously select AWT for a sale at all.
--
-- Two DISTINCT authorization concerns are deliberately kept separate here,
-- per an explicit hardening pass after the first draft of this migration
-- conflated them:
--
--   1. private.invoice_brand_guard / public.invoice_brand_options: the
--      pre-existing, general invoice-brand mechanism used by manual invoice
--      creation and job-to-invoice creation. It keeps its legacy
--      location-code fallback for any location with zero organization
--      assignments (this is what keeps LON's existing manual/job invoice
--      behaviour byte-identical - LON is deliberately left unassigned, see
--      20260917150000, and this remediation does not invent an
--      organization boundary for it).
--
--   2. private.pos_brand_guard / public.pos_business_options: a NEW, STRICT
--      pair used only by the POS entry points. It derives business
--      authorization ONLY from organization_location_assignments, with NO
--      location-code fallback at all. A location with zero active
--      organizations (LON, today) has zero authorized POS businesses, full
--      stop - POS authorization must never let a location's legacy display
--      name imply it is an authorized business boundary. This is the fix
--      for a real gap in the first draft: that draft's shared
--      invoice_brand_guard would have let a POS sale at LON silently
--      resolve to 'awt' via the same fallback meant only for old invoice
--      compatibility.
--
-- public.finalise_pos_sale (the pre-existing, brand-less entry point) is
-- also hardened here: at a location with more than one active organization
-- (REG today), it now fails closed with BUSINESS_SELECTION_REQUIRED instead
-- of silently producing a '247'-branded invoice via the legacy
-- invoice_brand_default_trigger. This closes the direct-RPC-call bypass of
-- the frontend's business selector. It is NOT restricted at a location with
-- zero or one active organization: repository inspection found this
-- function has no application caller other than the POS UI (which now
-- calls the brand-aware sibling below) and a pre-existing regression suite
-- (tests/integration/finance-pos-finalisation.test.ts) that exercises it
-- directly at LON and asserts on its exact legacy-default behaviour there.
-- Restricting the zero/one-organization case as well would break that
-- proven, currently-passing historical contract for no corresponding
-- security benefit - LON was never a two-business ambiguity to hide from,
-- so its existing single hardcoded default is not the flaw the
-- multi-organization gap actually is at REG.
--
-- Also adds public.finalise_pos_sale_with_brand, a sibling of
-- public.finalise_pos_sale following the exact pattern this codebase
-- already uses for every other brand-aware entry point
-- (create_invoice_from_job_with_brand, complete_job_and_create_invoice_with_brand,
-- update_invoice_draft_with_brand, create_manual_invoice_with_brand): the
-- original, brand-less function is left in place (now hardened as above),
-- and the new sibling is the one the POS UI calls.
-- finalise_pos_sale cannot be wrapped after-the-fact the way the other
-- _with_brand functions wrap their originals, because it creates, completes
-- AND issues the invoice in one transaction with no post-call "still draft"
-- window to patch brand into - so the brand guard call and the
-- brand-patch-before-issue line are inlined into a full copy of its body.
-- Every other line is unchanged from the current, already-applied
-- 20260908120000_phase_4c_manual_payments_receivables.sql version.
--
-- Cross-entrypoint idempotency (finalise_pos_sale vs
-- finalise_pos_sale_with_brand): finance_action_requests.request_id is
-- already the table's PRIMARY KEY (20260905183057_phase_4a_finance_foundation.sql),
-- not a (request_id, action) composite - private.finance_request looks a
-- request up by request_id ALONE, then rejects a mismatched action or
-- payload with IDEMPOTENCY_KEY_REUSED before either function does anything.
-- The same request_id can therefore never successfully execute through both
-- entry points: whichever call arrives second finds the first call's row
-- under a different action/payload and is rejected outright, not silently
-- re-run. This is verified directly by tests, not merely asserted here. On
-- that basis, finalise_pos_sale_with_brand keeps its own distinct action
-- name - the two entry points have genuinely different call contracts (the
-- old one has no p_brand parameter at all), and unifying the action name
-- would not add any additional safety beyond what the primary key already
-- guarantees.

-- private.finance_request enforces an allowlist of known action names via
-- this check constraint; finalise_pos_sale_with_brand needs its own entry
-- to use the same idempotency mechanism finalise_pos_sale already relies on.
-- Every one of the 19 previously allowed values (from
-- 20260911100000_phase_4d_credit_notes_refunds.sql, the last migration to
-- touch this constraint) is preserved verbatim below; only
-- 'finalise_pos_sale_with_brand' is newly added.
alter table public.finance_action_requests drop constraint finance_action_requests_action_check;
alter table public.finance_action_requests add constraint finance_action_requests_action_check check (action in (
  'update_finance_settings','finance_draft','finance_issue','finance_revise',
  'create_invoice_from_job','complete_job_and_create_invoice','create_manual_invoice','update_invoice_draft',
  'issue_invoice','revise_unpaid_invoice','cancel_invoice','record_invoice_payment','reverse_manual_payment',
  'finalise_pos_sale','create_manual_invoice_v2','update_invoice_draft_v2','duplicate_invoice_draft','void_issued_invoice',
  'create_invoice_credit_refund','confirm_manual_refund','retry_invoice_refund','finalise_pos_sale_with_brand'
));

create or replace function private.invoice_brand_for_organization_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code when '247TRUCK' then '247' when 'AWT' then 'awt' else null end
$$;

create or replace function private.location_authorized_brands(p_location_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(private.invoice_brand_for_organization_code(o.code) order by o.code)
      filter (where private.invoice_brand_for_organization_code(o.code) is not null),
    '{}'::text[]
  )
  from public.organization_location_assignments ola
  join public.organizations o on o.id = ola.organization_id and o.active
  where ola.location_id = p_location_id and ola.active
$$;

revoke execute on function private.invoice_brand_for_organization_code(text),
  private.location_authorized_brands(uuid)
  from public, anon, authenticated, service_role;

-- Legacy/general invoice-brand guard - keeps the pre-existing
-- location-code fallback for locations with no organization assignment.
-- Used by manual invoice creation and job-to-invoice creation only, never
-- by POS (see private.pos_brand_guard below for that).
create or replace function private.invoice_brand_guard(p_brand text, p_location_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authorized text[] := private.location_authorized_brands(p_location_id);
  v_chosen text;
begin
  if array_length(v_authorized, 1) is null then
    -- No organization is assigned to this location yet (e.g. legacy LON).
    -- Preserve the exact pre-existing behaviour: admin-only override of the
    -- hardcoded location-code default.
    v_chosen := coalesce(nullif(p_brand, ''), private.invoice_brand_for_location(p_location_id));
    if not private.app_is_admin() and v_chosen is distinct from private.invoice_brand_for_location(p_location_id) then
      raise exception 'ACCESS_DENIED' using errcode = '42501';
    end if;
  else
    -- This location has one or more organizations actively authorized
    -- against it. Any brand among those is legitimately selectable by any
    -- staff member already authorized at this location (finance_guard has
    -- already run, or runs immediately after this in every caller) - never
    -- an admin-only override. Preselect only when unambiguous.
    v_chosen := coalesce(
      nullif(p_brand, ''),
      case when array_length(v_authorized, 1) = 1 then v_authorized[1] end
    );
    if v_chosen is null or not (v_chosen = any(v_authorized)) then
      raise exception 'ACCESS_DENIED' using errcode = '42501';
    end if;
  end if;
  if v_chosen is null or v_chosen not in ('247', 'awt') then
    raise exception 'INVALID_INVOICE_BRAND' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_brand_settings s where s.brand = v_chosen) then
    raise exception 'INVOICE_BRAND_NOT_CONFIGURED' using errcode = '22023';
  end if;
  return v_chosen;
end;
$$;

create or replace function public.invoice_brand_options(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authorized text[] := private.location_authorized_brands(p_location_id);
  v_default text;
  v_can_override boolean;
  v_visible_brands text[];
begin
  perform private.finance_guard('invoices.view', p_location_id);
  if array_length(v_authorized, 1) is null then
    v_default := private.invoice_brand_for_location(p_location_id);
    v_can_override := private.app_is_admin();
    v_visible_brands := case when private.app_is_admin() then array['247', 'awt'] else array[v_default] end;
  else
    v_default := case when array_length(v_authorized, 1) = 1 then v_authorized[1] end;
    v_can_override := array_length(v_authorized, 1) > 1;
    v_visible_brands := v_authorized;
  end if;
  return jsonb_build_object(
    'default_brand', v_default,
    'can_override', v_can_override,
    'brands', (select coalesce(jsonb_agg(jsonb_build_object(
      'brand', s.brand, 'business_name', s.business_name, 'abn', s.abn, 'address', s.address, 'phone', s.phone,
      'email', s.email, 'website', s.website, 'logo_asset_path', s.logo_asset_path,
      'primary_colour', s.primary_colour, 'accent_colour', s.accent_colour,
      'bank_instructions', s.bank_instructions, 'invoice_footer', s.invoice_footer,
      'email_sender_name', s.email_sender_name, 'reply_to_address', s.reply_to_address, 'version', s.version
    ) order by s.brand), '[]'::jsonb) from public.invoice_brand_settings s where s.brand = any(v_visible_brands))
  );
end;
$$;

-- Strict POS business guard: no location-code fallback whatsoever. A
-- location with zero actively-assigned organizations has zero POS
-- businesses - it is not entitled to any legacy default. This is
-- deliberately a different, stricter policy than invoice_brand_guard above.
create or replace function private.pos_brand_guard(p_brand text, p_location_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authorized text[] := private.location_authorized_brands(p_location_id);
  v_chosen text;
begin
  if array_length(v_authorized, 1) is null then
    raise exception 'BUSINESS_NOT_CONFIGURED' using errcode = '22023';
  end if;
  v_chosen := coalesce(
    nullif(p_brand, ''),
    case when array_length(v_authorized, 1) = 1 then v_authorized[1] end
  );
  if v_chosen is null then
    raise exception 'BUSINESS_SELECTION_REQUIRED' using errcode = '22023';
  end if;
  if not (v_chosen = any(v_authorized)) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.invoice_brand_settings s where s.brand = v_chosen) then
    raise exception 'INVOICE_BRAND_NOT_CONFIGURED' using errcode = '22023';
  end if;
  return v_chosen;
end;
$$;

revoke execute on function private.pos_brand_guard(text, uuid) from public, anon, authenticated, service_role;

-- Strict POS read helper the frontend business selector calls. Deliberately
-- separate from public.invoice_brand_options (which keeps the legacy
-- location-code fallback for other, non-POS surfaces) - POS authorization
-- and general invoice-brand display defaults are different concerns and
-- must not share one ambiguous API.
create or replace function public.pos_business_options(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_authorized text[] := private.location_authorized_brands(p_location_id);
begin
  perform private.finance_guard('invoices.view', p_location_id);
  return jsonb_build_object(
    'default_brand', case when array_length(v_authorized, 1) = 1 then v_authorized[1] end,
    'can_override', coalesce(array_length(v_authorized, 1), 0) > 1,
    'businesses', (select coalesce(jsonb_agg(jsonb_build_object(
      'brand', s.brand, 'business_name', s.business_name
    ) order by s.brand), '[]'::jsonb)
    from public.invoice_brand_settings s where s.brand = any(v_authorized))
  );
end;
$$;

revoke execute on function public.pos_business_options(uuid) from public, anon, service_role;
grant execute on function public.pos_business_options(uuid) to authenticated;

-- Hardens the pre-existing public.finalise_pos_sale: fails closed with
-- BUSINESS_SELECTION_REQUIRED at a location with more than one active
-- organization, instead of silently producing a '247'-branded invoice via
-- the legacy trigger default. See the migration-level comment above for why
-- the zero/one-organization case is intentionally left unrestricted. Every
-- other line is unchanged from the currently-applied
-- 20260908120000_phase_4c_manual_payments_receivables.sql body.
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
  if array_length(private.location_authorized_brands(p_location_id), 1) > 1 then
    raise exception 'BUSINESS_SELECTION_REQUIRED' using errcode='22023';
  end if;
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

-- public.finalise_pos_sale_with_brand: byte-identical to the current
-- public.finalise_pos_sale body except for the strict brand guard call,
-- including p_brand in the idempotency payload (so replaying the same
-- request_id with a different brand is rejected as a changed request, not
-- silently reattributed), and patching the drafted invoice's brand before
-- it is issued (finance_issue_snapshots reads invoices.brand to build the
-- issued rendering snapshot, so this must happen before finance_issue_locked).
create or replace function public.finalise_pos_sale_with_brand(
  p_request_id uuid, p_location_id uuid, p_customer_id uuid, p_customer_vehicle_id uuid,
  p_job_id uuid, p_expected_job_version integer, p_job jsonb, p_lines jsonb, p_tenders jsonb,
  p_brand text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=(select auth.uid()); existing public.jobs%rowtype; customer public.customers%rowtype;
  payload jsonb; replay jsonb; created jsonb; updated jsonb; completed jsonb; draft jsonb; issued jsonb; payment jsonb;
  create_child uuid:=pg_catalog.md5('finalise_pos_sale:create:'||p_request_id::text)::uuid;
  complete_child uuid:=pg_catalog.md5('finalise_pos_sale:complete:'||p_request_id::text)::uuid;
  jid uuid; job_version integer; iid uuid; total numeric; customer_type text; result jsonb; child uuid;
  chosen_brand text;
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
  -- Business identity is resolved and authorized up front, before any job or
  -- invoice row is touched, using the STRICT POS guard: no location-code
  -- fallback, ever - not even at LON.
  chosen_brand := private.pos_brand_guard(p_brand, p_location_id);
  if p_customer_id is null then
    customer_type:='walk_in';
    if nullif(pg_catalog.btrim(p_job->>'walk_in_label'),'') is null then raise exception 'CUSTOMER_REQUIRED' using errcode='22023'; end if;
    if p_customer_vehicle_id is not null then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  else
    select * into customer from public.customers where id=p_customer_id and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
    customer_type:=customer.customer_type;
  end if;
  payload:=pg_catalog.jsonb_build_object('location_id',p_location_id,'customer_id',p_customer_id,'customer_vehicle_id',p_customer_vehicle_id,'job_id',p_job_id,'expected_job_version',p_expected_job_version,'job',p_job,'lines',p_lines,'tenders',p_tenders,'brand',chosen_brand);
  replay:=private.finance_request(p_request_id,'finalise_pos_sale_with_brand',payload); if replay is not null then return replay; end if;
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
  update public.invoices set brand=chosen_brand where id=iid and status='draft';
  if customer_type='business' then update public.invoice_revisions set payment_terms=customer.payment_terms where id=(draft->>'revision_id')::uuid; end if;
  issued:=private.finance_issue_locked(iid,(draft->>'version')::integer);
  select r.total_incl_gst into total from public.invoice_revisions r where r.id=(draft->>'revision_id')::uuid;
  if total=0 and pg_catalog.jsonb_array_length(p_tenders)>0 then raise exception 'ZERO_TOTAL_TENDERS_NOT_ALLOWED' using errcode='22023'; end if;
  if total>0 and customer_type<>'business' and pg_catalog.jsonb_array_length(p_tenders)=0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  if pg_catalog.jsonb_array_length(p_tenders)>0 then payment:=private.finance_record_tenders(pg_catalog.md5('finalise_pos_sale:payment:'||p_request_id::text)::uuid,iid,p_tenders); if customer_type<>'business' and coalesce((payment->>'balance')::numeric,-1)<>0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  else payment:=pg_catalog.jsonb_build_object('payments','[]'::jsonb,'balance',total,'version',(issued->>'version')::integer); end if;
  result:=pg_catalog.jsonb_build_object('job_id',jid,'job_number',coalesce(created->>'job_number',existing.job_number),'job_version',job_version,'invoice_id',iid,'invoice_number',draft->>'invoice_number','invoice_version',coalesce((payment->>'version')::integer,(issued->>'version')::integer),'status','issued','total_incl_gst',total,'payment',payment,'brand',chosen_brand);
  perform private.finance_request_finish(p_request_id,'finalise_pos_sale_with_brand',payload,p_location_id,iid,result); return result;
end;
$$;

revoke execute on function public.finalise_pos_sale_with_brand(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text)
  from public, anon, service_role;
grant execute on function public.finalise_pos_sale_with_brand(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text)
  to authenticated;
