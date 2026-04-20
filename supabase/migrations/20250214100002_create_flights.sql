-- flights: roster entries (manual in MVP)
-- Idempotent: safe to run when table already exists
create table if not exists public.flights (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew_profiles(id) on delete cascade,
  flight_number text not null,
  origin_airport text,
  destination_airport text,
  flight_date date not null,
  scheduled_departure timestamptz,
  scheduled_arrival timestamptz,
  source text default 'manual' not null check (source in ('manual', 'synced')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

drop trigger if exists flights_updated_at on public.flights;
create trigger flights_updated_at
  before update on public.flights
  for each row execute function public.handle_updated_at();

create index if not exists idx_flights_crew_date on public.flights(crew_id, flight_date);
create index if not exists idx_flights_date_number on public.flights(flight_date, flight_number);

comment on table public.flights is 'Roster entries; MVP uses manual entry only';
