-- Phase 4A only: no payment/provider/worker tables or live activation.
create table public.finance_settings (
  singleton boolean primary key default true check (singleton),
  business_name text, abn text, address jsonb, phone text, shared_email text,
  logo_asset_path text, logo_sha256 text, bank_instructions jsonb, invoice_footer text,
  -- Phase 4A keeps these OFF: defaults are false and no Phase 4A RPC/UI can set them
  -- true. The columns stay forward-compatible for later explicitly authorised phases,
  -- so there is deliberately no permanent CHECK (NOT flag) schema lock here.
  stripe_enabled boolean not null default false,
  email_automation_enabled boolean not null default false,
  reminders_enabled boolean not null default false,
  currency text not null default 'AUD' check (currency='AUD'),
  timezone text not null default 'Australia/Adelaide' check (timezone='Australia/Adelaide'),
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0)
);
create table public.finance_location_settings (
  location_id uuid primary key references public.locations(id) on delete restrict,
  branch_name text, address jsonb, phone text, contact_email text, document_footer text,
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0)
);
create table public.invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_number text not null unique check (invoice_number ~ '^(LON|REG)-INV-[0-9]{6,}$'),
  location_id uuid not null references public.locations(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  customer_vehicle_id uuid references public.customer_vehicles(id) on delete restrict,
  job_id uuid unique references public.jobs(id) on delete restrict,
  source_type text not null check (source_type in ('job','pos','manual')),
  status text not null default 'draft' check (status in ('draft','issued','cancelled')),
  current_revision_id uuid,
  first_issued_at timestamptz, first_payment_at timestamptz, cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict, cancellation_reason text,
  operational_notes text, reminders_suppressed boolean not null default false,
  suppression_reason text, delivery_email_override text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0),
  check ((source_type='manual' and job_id is null) or (source_type in ('job','pos') and job_id is not null)),
  check ((status='cancelled' and cancelled_at is not null and cancelled_by is not null and nullif(btrim(cancellation_reason),'') is not null)
    or (status<>'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)),
  check (customer_vehicle_id is null or customer_id is not null)
);
create table public.invoice_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  revision_number integer not null check (revision_number>0),
  lifecycle text not null default 'draft' check (lifecycle in ('draft','issued')),
  issued_at timestamptz, issue_date date, due_date date,
  payment_terms text not null default 'due_on_receipt' check (payment_terms in ('due_on_receipt','7_days','14_days','30_days')),
  currency text not null default 'AUD' check (currency='AUD'),
  business_snapshot jsonb not null default '{}', customer_snapshot jsonb not null default '{}', branch_snapshot jsonb not null default '{}',
  billing_contact_snapshot jsonb, vehicle_snapshot jsonb,
  customer_reference text, customer_notes text, source_job_number text, source_quote_number text,
  total_incl_gst numeric(14,2), subtotal_ex_gst numeric(14,2), gst_amount numeric(14,2),
  pricing_complete boolean not null default false, revision_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0),
  unique(invoice_id,revision_number), unique(invoice_id,id),
  check ((pricing_complete and total_incl_gst is not null and subtotal_ex_gst is not null and gst_amount is not null
    and total_incl_gst>=0 and subtotal_ex_gst>=0 and gst_amount>=0 and total_incl_gst=subtotal_ex_gst+gst_amount)
    or (not pricing_complete and total_incl_gst is null and subtotal_ex_gst is null and gst_amount is null)),
  check (lifecycle<>'issued' or (pricing_complete and issued_at is not null and issue_date is not null and due_date is not null))
);
alter table public.invoices add constraint invoices_current_revision_fk
  foreign key (id,current_revision_id) references public.invoice_revisions(invoice_id,id) deferrable initially deferred;
