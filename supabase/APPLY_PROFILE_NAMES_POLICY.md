# Family page: show connection names

If the Family page does not show names (shows "Family member" or "Crew" instead), the RLS policies that allow reading connected users’ profiles are missing.

**Fix:** In Supabase Dashboard → **SQL Editor**, create a new query and paste **only the SQL below** (do not paste the file path). Then click Run.

```sql
-- Allow reading profile (full_name) for connected users so Family page can show names.
create policy "Crew can read connected family profiles"
  on public.profiles for select
  using (
    id in (
      select fc.family_id from public.family_connections fc
      where fc.crew_id in (select id from public.crew_profiles where user_id = auth.uid())
    )
  );

create policy "Family can read connected crew profiles"
  on public.profiles for select
  using (
    id in (
      select cp.user_id from public.crew_profiles cp
      join public.family_connections fc on fc.crew_id = cp.id
      where fc.family_id = auth.uid() and fc.status = 'approved'
    )
  );
```

If you see "policy already exists", the policies are already applied.
