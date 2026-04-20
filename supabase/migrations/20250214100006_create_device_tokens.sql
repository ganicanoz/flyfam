-- device_tokens: Expo/FCM push tokens for family devices
-- Idempotent: safe to run when table already exists
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text check (platform in ('ios', 'android')),
  created_at timestamptz default now() not null,
  last_used_at timestamptz,
  unique (user_id, token)
);

create index if not exists idx_device_tokens_user on public.device_tokens(user_id);

comment on table public.device_tokens is 'Push notification device tokens (Expo/FCM)';