create table public.invoice_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_id uuid not null, revision_id uuid not null,
  position integer not null check (position>0),
  source_job_line_id uuid references public.job_lines(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  used_tyre_unit_id uuid references public.used_tyre_units(id) on delete restrict,
  line_type text not null check (line_type in ('product','labour')),
  description text not null check (nullif(btrim(description),'') is not null),
  quantity numeric(12,3) not null check (quantity>0),
  unit_price_incl_gst numeric(14,2) check (unit_price_incl_gst>=0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  discount_reason text, discount_actor_user_id uuid references auth.users(id) on delete restrict,
  discount_authorised_at timestamptz,
  base_incl_gst numeric(14,2), discount_amount numeric(14,2), total_incl_gst numeric(14,2),
  gst_amount numeric(14,2), subtotal_ex_gst numeric(14,2),
  gst_rate numeric(5,4) not null default 0.1000 check (gst_rate=0.1000),
  created_at timestamptz not null default now(),
  foreign key (invoice_id,revision_id) references public.invoice_revisions(invoice_id,id) on delete restrict,
  unique(revision_id,position),
  check ((line_type='product' and product_id is not null and source_job_line_id is not null and quantity=trunc(quantity))
    or (line_type='labour' and product_id is null and used_tyre_unit_id is null)),
  check (discount_percent=0 or (nullif(btrim(discount_reason),'') is not null and length(discount_reason)<=500
    and discount_actor_user_id is not null and discount_authorised_at is not null)),
  check ((unit_price_incl_gst is null and base_incl_gst is null and discount_amount is null and total_incl_gst is null and gst_amount is null and subtotal_ex_gst is null)
    or (unit_price_incl_gst is not null and base_incl_gst is not null and discount_amount is not null and total_incl_gst is not null and gst_amount is not null and subtotal_ex_gst is not null
    and base_incl_gst=round(quantity*unit_price_incl_gst,2) and discount_amount=round(base_incl_gst*discount_percent/100,2)
    and total_incl_gst=base_incl_gst-discount_amount and gst_amount>=0 and subtotal_ex_gst>=0 and total_incl_gst=gst_amount+subtotal_ex_gst))
);
create table public.invoice_line_costs (
  invoice_line_id uuid primary key references public.invoice_lines(id) on delete restrict,
  inventory_movement_id uuid references public.inventory_movements(id) on delete restrict,
  source_job_line_id uuid references public.job_lines(id) on delete restrict,
  captured_unit_cost numeric(14,4) check (captured_unit_cost>=0),
  captured_quantity numeric(12,3) not null check (captured_quantity>0),
  capture_source text not null check (capture_source in ('job_consumption','not_applicable')),
  created_at timestamptz not null default now()
);
create table public.finance_action_requests (
  request_id uuid primary key,
  action text not null check (action in ('update_finance_settings','finance_draft','finance_issue','finance_revise')),
  actor_kind text not null check (actor_kind in ('staff','stripe','worker')),
  actor_user_id uuid references auth.users(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  entity_type text, entity_id uuid, payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null, created_at timestamptz not null default now(),
  check ((actor_kind='staff' and actor_user_id is not null) or (actor_kind<>'staff' and actor_user_id is null))
);
create table public.financial_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  invoice_revision_id uuid not null,
  document_type text not null check (document_type='tax_invoice'),
  document_number text unique, source_key text not null unique,
  snapshot jsonb not null, template_version text not null,
  content_sha256 text check (content_sha256 ~ '^[a-f0-9]{64}$'), storage_path text unique,
  render_status text not null default 'queued' check (render_status in ('queued','rendering','ready','failed')),
  render_error_code text, created_by uuid references auth.users(id) on delete restrict, rendered_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0),
  foreign key (invoice_id,invoice_revision_id) references public.invoice_revisions(invoice_id,id) on delete restrict,
  unique(invoice_revision_id,document_type)
);

alter table public.finance_settings enable row level security;
alter table public.finance_location_settings enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_revisions enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_line_costs enable row level security;
alter table public.finance_action_requests enable row level security;
alter table public.financial_documents enable row level security;
revoke all on public.finance_settings,public.finance_location_settings,public.invoices,public.invoice_revisions,
  public.invoice_lines,public.invoice_line_costs,public.finance_action_requests,public.financial_documents
  from public,anon,authenticated,service_role;

alter table public.audit_events drop constraint audit_events_actor_role_check;
alter table public.audit_events add constraint audit_events_actor_role_check check (actor_role in ('admin','manager','system'));
alter table public.audit_events add constraint audit_events_system_actor_check
  check (actor_role<>'system' or (actor_user_id is null and details->>'actor_kind' is not null and details->>'actor_kind' in ('stripe','worker')));

create index finance_settings_actor_idx on public.finance_settings(updated_by);
create index finance_location_settings_actor_idx on public.finance_location_settings(updated_by);
create index invoices_location_status_idx on public.invoices(location_id,status,created_at,id);
create index invoices_customer_idx on public.invoices(customer_id,location_id);
create index invoices_vehicle_idx on public.invoices(customer_vehicle_id);
create index invoices_creator_idx on public.invoices(created_by);
create index invoices_canceller_idx on public.invoices(cancelled_by);
create index invoices_revision_idx on public.invoices(current_revision_id);
create index invoice_revisions_due_idx on public.invoice_revisions(due_date,invoice_id);
create index invoice_revisions_issue_idx on public.invoice_revisions(invoice_id,issued_at);
create index invoice_revisions_actor_idx on public.invoice_revisions(created_by);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id,revision_id);
create index invoice_lines_source_idx on public.invoice_lines(source_job_line_id);
create index invoice_lines_product_idx on public.invoice_lines(product_id);
create index invoice_lines_unit_idx on public.invoice_lines(used_tyre_unit_id);
create index invoice_lines_discount_actor_idx on public.invoice_lines(discount_actor_user_id);
create index invoice_costs_movement_idx on public.invoice_line_costs(inventory_movement_id);
create index invoice_costs_source_idx on public.invoice_line_costs(source_job_line_id);
create index finance_requests_actor_idx on public.finance_action_requests(actor_user_id,created_at);
create index finance_requests_location_idx on public.finance_action_requests(location_id);
create index financial_documents_invoice_idx on public.financial_documents(invoice_id,invoice_revision_id);
create index financial_documents_location_idx on public.financial_documents(location_id);
create index financial_documents_actor_idx on public.financial_documents(created_by);
