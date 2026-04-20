-- Store family user's IANA timezone (e.g. Europe/Istanbul) for local time in push notifications.
alter table public.profiles
  add column if not exists timezone_iana text;

comment on column public.profiles.timezone_iana is 'IANA timezone (e.g. Europe/Istanbul) for push notification local time';
