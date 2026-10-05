-- Mobil istemci JS hata kayıtları (ErrorBoundary + global hata yakalayıcı).
-- Kullanıcı yalnız kendi adına ekleyebilir; okuma yalnız service role (admin / SQL).
-- Hesap silinince kayıtlar cascade ile silinir.

create table if not exists public.client_error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  source text not null check (source in ('boundary', 'global', 'promise')),
  is_fatal boolean not null default false,
  error_name text check (error_name is null or char_length(error_name) <= 120),
  message text not null check (char_length(message) <= 1000),
  stack text check (stack is null or char_length(stack) <= 8000),
  component_stack text check (component_stack is null or char_length(component_stack) <= 4000),
  screen text check (screen is null or char_length(screen) <= 80),
  platform text check (platform is null or char_length(platform) <= 16),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  app_build text check (app_build is null or char_length(app_build) <= 40),
  ota_update_id text check (ota_update_id is null or char_length(ota_update_id) <= 64)
);

create index if not exists client_error_events_occurred_idx
  on public.client_error_events (occurred_at desc);
create index if not exists client_error_events_user_idx
  on public.client_error_events (user_id, occurred_at desc);

comment on table public.client_error_events is
  'Append-only mobile JS error reports. Clients insert own rows only; admin reads via service_role.';

alter table public.client_error_events enable row level security;
revoke all on public.client_error_events from anon, authenticated;

drop policy if exists "Users can insert own client errors" on public.client_error_events;
create policy "Users can insert own client errors"
  on public.client_error_events for insert
  to authenticated
  with check (auth.uid() = user_id);

grant insert on public.client_error_events to authenticated;
grant select, insert, update, delete on public.client_error_events to service_role;
