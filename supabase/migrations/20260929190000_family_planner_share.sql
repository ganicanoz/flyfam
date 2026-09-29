-- Aile planı paylaşım sayfası: PIN (hash) ile giriş + kaba kuvvet sınırı.
alter table public.admin_planner_state
  add column if not exists share_pin_hash text;

comment on column public.admin_planner_state.share_pin_hash is
  'sha256(owner_user_id || '':'' || pin) hex. Boşsa PIN ile giriş kapalı. Yalnız service role.';

create table if not exists public.family_planner_pin_attempts (
  bucket text primary key,
  fail_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.family_planner_pin_attempts enable row level security;
revoke all on table public.family_planner_pin_attempts from anon, authenticated;

comment on table public.family_planner_pin_attempts is
  'family-planner PIN deneme sayaçları (IP hash + global). Yalnız service role.';
