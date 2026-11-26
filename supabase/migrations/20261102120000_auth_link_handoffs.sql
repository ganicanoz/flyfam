-- One-time, short-lived auth deep-link handoffs.
-- Web HTTPS callback stores secrets server-side; custom-scheme opens only with handoff id.

create table if not exists public.auth_link_handoffs (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null
);

create index if not exists auth_link_handoffs_expires_at_idx
  on public.auth_link_handoffs (expires_at);

alter table public.auth_link_handoffs enable row level security;

-- No direct client access; edge function uses service_role only.
revoke all on table public.auth_link_handoffs from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_link_handoffs to service_role;

comment on table public.auth_link_handoffs is
  'Short-lived one-time auth secrets for custom-scheme deep links; never expose via RLS.';
