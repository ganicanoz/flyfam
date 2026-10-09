-- Phase refresh: stale (past block end + 4h, not airborne, not landed) flights are computed straight to
-- passive_past. Before, compute_flight_api_phase_state() set them active and close_stale_past_flight_phases()
-- set them back in the same run, writing two flight_ops_log phase_change rows per flight every 2 minutes.
-- Final state per run is unchanged; close_stale_past_flight_phases() still handles rows outside the window.

create or replace function public.refresh_flights_api_refresh_phase()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  m int;
begin
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

    -- Stale rule is the same predicate as close_stale_past_flight_phases(); applying it here keeps
    -- past, never-landed flights at passive_past instead of flipping to active and back every run.
    with computed as (
      select
        x.id,
        case when stale.is_stale then 'passive_past' else ps.o_phase end as o_phase,
        case when stale.is_stale then false else ps.o_locked end as o_locked
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
      cross join lateral (
        select
          not (
            coalesce(x.flight_status, '') in ('taxi_out', 'departed', 'en_route')
            or coalesce(x.internal_status, '') in ('taxi_out', 'departed', 'en_route')
          )
          and not (
            coalesce(x.flight_status, '') in ('landed', 'arrived', 'cancelled', 'diverted')
            or x.actual_arrival is not null
            or x.fr24_datetime_landed_utc is not null
          )
          and now() > (
            coalesce(x.scheduled_arrival, x.scheduled_departure + interval '4 hours')
            + interval '4 hours'
          ) as is_stale
      ) as stale
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

    n := n + public.close_stale_past_flight_phases();

    insert into public.system_health_pings as p (
      name,
      last_run_at,
      last_success_at,
      last_error,
      last_rows_updated,
      updated_at
    ) values (
      'phase_refresh',
      now(),
      now(),
      null,
      n,
      now()
    )
    on conflict (name) do update
      set
        last_run_at = excluded.last_run_at,
        last_success_at = excluded.last_success_at,
        last_error = null,
        last_rows_updated = excluded.last_rows_updated,
        updated_at = excluded.updated_at;

    return n;
  exception when others then
    insert into public.system_health_pings as p (
      name,
      last_run_at,
      last_error,
      updated_at
    ) values (
      'phase_refresh',
      now(),
      left(sqlerrm, 500),
      now()
    )
    on conflict (name) do update
      set
        last_run_at = excluded.last_run_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at;
    raise;
  end;
end;
$function$;
