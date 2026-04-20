-- Airports reference from FR24 Airports Light API.
-- FR24 storage rule: data must not be kept longer than 30 days; refresh or delete before that.
-- Use scripts/sync-fr24-airports to fetch and upsert.

create table if not exists public.airports (
  icao text not null,
  iata text,
  name text,
  city text,
  country_iso text,
  timezone_iana text,
  raw_light jsonb,
  fetched_at timestamptz not null default now(),
  primary key (icao)
);

comment on table public.airports is 'Airport reference from FR24 static/airports (light). Refresh within 30 days per FR24 terms.';
create index if not exists airports_iata on public.airports (iata) where iata is not null;
create index if not exists airports_country on public.airports (country_iso) where country_iso is not null;

-- Allow service role and anon to read (e.g. app can show airport names)
alter table public.airports enable row level security;

create policy "Airports are readable by everyone"
  on public.airports for select
  using (true);

-- No insert/update/delete policy for anon; sync script uses service role (bypasses RLS).
