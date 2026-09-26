-- Fix: SELECT policies on crew_profiles that subquery family_connections /
-- crew_peer_links recurse with those tables' policies (which read crew_profiles).
-- Home bases for family/peer stay available via get_connected_crew_home_bases (SECURITY DEFINER).

drop policy if exists "Family can read connected crew_profiles" on public.crew_profiles;
drop policy if exists "Peer can read linked crew_profiles" on public.crew_profiles;
