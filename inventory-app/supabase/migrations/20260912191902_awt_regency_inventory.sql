-- AWT checkout holds share the existing reserved balance with jobs/POS.
-- Explicitly allowlisted authenticated operator; no service-role ledger bypass.
create table private.awt_integration_users (
  user_id uuid primary key references auth.users(id)
);
create table private.awt_product_links (
  website_id text primary key check (length(website_id) between 1 and 150),
  product_id uuid not null unique references public.products(id)
);
create table private.awt_checkouts (
  session_id text primary key check (length(session_id) between 1 and 255),
  reference text not null check (length(reference) between 1 and 150),
  lines jsonb not null,
  state text not null default 'reserved' check (state in ('reserved','sold','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.awt_integration_users enable row level security;
alter table private.awt_product_links enable row level security;
alter table private.awt_checkouts enable row level security;
revoke all on private.awt_integration_users, private.awt_product_links, private.awt_checkouts
  from public, anon, authenticated, service_role;

create function private.awt_location() returns uuid
language plpgsql security definer set search_path='' as $$
declare loc uuid;
begin
  if not exists(select 1 from private.awt_integration_users where user_id=(select auth.uid())) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  select id into strict loc from public.locations where code='REG';
  perform private.assert_stock_authorization(loc,'stock_out');
  return loc;
end;
$$;
revoke all on function private.awt_location() from public,anon,authenticated,service_role;

create function public.awt_availability() returns table(website_id text, available integer)
language plpgsql security definer set search_path='' as $$
declare loc uuid := private.awt_location();
begin
  return query select l.website_id, greatest(0,b.on_hand-b.reserved)
  from private.awt_product_links l join public.products p on p.id=l.product_id
  join public.inventory_balances b on b.product_id=p.id and b.location_id=loc
  where p.active and p.tyre_condition='new';
end;
$$;

create function public.awt_reserve(p_session_id text,p_reference text,p_lines jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  loc uuid := private.awt_location(); old private.awt_checkouts%rowtype;
  canonical jsonb; mapped jsonb; item record; n integer;
begin
  if p_session_id is null or p_reference is null or p_lines is null or jsonb_typeof(p_lines)<>'array' then
    raise exception 'INVALID_CHECKOUT' using errcode='22023';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception 'INVALID_LINES' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lines) x
    where jsonb_typeof(x->'id') is distinct from 'string'
    or jsonb_typeof(x->'quantity') is distinct from 'number'
    or (x->>'quantity') !~ '^[1-9][0-9]{0,5}$') then
    raise exception 'INVALID_LINES' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'quantity',quantity) order by id) into canonical
  from (select x->>'id' id,sum((x->>'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_lines) x group by x->>'id') q;
  perform pg_advisory_xact_lock(hashtextextended('awt:'||p_session_id,0));
  select * into old from private.awt_checkouts where session_id=p_session_id;
  if found then
    -- Compare website identities/quantities against the immutable stored mapping.
    if old.reference<>p_reference or
       (select jsonb_agg(jsonb_build_object('id',x->>'id','quantity',(x->>'quantity')::integer) order by x->>'id')
        from jsonb_array_elements(old.lines) x) <> canonical then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023';
    end if;
    if old.state='released' then raise exception 'CHECKOUT_RELEASED'; end if;
    return;
  end if;
  select jsonb_agg(jsonb_build_object('id',x->>'id','quantity',(x->>'quantity')::integer,
    'product_id',l.product_id,'request_id',extensions.gen_random_uuid()) order by l.product_id),count(*)
    into mapped,n
  from jsonb_array_elements(canonical) x
  join private.awt_product_links l on l.website_id=x->>'id'
  join public.products p on p.id=l.product_id and p.active and p.tyre_condition='new';
  if n<>jsonb_array_length(canonical) then raise exception 'PRODUCT_NOT_LINKED'; end if;
  -- Stable lock order prevents concurrent multi-product checkouts deadlocking.
  for item in select * from jsonb_to_recordset(mapped) as x(product_id uuid,quantity integer) order by product_id loop
    perform 1 from public.inventory_balances where product_id=item.product_id and location_id=loc for update;
    update public.inventory_balances set reserved=reserved+item.quantity,updated_at=now()
      where product_id=item.product_id and location_id=loc and on_hand-reserved>=item.quantity;
    if not found then raise exception 'INSUFFICIENT_STOCK' using errcode='23514'; end if;
  end loop;
  insert into private.awt_checkouts(session_id,reference,lines) values(p_session_id,p_reference,mapped);
end;
$$;

create function public.awt_settle(p_session_id text,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare loc uuid := private.awt_location(); checkout private.awt_checkouts%rowtype; item record;
begin
  if p_action is null or p_action not in ('sold','released') then raise exception 'INVALID_ACTION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('awt:'||p_session_id,0));
  select * into checkout from private.awt_checkouts where session_id=p_session_id for update;
  if not found then
    if p_action='released' then return; end if;
    raise exception 'CHECKOUT_NOT_FOUND';
  end if;
  if checkout.state=p_action then return; end if;
  if checkout.state='sold' and p_action='released' then return; end if;
  if checkout.state<>'reserved' then raise exception 'CHECKOUT_ALREADY_RELEASED'; end if;
  for item in select * from jsonb_to_recordset(checkout.lines)
    as x(product_id uuid,quantity integer,request_id uuid) order by product_id loop
    perform 1 from public.inventory_balances where product_id=item.product_id and location_id=loc for update;
    update public.inventory_balances set reserved=reserved-item.quantity,updated_at=now()
      where product_id=item.product_id and location_id=loc and reserved>=item.quantity;
    if not found then raise exception 'RESERVATION_INCONSISTENT'; end if;
    if p_action='sold' then
      perform * from public.post_inventory_movement_with_notes(
        item.request_id,item.product_id,loc,-item.quantity,'stock_out',
        null,null,null,'awt_website',p_session_id,null,
        'Adelaide Wholesale Tyres paid order '||checkout.reference);
    end if;
  end loop;
  update private.awt_checkouts set state=p_action,updated_at=now() where session_id=p_session_id;
end;
$$;

-- Recovery intentionally does not expire holds by wall-clock time: Stripe must
-- confirm expired/failed before release, or paid before conversion to a sale.
create function public.awt_pending_checkouts() returns table(session_id text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform private.awt_location();
  return query select c.session_id,c.created_at from private.awt_checkouts c
    where c.state='reserved' order by c.created_at limit 1000;
end;
$$;
revoke execute on function public.awt_availability(),public.awt_reserve(text,text,jsonb),
  public.awt_settle(text,text),public.awt_pending_checkouts() from public,anon,service_role;
grant execute on function public.awt_availability(),public.awt_reserve(text,text,jsonb),
  public.awt_settle(text,text),public.awt_pending_checkouts() to authenticated;
