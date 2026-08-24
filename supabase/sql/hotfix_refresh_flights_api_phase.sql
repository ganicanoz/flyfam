-- Hotfix template for phase refresh failures.
-- Purpose: quickly restore phase refresh execution if a migration breaks SQL function logic.
-- After applying, run:
--   npm run phase:smoke
--   npm run phase:health

begin;

-- 1) Ensure terminal phase is only set with landed signal.
create or replace function public.compute_flight_api_phase_state(
  p_now_utc timestamptz,
  p_sched_dep_utc timestamptz,
  p_sched_arr_utc timestamptz,
  p_est_dep_utc timestamptz,
  p_est_arr_utc timestamptz,
  p_actual_off_utc timestamptz,
  p_actual_on_utc timestamptz,
  p_status_text text,
  p_is_cancelled boolean,
  p_is_diverted boolean,
  p_airborne_signal boolean,
  p_landed_signal boolean
)
returns text
language plpgsql
as $$
declare
  v_dep timestamptz := coalesce(p_est_dep_utc, p_sched_dep_utc);
  v_arr timestamptz := coalesce(p_est_arr_utc, p_sched_arr_utc);
begin
  if coalesce(p_is_cancelled, false) or coalesce(p_is_diverted, false) then
    return 'passive_past';
  end if;

  if coalesce(p_landed_signal, false) or p_actual_on_utc is not null then
    return 'passive_past';
  end if;

  if coalesce(p_airborne_signal, false) or p_actual_off_utc is not null then
    return 'active';
  end if;

  if v_dep is not null and p_now_utc >= v_dep - interval '30 minutes' then
    return 'active';
  end if;

  if v_dep is not null and p_now_utc >= v_dep - interval '6 hours' then
    return 'semi_active';
  end if;

  return 'passive_future';
end;
$$;

-- 2) Safe refresh function skeleton with CTE-based update (avoids bad alias reference patterns).
-- NOTE: Keep your project-specific filters/columns in sync with latest migration.
-- If this is already correct in DB, skip replacing this function.
-- create or replace function public.refresh_flights_api_refresh_phase(...)
-- returns table(updated_count integer)
-- language plpgsql
-- as $$ ... $$;

commit;
