-- Archive + cleanup for stale past flights.
-- Rule: flights older than 30 hours after scheduled_arrival and terminal status
-- (landed/cancelled/diverted) are moved to archive, then deleted from flights.

create table if not exists public.flights_archive (
  original_flight_id uuid primary key,
  crew_id uuid,
  flight_number text,
  flight_date date,
  scheduled_departure timestamptz,
  scheduled_arrival timestamptz,
  flight_status text,
  api_refresh_phase text,
  archived_at timestamptz not null default now(),
  archived_reason text not null default 'past_30h_terminal',
  flight_snapshot jsonb not null
);

comment on table public.flights_archive is
  'Archived flights moved out of public.flights by retention jobs.';

create index if not exists idx_flights_archive_archived_at
  on public.flights_archive(archived_at desc);

create index if not exists idx_flights_archive_crew_date
  on public.flights_archive(crew_id, flight_date desc);

revoke all on table public.flights_archive from public;
grant select, insert, update, delete on table public.flights_archive to service_role;

alter table public.flights_archive enable row level security;

create or replace function public.archive_and_cleanup_old_flights(
  p_cutoff interval default interval '30 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with candidates as (
    select f.*
    from public.flights f
    where f.roster_entry_kind = 'flight'
      and f.scheduled_arrival is not null
      and f.scheduled_arrival < (now() - p_cutoff)
      and coalesce(f.flight_status, '') in ('landed', 'cancelled', 'diverted')
  ),
  archived as (
    insert into public.flights_archive (
      original_flight_id,
      crew_id,
      flight_number,
      flight_date,
      scheduled_departure,
      scheduled_arrival,
      flight_status,
      api_refresh_phase,
      archived_reason,
      flight_snapshot
    )
    select
      c.id,
      c.crew_id,
      c.flight_number,
      c.flight_date,
      c.scheduled_departure,
      c.scheduled_arrival,
      c.flight_status,
      c.api_refresh_phase,
      'past_30h_terminal',
      to_jsonb(c)
    from candidates c
    on conflict (original_flight_id) do nothing
    returning original_flight_id
  ),
  deleted as (
    delete from public.flights f
    using archived a
    where f.id = a.original_flight_id
    returning f.id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$;

comment on function public.archive_and_cleanup_old_flights(interval) is
  'Moves terminal flights older than cutoff (default 30h) to flights_archive, then deletes from flights.';

create or replace function public.purge_old_flights_archive(
  p_retention interval default interval '90 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  delete from public.flights_archive a
  where a.archived_at < (now() - p_retention);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.purge_old_flights_archive(interval) is
  'Deletes archive rows older than retention (default 90 days).';

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skip';
    return;
  end if;

  -- Archive + cleanup every hour (30h rule).
  if exists (select 1 from cron.job where jobname = 'archive-cleanup-old-flights') then
    perform cron.unschedule('archive-cleanup-old-flights');
  end if;
  perform cron.schedule(
    'archive-cleanup-old-flights',
    '5 * * * *',
    $cron$select public.archive_and_cleanup_old_flights(interval '30 hours')$cron$
  );

  -- Archive hard purge daily.
  if exists (select 1 from cron.job where jobname = 'purge-old-flights-archive') then
    perform cron.unschedule('purge-old-flights-archive');
  end if;
  perform cron.schedule(
    'purge-old-flights-archive',
    '20 3 * * *',
    $cron$select public.purge_old_flights_archive(interval '90 days')$cron$
  );
exception
  when undefined_table then
    raise notice 'cron schema missing — skip';
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;
