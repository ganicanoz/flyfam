-- Fix: refresh_flights_api_refresh_phase() referenced target table alias `f`
-- inside FROM function call without LATERAL, which fails on Postgres with:
-- "invalid reference to FROM-clause entry for table f".

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

  update public.flights f
  set
    api_refresh_phase = ps.o_phase,
    phase_active_locked = ps.o_locked
  from lateral public.compute_flight_api_phase_state(
    f.scheduled_departure,
    coalesce(
      f.estimated_departure,
      f.scheduled_departure + make_interval(mins => coalesce(f.delay_dep_min, 0))
    ),
    f.scheduled_arrival,
    now(),
    coalesce(f.flight_status, '') = 'landed'
      or f.actual_arrival is not null
      or f.fr24_datetime_landed_utc is not null,
    coalesce(f.phase_active_locked, false),
    coalesce(f.flight_status, '') in ('taxi_out', 'departed', 'en_route')
      or coalesce(f.internal_status, '') in ('taxi_out', 'departed', 'en_route')
  ) as ps(o_phase, o_locked)
  where f.roster_entry_kind = 'flight'
    and f.scheduled_departure is not null
    and f.flight_date >= (current_date - interval '2 days')
    and f.flight_date <= (current_date + interval '30 days');

  get diagnostics m = row_count;
  n := n + m;
  return n;
end;
$$;
