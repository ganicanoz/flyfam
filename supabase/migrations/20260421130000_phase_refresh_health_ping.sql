create table if not exists public.system_health_pings (
  name text primary key,
  last_run_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  last_rows_updated integer,
  updated_at timestamptz not null default now()
);

comment on table public.system_health_pings is
  'Lightweight health pings for background jobs/functions (e.g. phase refresh).';

comment on column public.system_health_pings.name is
  'Job key, e.g. phase_refresh.';

revoke all on table public.system_health_pings from public;
grant select, insert, update on table public.system_health_pings to service_role;
