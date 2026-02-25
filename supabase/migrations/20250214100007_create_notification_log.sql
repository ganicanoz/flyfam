-- notification_log: tracks sent notifications (idempotency)
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  flight_id uuid not null references public.flights(id) on delete cascade,
  type text not null check (type in ('today_flights', 'took_off', 'landed', 'delayed', 'diverted')),
  sent_at timestamptz default now() not null
);

create index idx_notification_log_flight_type on public.notification_log(flight_id, type);
create index idx_notification_log_user on public.notification_log(user_id);

comment on table public.notification_log is 'Log of sent push notifications; used to avoid duplicates';
