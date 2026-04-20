-- Transient 429 backoff for external flight APIs (Edge check-flight-status only; service role).
create table if not exists public.flight_provider_cooldown (
  provider text primary key,
  blocked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

comment on table public.flight_provider_cooldown is
  'Per-provider blocked_until after HTTP 429 from FR24/AirLabs; Edge upserts on throttle.';

alter table public.flight_provider_cooldown enable row level security;
