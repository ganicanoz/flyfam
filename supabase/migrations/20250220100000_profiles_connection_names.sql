-- Allow reading profile (full_name) for connected users so Family page can show names.
-- Crew: can read profiles of family members they are connected to (family_id in their connections).
-- Family: can read profiles of crew they are connected to (crew's user_id via crew_profiles).
-- Idempotent: drop then create so re-run is safe.

drop policy if exists "Crew can read connected family profiles" on public.profiles;
create policy "Crew can read connected family profiles"
  on public.profiles for select
  using (
    id in (
      select fc.family_id
      from public.family_connections fc
      where fc.crew_id in (select id from public.crew_profiles where user_id = auth.uid())
    )
  );

drop policy if exists "Family can read connected crew profiles" on public.profiles;
create policy "Family can read connected crew profiles"
  on public.profiles for select
  using (
    id in (
      select cp.user_id
      from public.crew_profiles cp
      join public.family_connections fc on fc.crew_id = cp.id
      where fc.family_id = auth.uid() and fc.status = 'approved'
    )
  );
