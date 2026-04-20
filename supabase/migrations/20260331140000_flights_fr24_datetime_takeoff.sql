-- FR24 datetime_takeoff (kalkış anı); adaptive polling kalkış referansı için.
alter table public.flights
  add column if not exists fr24_datetime_takeoff_utc timestamptz;

comment on column public.flights.fr24_datetime_takeoff_utc is
  'FR24 flight-summary light: datetime_takeoff (UTC ISO). Adaptive polling depRef önceliği.';
