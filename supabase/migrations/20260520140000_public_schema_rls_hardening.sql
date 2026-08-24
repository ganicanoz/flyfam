-- Supabase linter 0013 (rls_disabled_in_public) + defense-in-depth:
-- 1) Ensure RLS is ON for every public heap table.
-- 2) Revoke PostgREST client roles (anon/authenticated) from operator-only tables.
--    Edge Functions / cron use service_role (bypasses RLS).

-- ---------------------------------------------------------------------------
-- 1) Enable RLS on all public tables (idempotent)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
    raise notice 'Enabled RLS on public.%', r.table_name;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Operator / internal tables: service_role only (no anon/authenticated API)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'system_health_pings',
    'provider_response_cache',
    'flight_provider_cooldown',
    'flights_archive',
    'fr24_usage_metric_snapshots',
    'fr24_usage_metric_points'
  ];
begin
  foreach t in array tables loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

comment on table public.system_health_pings is
  'Operator health pings. RLS on, no client policies; API access revoked for anon/authenticated.';

comment on table public.provider_response_cache is
  'Edge flight-lookup cache. service_role only.';

comment on table public.flight_provider_cooldown is
  'API 429 backoff state. service_role only.';

comment on table public.flights_archive is
  'Archived flights retention store. service_role only.';

-- Drop overly broad FR24 read policies (admin Edge uses service_role).
drop policy if exists "fr24 usage snapshots readable by authenticated" on public.fr24_usage_metric_snapshots;
drop policy if exists "fr24 usage points readable by authenticated" on public.fr24_usage_metric_points;

-- ---------------------------------------------------------------------------
-- 3) Future tables: auto-enable RLS when created in public (optional safety net)
-- ---------------------------------------------------------------------------
create or replace function public.tg_enable_rls_on_new_public_table()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  obj record;
begin
  for obj in
    select c.oid::regclass as tbl
    from pg_event_trigger_ddl_commands() ev
    join pg_class c on c.oid = ev.objid
    join pg_namespace n on n.oid = c.relnamespace
    where ev.command_tag in ('CREATE TABLE', 'CREATE TABLE AS')
      and n.nspname = 'public'
      and c.relkind = 'r'
  loop
    execute format('alter table %s enable row level security', obj.tbl);
  end loop;
end;
$$;

drop event trigger if exists enable_rls_on_new_public_table;
create event trigger enable_rls_on_new_public_table
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS')
  execute function public.tg_enable_rls_on_new_public_table();
