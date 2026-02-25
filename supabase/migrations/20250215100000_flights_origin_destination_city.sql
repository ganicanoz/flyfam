-- Airport cities for display in roster (e.g. SAW (Istanbul))
alter table public.flights
  add column if not exists origin_city text,
  add column if not exists destination_city text;

comment on column public.flights.origin_city is 'City name for origin airport (e.g. Istanbul)';
comment on column public.flights.destination_city is 'City name for destination airport (e.g. Antalya)';
