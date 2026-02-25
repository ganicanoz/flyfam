-- Helper: get current user's email (auth.users not directly readable in RLS)
create or replace function public.current_user_email()
returns text language sql security definer set search_path = public as $$
  select email from auth.users where id = auth.uid();
$$;

-- crew_invitations: crew sends invite by email; family accepts/declines in app
create table public.crew_invitations (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew_profiles(id) on delete cascade,
  family_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz default now() not null
);

create index idx_crew_invitations_family_email on public.crew_invitations(family_email);
create index idx_crew_invitations_crew on public.crew_invitations(crew_id);
create index idx_crew_invitations_pending on public.crew_invitations(family_email, status) where status = 'pending';

alter table public.crew_invitations enable row level security;

-- Crew can manage own invitations
create policy "Crew can manage own invitations"
  on public.crew_invitations for all
  using (crew_id in (select id from public.crew_profiles where user_id = auth.uid()))
  with check (crew_id in (select id from public.crew_profiles where user_id = auth.uid()));

-- Family can read invitations sent to their email (must match auth user)
create policy "Family can read invitations for own email"
  on public.crew_invitations for select
  using (
    status = 'pending'
    and lower(trim(family_email)) = lower(trim(public.current_user_email()))
  );

-- Family can update (accept/decline) invitations sent to their email
create policy "Family can respond to own invitations"
  on public.crew_invitations for update
  using (
    status = 'pending'
    and lower(trim(family_email)) = lower(trim(public.current_user_email()))
  );

comment on table public.crew_invitations is 'Crew invites family by email; family accepts/declines in app';
