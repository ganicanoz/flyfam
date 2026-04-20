-- Adaptive polling: throttle external flight APIs per flight (check-flight-status-and-notify).
alter table public.flights
  add column if not exists last_poll_at timestamptz;

comment on column public.flights.last_poll_at is
  'Son harici uçuş API turu (AirLabs/FR24 vb.); adaptive polling aralığı için.';

create index if not exists idx_flights_last_poll_at
  on public.flights (last_poll_at)
  where last_poll_at is not null;
