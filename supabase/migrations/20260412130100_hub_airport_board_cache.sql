-- Sunucu tarafı hub tahta önbelleği (AeroDataBox). Edge: sync-hub-airport-boards + CRON_SECRET.
-- Zamanlayıcı: cron-job.org vb. ile örn. 6 saatte bir POST (veya pg_cron + http).

create table if not exists public.hub_airport_board_cache (
  id text primary key default 'singleton',
  version int not null default 2,
  anchor_day date not null,
  slot_key text not null,
  time_zone text not null default 'Europe/Istanbul',
  rows jsonb not null default '[]'::jsonb,
  row_count int not null default 0,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fetch_duration_ms int,
  last_error text
);

comment on table public.hub_airport_board_cache is
  'ADB hub departure/arrival boards merged snapshot; filled by Edge sync-hub-airport-boards (cron).';

alter table public.hub_airport_board_cache enable row level security;

drop policy if exists "Authenticated users can read hub_airport_board_cache" on public.hub_airport_board_cache;
create policy "Authenticated users can read hub_airport_board_cache"
  on public.hub_airport_board_cache
  for select
  to authenticated
  using (true);

-- Yazma: yalnız service role (Edge). authenticated için INSERT/UPDATE yok.

grant select on public.hub_airport_board_cache to authenticated;
