-- Permanent fix: close stale past flights stuck outside refresh date window (e.g. active + locked),
-- then archive/delete after STA + 30h.

create or replace function public.close_stale_past_flight_phases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  m int;
begin
  -- Rows with no real schedule but old roster date: clear phase so they do not poll.
  update public.flights f
  set
    api_refresh_phase = null,
    phase_active_locked = false
  where f.roster_entry_kind = 'flight'
    and f.scheduled_departure is null
    and f.flight_date < (current_date - interval '2 days');

  get diagnostics m = row_count;
  n := n + m;

  -- Stale closure (same rule as compute_flight_api_phase_state): past block end + 4h, not airborne, not landed.
  update public.flights f
  set
    api_refresh_phase = 'passive_past',
    phase_active_locked = false
  where f.roster_entry_kind = 'flight'
    and f.scheduled_departure is not null
    and coalesce(f.api_refresh_phase, '') not in ('passive_past')
    and not (
      coalesce(f.flight_status, '') in ('taxi_out', 'departed', 'en_route')
      or coalesce(f.internal_status, '') in ('taxi_out', 'departed', 'en_route')
    )
    and not (
      coalesce(f.flight_status, '') in ('landed', 'arrived', 'cancelled', 'diverted')
      or f.actual_arrival is not null
      or f.fr24_datetime_landed_utc is not null
    )
    and now() > (
      coalesce(f.scheduled_arrival, f.scheduled_departure + interval '4 hours')
      + interval '4 hours'
    );

  get diagnostics m = row_count;
  n := n + m;
  return n;
end;
$$;

comment on function public.close_stale_past_flight_phases() is
  'Forces passive_past (or null phase) on roster flights outside the rolling refresh window; unlocks phase_active_locked.';

create or replace function public.refresh_flights_api_refresh_phase()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  m int;
begin
  update public.flights f
  set
    api_refresh_phase = null,
    phase_active_locked = false
  where f.flight_date >= (current_date - interval '2 days')
    and f.flight_date <= (current_date + interval '30 days')
    and (
      f.roster_entry_kind is distinct from 'flight'
      or f.scheduled_departure is null
    );

  get diagnostics m = row_count;
  n := n + m;

  with computed as (
    select
      x.id,
      ps.o_phase,
      ps.o_locked
    from public.flights x
    cross join lateral public.compute_flight_api_phase_state(
      x.scheduled_departure,
      coalesce(
        x.estimated_departure,
        x.scheduled_departure + make_interval(mins => coalesce(x.delay_dep_min, 0))
      ),
      x.scheduled_arrival,
      now(),
      coalesce(x.flight_status, '') in ('landed', 'arrived')
        or x.actual_arrival is not null
        or x.fr24_datetime_landed_utc is not null,
      coalesce(x.phase_active_locked, false),
      coalesce(x.flight_status, '') in ('taxi_out', 'departed', 'en_route')
        or coalesce(x.internal_status, '') in ('taxi_out', 'departed', 'en_route')
    ) as ps(o_phase, o_locked)
    where x.roster_entry_kind = 'flight'
      and x.scheduled_departure is not null
      and x.flight_date >= (current_date - interval '2 days')
      and x.flight_date <= (current_date + interval '30 days')
  )
  update public.flights f
  set
    api_refresh_phase = c.o_phase,
    phase_active_locked = c.o_locked
  from computed c
  where c.id = f.id;

  get diagnostics m = row_count;
  n := n + m;

  -- Outside -2d..+30d window: close stale active/semi/future rows (TK2642 class bugs).
  n := n + public.close_stale_past_flight_phases();

  return n;
end;
$$;

comment on function public.refresh_flights_api_refresh_phase() is
  'Rolling window phase refresh + close_stale_past_flight_phases for older flight_date rows.';

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
      and f.scheduled_departure is not null
      and coalesce(f.scheduled_arrival, f.scheduled_departure + interval '4 hours')
        < (now() - p_cutoff)
      and (
        coalesce(f.flight_status, '') in ('landed', 'cancelled', 'diverted')
        or f.api_refresh_phase = 'passive_past'
      )
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
      case
        when coalesce(c.flight_status, '') in ('landed', 'cancelled', 'diverted')
          then 'past_30h_terminal'
        else 'past_30h_passive_past'
      end,
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
  'Archives terminal or passive_past flights after STA+cutoff (default 30h), then deletes from flights.';

-- One-time backfill on deploy (safe to re-run).
select public.close_stale_past_flight_phases();
select public.archive_and_cleanup_old_flights(interval '30 hours');
