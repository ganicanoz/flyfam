-- notification_preferences: per family user, per connection
-- Idempotent: safe to run when table already exists
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connection_id uuid not null references public.family_connections(id) on delete cascade,
  today_flights boolean default true not null,
  took_off boolean default true not null,
  landed boolean default true not null,
  delayed boolean default true not null,
  diverted boolean default true not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (user_id, connection_id)
);

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.handle_updated_at();

comment on table public.notification_preferences is 'Push notification preferences per family-connection';
