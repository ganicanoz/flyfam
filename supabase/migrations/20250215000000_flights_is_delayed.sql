-- Add delay status for roster display (green = on time, red = delayed)
alter table public.flights
  add column if not exists is_delayed boolean default false;

comment on column public.flights.is_delayed is 'When true, show flight number in red (delayed); otherwise green (on time).';
