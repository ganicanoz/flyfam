-- First-party product activity for admin engagement metrics.
create table if not exists public.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null
    check (event_type in ('app_open', 'roster_import', 'family_push')),
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_user_activity_events_user_time
  on public.user_activity_events (user_id, occurred_at desc);

create index if not exists idx_user_activity_events_type_time
  on public.user_activity_events (event_type, occurred_at desc);

comment on table public.user_activity_events is
  'Append-only product events: app opens, roster imports, family push sends. Admin reads via service_role.';

alter table public.user_activity_events enable row level security;

drop policy if exists "Users can insert own activity events" on public.user_activity_events;
create policy "Users can insert own activity events"
  on public.user_activity_events for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own activity events" on public.user_activity_events;
create policy "Users can read own activity events"
  on public.user_activity_events for select
  to authenticated
  using (auth.uid() = user_id);

grant select, insert on public.user_activity_events to authenticated;
grant select, insert, update, delete on public.user_activity_events to service_role;
