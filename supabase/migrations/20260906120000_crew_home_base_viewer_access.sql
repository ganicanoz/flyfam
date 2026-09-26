-- Family / peer viewers need home_base_iata for layover calc (skip overnight at home base).
-- Direct SELECT on crew_profiles was own-only; without this, family saw fake "SAW yatı".

create or replace function public.get_connected_crew_home_bases(p_crew_ids uuid[])
returns table (crew_id uuid, home_base_iata text)
language sql
security definer
set search_path = public
stable
as $$
  select cp.id as crew_id, nullif(trim(cp.home_base_iata), '') as home_base_iata
  from public.crew_profiles cp
  where cp.id = any (p_crew_ids)
    and (
      cp.user_id = auth.uid()
      or exists (
        select 1
        from public.family_connections fc
        where fc.crew_id = cp.id
          and fc.family_id = auth.uid()
          and fc.status = 'approved'
      )
      or exists (
        select 1
        from public.crew_peer_links cpl
        where cpl.peer_crew_id = cp.id
          and cpl.follower_user_id = auth.uid()
          and cpl.status = 'approved'
      )
    );
$$;

comment on function public.get_connected_crew_home_bases is
  'Home bases for crew ids the caller may view (own / approved family / approved peer).';

grant execute on function public.get_connected_crew_home_bases(uuid[]) to authenticated;

drop policy if exists "Family can read connected crew_profiles" on public.crew_profiles;
create policy "Family can read connected crew_profiles"
  on public.crew_profiles for select
  using (
    id in (
      select fc.crew_id
      from public.family_connections fc
      where fc.family_id = auth.uid()
        and fc.status = 'approved'
    )
  );

drop policy if exists "Peer can read linked crew_profiles" on public.crew_profiles;
create policy "Peer can read linked crew_profiles"
  on public.crew_profiles for select
  using (
    id in (
      select cpl.peer_crew_id
      from public.crew_peer_links cpl
      where cpl.follower_user_id = auth.uid()
        and cpl.status = 'approved'
    )
  );
