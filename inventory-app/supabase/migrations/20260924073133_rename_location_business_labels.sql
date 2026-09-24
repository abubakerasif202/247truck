-- Rename only the display names. REG/LON IDs, codes, stock, and historical
-- document snapshots remain unchanged.
do $$
declare
  reg_name text;
  lon_name text;
begin
  select name into reg_name from public.locations where code = 'REG' for update;
  if reg_name is null or reg_name not in ('Regency Park', '24/7 Truck Tyre Services') then
    raise exception 'Unexpected REG location name: %', reg_name;
  end if;

  select name into lon_name from public.locations where code = 'LON' for update;
  if lon_name is null or lon_name not in ('Lonsdale', 'AWT Tyres Website', 'Adelaide Wholesale Tyres') then
    raise exception 'Unexpected LON location name: %', lon_name;
  end if;

  update public.locations set name = '24/7 Truck Tyre Services'
  where code = 'REG' and name is distinct from '24/7 Truck Tyre Services';
  update public.locations set name = 'Adelaide Wholesale Tyres'
  where code = 'LON' and name is distinct from 'Adelaide Wholesale Tyres';
end;
$$;
