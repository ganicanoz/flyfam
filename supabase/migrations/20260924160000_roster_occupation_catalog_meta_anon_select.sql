-- Published occupation catalog is a public snapshot (apps hydrate before/without JWT).
-- GRANT already existed for anon; RLS had only an authenticated policy → anon saw 0 rows.
drop policy if exists roster_occupation_catalog_meta_select_anon on public.roster_occupation_catalog_meta;
create policy roster_occupation_catalog_meta_select_anon
  on public.roster_occupation_catalog_meta
  for select
  to anon
  using (true);
