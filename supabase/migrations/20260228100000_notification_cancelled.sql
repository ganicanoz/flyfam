-- Add cancelled to notification_preferences and allow 'cancelled' in notification_log type
alter table public.notification_preferences
  add column if not exists cancelled boolean default true not null;

alter table public.notification_log
  drop constraint if exists notification_log_type_check;

alter table public.notification_log
  add constraint notification_log_type_check
  check (type in ('today_flights', 'took_off', 'landed', 'delayed', 'diverted', 'cancelled'));

comment on column public.notification_preferences.cancelled is 'Send push when crew flight is cancelled';
