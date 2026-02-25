-- Actual (real) departure and arrival times from API when available.
-- Used for status: compare current time to actual times instead of scheduled when present.
alter table public.flights
  add column if not exists actual_departure timestamptz,
  add column if not exists actual_arrival timestamptz;

comment on column public.flights.actual_departure is 'Real/actual departure time from API (takeoff) when available';
comment on column public.flights.actual_arrival is 'Real/actual arrival time from API (landing) when available';
