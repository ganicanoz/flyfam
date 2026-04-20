-- Roster progress bar: FR24 departure anchor (0%) → estimated landing (100%); datetime_landed → full bar.

alter table public.flights
  add column if not exists fr24_progress_dep_utc timestamptz,
  add column if not exists fr24_progress_eta_utc timestamptz,
  add column if not exists fr24_datetime_landed_utc timestamptz;

comment on column public.flights.fr24_progress_dep_utc is
  'FR24 departure instant for roster progress bar (datetime_dep / takeoff / first_seen). Bar at 0 until this time.';
comment on column public.flights.fr24_progress_eta_utc is
  'FR24 estimated landing; bar targets full at this time while still airborne.';
comment on column public.flights.fr24_datetime_landed_utc is
  'FR24 datetime_landed; bar stays full when set.';
