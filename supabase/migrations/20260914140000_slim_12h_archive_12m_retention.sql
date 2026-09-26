-- Slim hard-archive 12h after block end; keep card-only payload for 12 months.
-- Poll stays off for passive_past / archived (live rows leave flights table).

alter table public.flights_archive
  add column if not exists crew_ids uuid[] not null default '{}';

create index if not exists idx_flights_archive_crew_ids_gin
  on public.flights_archive using gin (crew_ids);

comment on column public.flights_archive.crew_ids is
  'Crew profile ids that owned this flight when archived (for RLS + roster restore).';

-- Card-only JSON (matches mobile CREW_ROSTER_FLIGHT_SELECT_COLS).
create or replace function public.flight_card_snapshot(f public.flights)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'id', f.id,
      'flight_number', f.flight_number,
      'origin_airport', f.origin_airport,
      'destination_airport', f.destination_airport,
      'origin_city', f.origin_city,
      'destination_city', f.destination_city,
      'flight_date', f.flight_date,
      'scheduled_departure', f.scheduled_departure,
      'scheduled_arrival', f.scheduled_arrival,
      'actual_departure', f.actual_departure,
      'actual_arrival', f.actual_arrival,
      'delay_dep_min', f.delay_dep_min,
      'delay_arr_min', f.delay_arr_min,
      'is_delayed', f.is_delayed,
      'flight_status', f.flight_status,
      'internal_status', f.internal_status,
      'diverted_to', f.diverted_to,
      'api_refresh_phase', 'passive_past',
      'phase_active_locked', false,
      'estimated_departure', f.estimated_departure,
      'estimated_arrival', f.estimated_arrival,
      'roster_entry_kind', coalesce(f.roster_entry_kind, 'flight'),
      'duty_rest_end', f.duty_rest_end,
      'roster_detail', f.roster_detail,
      'aircraft_registration', f.aircraft_registration,
      'aircraft_type', f.aircraft_type,
      'fr24_progress_dep_utc', f.fr24_progress_dep_utc,
      'fr24_progress_eta_utc', f.fr24_progress_eta_utc,
      'fr24_datetime_takeoff_utc', f.fr24_datetime_takeoff_utc,
      'fr24_datetime_landed_utc', f.fr24_datetime_landed_utc,
      'fr24_first_seen_utc', f.fr24_first_seen_utc,
      'airlabs_progress_percent', f.airlabs_progress_percent,
      '_archived', true
    )
  );
$$;

comment on function public.flight_card_snapshot(public.flights) is
  'Minimal roster-card fields for flights_archive.flight_snapshot.';

