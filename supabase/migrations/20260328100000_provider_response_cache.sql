-- Short-TTL JSON cache for flight-lookup Edge (roster poll); service role only.
create table if not exists public.provider_response_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_provider_response_cache_expires on public.provider_response_cache (expires_at);

comment on table public.provider_response_cache is 'Edge flight-lookup: roster poll response cache (TTL via expires_at).';

alter table public.provider_response_cache enable row level security;
