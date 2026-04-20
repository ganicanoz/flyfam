-- Store delay minutes from API (AE delay_dep / delay_arr).
-- Useful for showing delay while en_route (estimated arrival delay).
alter table public.flights
  add column if not exists delay_dep_min integer,
  add column if not exists delay_arr_min integer;

comment on column public.flights.delay_dep_min is 'Departure delay in minutes (from API when available)';
comment on column public.flights.delay_arr_min is 'Arrival delay in minutes (from API when available)';

