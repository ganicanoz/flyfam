-- One active mobile install per auth user (anti account-sharing).
-- Written only by Edge with service_role; clients never read/write directly.

create table if not exists public.user_active_devices (
  user_id uuid primary key references auth.users (id) on delete cascade,
  install_id text not null,
  updated_at timestamptz not null default now(),
  constraint user_active_devices_install_id_nonempty check (char_length(trim(install_id)) >= 8)
);

create index if not exists user_active_devices_install_id_idx
  on public.user_active_devices (install_id);

alter table public.user_active_devices enable row level security;

revoke all on table public.user_active_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.user_active_devices to service_role;

comment on table public.user_active_devices is
  'Latest mobile install_id allowed for a user; other sessions revoked on register.';
