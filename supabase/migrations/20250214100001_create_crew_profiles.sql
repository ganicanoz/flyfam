-- crew_profiles: crew-specific settings
-- Idempotent: safe to run when table already exists
create table if not exists public.crew_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade unique,
  company_name text,
  time_preference text default 'local' not null check (time_preference in ('local', 'utc')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

drop trigger if exists crew_profiles_updated_at on public.crew_profiles;
create trigger crew_profiles_updated_at
  before update on public.crew_profiles
  for each row execute function public.handle_updated_at();

comment on table public.crew_profiles is 'Crew user settings (company, time display preference)';
