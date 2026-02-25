-- Flag to indicate scheduled times are a fallback and not yet confirmed by timetable for the selected date.
alter table public.flights
  add column if not exists schedule_unconfirmed boolean not null default false;

comment on column public.flights.schedule_unconfirmed is 'True when scheduled times are taken from a previous-day fallback and must be re-confirmed';

