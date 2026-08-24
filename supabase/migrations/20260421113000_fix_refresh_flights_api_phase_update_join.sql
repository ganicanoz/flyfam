-- Fix: refresh_flights_api_refresh_phase() should not reference UPDATE target alias
-- directly inside FROM/LATERAL call in a way that can trigger:
-- "invalid reference to FROM-clause entry for table \"f\""

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
  -- Non-flight / missing schedule rows: clear phase.
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

  -- Compute phase in a derived table, then update by id.
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
      coalesce(x.flight_status, '') = 'landed'
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
  return n;
end;
$$;
