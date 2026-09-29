-- Admin panel «Aile planı»: admin kullanıcısına ait plan ayarları (kişiler, sabit programlar, konumlar).
-- Kişisel veri içerir; yalnız admin-dashboard Edge Function (service role) okur/yazar.
-- RLS açık ve policy yok → anon/authenticated erişemez.

create table if not exists public.admin_planner_state (
  owner_user_id uuid primary key references auth.users (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.admin_planner_state enable row level security;

revoke all on table public.admin_planner_state from anon, authenticated;

comment on table public.admin_planner_state is
  'Admin aile planı ayarları (JSON). Yalnız service role; istemci erişimi yok.';
