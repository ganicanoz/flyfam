-- profiles: extends auth.users with app-specific data
-- Idempotent: safe to run when table already exists (e.g. existing DB)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('crew', 'family')),
  full_name text,
  phone text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- updated_at trigger
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

comment on table public.profiles is 'App profile extending Supabase auth.users';
