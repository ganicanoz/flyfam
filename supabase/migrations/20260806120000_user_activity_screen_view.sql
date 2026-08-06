-- Allow screen_view + admin_push activity events for engagement analytics.
alter table public.user_activity_events
  drop constraint if exists user_activity_events_event_type_check;

alter table public.user_activity_events
  add constraint user_activity_events_event_type_check
  check (event_type in (
    'app_open',
    'roster_import',
    'family_push',
    'screen_view',
    'admin_push'
  ));
