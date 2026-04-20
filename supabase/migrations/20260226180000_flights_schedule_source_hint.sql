-- Distinguishes "Önceki günün verisi" (fr24_first_last_seen) from generic "güncellenecek" so family view shows the same label as crew.
alter table public.flights
  add column if not exists schedule_source_hint text;

comment on column public.flights.schedule_source_hint is 'e.g. fr24_first_last_seen when times are from FR24 first_seen/last_seen (previous leg); used for display only';
