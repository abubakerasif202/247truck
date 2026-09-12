-- transfer_summary had no row limit at all: as the number of transfers grows
-- this becomes a fully unbounded fetch. Cap it with an optional, capped
-- p_limit (default 200, max 500) rather than leaving it truly unbounded.
-- Existing callers that don't pass p_limit keep working unchanged.

-- Adding a parameter changes the signature: CREATE OR REPLACE would leave the
-- old public.transfer_summary(text) overload behind (still unbounded and
-- still reachable), so the old signature must be dropped explicitly.
drop function if exists public.transfer_summary(text);

create or replace function public.transfer_summary(p_status text default null, p_limit integer default 200)
returns table(id uuid, transfer_number text, source_code text, destination_code text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not (select private.app_has_permission('inventory.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  return query select t.id,t.transfer_number,s.code,d.code,t.status,t.created_at from public.stock_transfers t
    join public.locations s on s.id=t.source_location_id join public.locations d on d.id=t.destination_location_id
    where ((select private.app_is_admin()) or t.source_location_id=(select private.app_user_location_id()) or t.destination_location_id=(select private.app_user_location_id()))
    and (p_status is null or t.status=p_status) order by t.created_at desc limit v_limit;
end;
$$;

revoke execute on function public.transfer_summary(text, integer) from public, anon, service_role;
grant execute on function public.transfer_summary(text, integer) to authenticated;
