-- Uçak tipi (AirLabs aircraft_icao / AE aircraft.icaoCode vb.).
alter table public.flights
  add column if not exists aircraft_type text;

comment on column public.flights.aircraft_type is
  'Aircraft type code when known (e.g. A333, B738). Display may map to A330 / B737.';
