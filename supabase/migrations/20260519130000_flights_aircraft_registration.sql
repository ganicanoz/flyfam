-- Kuyruk tescili (FR24 / AirLabs poll ile doldurulabilir).
alter table public.flights
  add column if not exists aircraft_registration text;

comment on column public.flights.aircraft_registration is
  'Aircraft tail registration when known (e.g. TC-JFK).';
