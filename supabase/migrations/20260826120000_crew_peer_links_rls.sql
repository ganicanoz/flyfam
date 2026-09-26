-- Crew↔crew follow: peer can read linked crew's flight_crew + flights (select only).

create table if not exists public.crew_peer_links (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references auth.users (id) on delete cascade,
  peer_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now(),
  unique (follower_user_id, peer_crew_id)
);

create index if not exists idx_crew_peer_links_follower
  on public.crew_peer_links (follower_user_id);
create index if not exists idx_crew_peer_links_peer
  on public.crew_peer_links (peer_crew_id);

comment on table public.crew_peer_links is
  'Crew following another crew; approved rows grant read-only roster access.';

alter table public.crew_peer_links enable row level security;

drop policy if exists "Users read own crew peer links" on public.crew_peer_links;
create policy "Users read own crew peer links"
  on public.crew_peer_links for select
  using (follower_user_id = auth.uid());

drop policy if exists "Peer crew can read linked flight_crew" on public.flight_crew;
create policy "Peer crew can read linked flight_crew"
  on public.flight_crew for select
  using (
    crew_id in (
      select cpl.peer_crew_id
      from public.crew_peer_links cpl
      where cpl.follower_user_id = auth.uid()
        and cpl.status = 'approved'
    )
  );

drop policy if exists "Peer crew can read linked flights" on public.flights;
create policy "Peer crew can read linked flights"
  on public.flights for select
  using (
    exists (
      select 1
      from public.flight_crew fc
      join public.crew_peer_links cpl
        on cpl.peer_crew_id = fc.crew_id
      where fc.flight_id = flights.id
        and cpl.follower_user_id = auth.uid()
        and cpl.status = 'approved'
    )
  );
