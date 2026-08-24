-- Linter 0013_rls_disabled_in_public: enable RLS on operator-only health pings.
-- Grants remain service_role-only (see 20260421130000_phase_refresh_health_ping.sql).
-- With RLS on and no policies for anon/authenticated, PostgREST clients using those roles
-- cannot read/write. service_role continues to bypass RLS (Supabase default).
alter table public.system_health_pings enable row level security;