create or replace function public.archive_and_cleanup_old_flights(
  p_cutoff interval default interval '12 hours'
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
    select
      f.*,
      coalesce(
        (
          select array_agg(distinct fc.crew_id)
          from public.flight_crew fc
          where fc.flight_id = f.id
        ),
        case when f.crew_id is not null then array[f.crew_id] else '{}'::uuid[] end
      ) as resolved_crew_ids,
      coalesce(
        f.actual_arrival,
        f.fr24_datetime_landed_utc,
        f.scheduled_arrival,
        f.duty_rest_end,
        f.scheduled_departure + interval '4 hours',
        (f.flight_date::timestamptz + interval '1 day')
      ) as block_end_utc
    from public.flights f
    where coalesce(f.roster_entry_kind, 'flight') in ('flight', 'duty_off', 'sim')
      and coalesce(
        f.actual_arrival,
        f.fr24_datetime_landed_utc,
        f.scheduled_arrival,
        f.duty_rest_end,
        f.scheduled_departure + interval '4 hours',
        (f.flight_date::timestamptz + interval '1 day')
      ) < (now() - p_cutoff)
      and (
        coalesce(f.roster_entry_kind, 'flight') in ('duty_off', 'sim')
        or coalesce(f.flight_status, '') in ('landed', 'cancelled', 'diverted', 'arrived')
        or f.api_refresh_phase in ('passive_past', 'passive_complete')
        or f.actual_arrival is not null
        or f.fr24_datetime_landed_utc is not null
      )
  ),
  archived as (
    insert into public.flights_archive (
      original_flight_id,
      crew_id,
      crew_ids,
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
      coalesce(c.crew_id, (c.resolved_crew_ids)[1]),
      coalesce(c.resolved_crew_ids, '{}'::uuid[]),
      c.flight_number,
      c.flight_date,
      c.scheduled_departure,
      c.scheduled_arrival,
      c.flight_status,
      'passive_past',
      'past_12h_slim_card',
      (select public.flight_card_snapshot(f) from public.flights f where f.id = c.id)
    from candidates c
    on conflict (original_flight_id) do update
      set
        archived_at = now(),
        crew_id = excluded.crew_id,
        crew_ids = excluded.crew_ids,
        flight_number = excluded.flight_number,
        flight_date = excluded.flight_date,
        scheduled_departure = excluded.scheduled_departure,
        scheduled_arrival = excluded.scheduled_arrival,
        flight_status = excluded.flight_status,
        api_refresh_phase = 'passive_past',
        archived_reason = excluded.archived_reason,
        flight_snapshot = excluded.flight_snapshot
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
  'Slim-archives ended roster rows after cutoff (default 12h), then deletes from live flights.';

create or replace function public.purge_old_flights_archive(
  p_retention interval default interval '12 months'
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
  'Hard-deletes archive rows older than retention (default 12 months).';

-- BEFORE DELETE: slim snapshot + crew_ids (flight_crew still present).
create or replace function public.tg_flights_ops_log_bd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_ids uuid[];
begin
  if coalesce(old.roster_entry_kind, 'flight') in ('flight', 'duty_off', 'sim') then
    if coalesce(old.roster_entry_kind, 'flight') = 'flight' then
      perform public.flight_ops_log_insert_from_flight('deleted', old, 'removed from live flights');
    end if;

    select coalesce(array_agg(distinct fc.crew_id), '{}'::uuid[])
      into v_crew_ids
    from public.flight_crew fc
    where fc.flight_id = old.id;

    if cardinality(v_crew_ids) = 0 and old.crew_id is not null then
      v_crew_ids := array[old.crew_id];
    end if;

    insert into public.flights_archive (
      original_flight_id,
      crew_id,
      crew_ids,
      flight_number,
      flight_date,
      scheduled_departure,
      scheduled_arrival,
      flight_status,
      api_refresh_phase,
      archived_reason,
      flight_snapshot
    ) values (
      old.id,
      coalesce(old.crew_id, v_crew_ids[1]),
      v_crew_ids,
      old.flight_number,
      old.flight_date,
      old.scheduled_departure,
      old.scheduled_arrival,
      old.flight_status,
      'passive_past',
      'live_delete',
      public.flight_card_snapshot(old)
    )
    on conflict (original_flight_id) do update
      set
        archived_at = now(),
        crew_id = excluded.crew_id,
        crew_ids = excluded.crew_ids,
        archived_reason = excluded.archived_reason,
        flight_status = excluded.flight_status,
        api_refresh_phase = 'passive_past',
        flight_snapshot = excluded.flight_snapshot;
  end if;
  return old;
end;
$$;

-- Crew + approved family/peer can read slim archive (roster history). Service role keeps full access.
drop policy if exists flights_archive_select_own on public.flights_archive;
create policy flights_archive_select_own
  on public.flights_archive
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.crew_profiles cp
      where cp.user_id = auth.uid()
        and (
          cp.id = flights_archive.crew_id
          or cp.id = any (flights_archive.crew_ids)
        )
    )
    or exists (
      select 1
      from public.family_connections fc
      where fc.family_id = auth.uid()
        and fc.status = 'approved'
        and (
          fc.crew_id = flights_archive.crew_id
          or fc.crew_id = any (flights_archive.crew_ids)
        )
        and public.crew_has_active_subscription(fc.crew_id)
    )
    or exists (
      select 1
      from public.crew_peer_links cpl
      where cpl.follower_user_id = auth.uid()
        and cpl.status = 'approved'
        and (
          cpl.peer_crew_id = flights_archive.crew_id
          or cpl.peer_crew_id = any (flights_archive.crew_ids)
        )
        and public.crew_has_active_subscription(cpl.peer_crew_id)
    )
  );

grant select on table public.flights_archive to authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skip reschedule';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'archive-cleanup-old-flights') then
    perform cron.unschedule('archive-cleanup-old-flights');
  end if;
  perform cron.schedule(
    'archive-cleanup-old-flights',
    '10 * * * *',
    $cron$select public.archive_and_cleanup_old_flights(interval '12 hours')$cron$
  );

  if exists (select 1 from cron.job where jobname = 'purge-old-flights-archive') then
    perform cron.unschedule('purge-old-flights-archive');
  end if;
  perform cron.schedule(
    'purge-old-flights-archive',
    '25 3 * * *',
    $cron$select public.purge_old_flights_archive(interval '12 months')$cron$
  );
exception
  when undefined_table then
    raise notice 'cron schema missing — skip';
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;

-- One-time apply with new defaults (safe to re-run).
select public.archive_and_cleanup_old_flights(interval '12 hours');
