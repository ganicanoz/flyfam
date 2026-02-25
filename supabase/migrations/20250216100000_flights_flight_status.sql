-- Store live flight status from API (e.g. Aviation Edge timetable): scheduled, en_route, landed, cancelled, diverted, incident, redirected
--
-- Run this in Supabase: Dashboard → SQL Editor → New query → paste and run.
-- Or with CLI: supabase db push (or supabase migration up)
--
alter table public.flights
  add column if not exists flight_status text;

comment on column public.flights.flight_status is 'Live status from API when available; otherwise app derives from scheduled times.';
