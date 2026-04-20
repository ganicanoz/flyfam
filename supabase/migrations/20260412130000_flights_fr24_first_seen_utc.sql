-- FR24 first_seen — yer hareketi / gecikme (STD ile kıyas) için roster.
alter table public.flights
  add column if not exists fr24_first_seen_utc timestamptz;

comment on column public.flights.fr24_first_seen_utc is
  'FR24 flight-summary light: first_seen (UTC). UI: STD''den >15 dk sonra ise kalkış gecikmesi göstergesi.';
