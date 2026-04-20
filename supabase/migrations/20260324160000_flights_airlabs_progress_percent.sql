-- Roster bar fallback: AirLabs /flight `percent` (0–100) when FR estimated window + scheduled pair unavailable.

alter table public.flights
  add column if not exists airlabs_progress_percent smallint;

comment on column public.flights.airlabs_progress_percent is
  'AirLabs /flight percent (0–100) for roster progress bar when FR estimated dep–arr and scheduled dep–arr are missing.';
