-- family_connections: links crew and family (approval required)
-- Idempotent: safe to run when table already exists
create table if not exists public.family_connections (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew_profiles(id) on delete cascade,
  family_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'approved', 'declined')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (crew_id, family_id)
);

drop trigger if exists family_connections_updated_at on public.family_connections;
create trigger family_connections_updated_at
  before update on public.family_connections
  for each row execute function public.handle_updated_at();

create index if not exists idx_family_connections_crew on public.family_connections(crew_id);
create index if not exists idx_family_connections_family on public.family_connections(family_id);
create index if not exists idx_family_connections_approved on public.family_connections(status) where status = 'approved';

comment on table public.family_connections is 'Crew-family links; family must be approved by crew';
