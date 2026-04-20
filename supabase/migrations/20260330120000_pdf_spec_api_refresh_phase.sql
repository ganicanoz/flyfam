-- Align api_refresh_phase with docs/flyfam_flight_status_detailed_spec.pdf:
-- - passive_future: now < STD - 3h
-- - semi_active: STD-3h <= now < ETD - 30m (ETD = coalesce(estimated_departure, STD + delay_dep_min))
-- - active: now >= ETD - 30m until landed or stale window; hysteresis via phase_active_locked
-- - passive_past: landed signals OR (not locked and now > coalesce(STA, STD+4h) + 3h)

alter table public.flights
  add column if not exists phase_active_locked boolean not null default false;

comment on column public.flights.phase_active_locked is
  'Once ACTIVE (ETD-30m rule), stay ACTIVE until landed or stale closure; prevents ETD wobble dropping phase.';

-- Replace 4-arg compute_api_refresh_phase (superseded).
drop function if exists public.compute_api_refresh_phase(timestamptz, timestamptz, timestamptz, timestamptz);

create or replace function public.compute_flight_api_phase_state(
  p_std timestamptz,
  p_etd timestamptz,
  p_arr timestamptz,
  p_now timestamptz,
  p_landed boolean,
  p_locked_in boolean,
  out o_phase text,
  out o_locked boolean
)
language plpgsql
stable
as $$
declare
  v_end timestamptz;
begin
  o_locked := false;
  if p_std is null then
    o_phase := null;
    return;
  end if;

  if p_landed then
    o_phase := 'passive_past';
    return;
  end if;

  v_end := coalesce(p_arr, p_std + interval '4 hours');

  if not p_locked_in and p_now > (v_end + interval '3 hours') then
    o_phase := 'passive_past';
    return;
  end if;

  if p_locked_in then
    o_phase := 'active';
    o_locked := true;
    return;
  end if;

  if p_now < (p_std - interval '3 hours') then
    o_phase := 'passive_future';
    return;
  end if;

  if p_now < (p_etd - interval '30 minutes') then
    o_phase := 'semi_active';
    return;
  end if;

  o_phase := 'active';
  o_locked := true;
end;
$$;

comment on function public.compute_flight_api_phase_state(
  timestamptz, timestamptz, timestamptz, timestamptz, boolean, boolean
) is
  'PDF-aligned api_refresh_phase + phase_active_locked (ETD-30m active start, STD-3h passive_future, landed/stale past).';

create or replace function public.trg_flights_set_api_refresh_phase()
returns trigger
language plpgsql
as $$
declare
  v_std timestamptz;
  v_etd timestamptz;
  v_landed boolean;
  v_locked_in boolean;
begin
  if new.roster_entry_kind is distinct from 'flight' or new.scheduled_departure is null then
    new.api_refresh_phase := null;
    new.phase_active_locked := false;
    return new;
  end if;

  v_std := new.scheduled_departure;
  v_etd := coalesce(
    new.estimated_departure,
    new.scheduled_departure + make_interval(mins => coalesce(new.delay_dep_min, 0))
  );
  v_landed :=
    coalesce(new.flight_status, '') = 'landed'
    or new.actual_arrival is not null
    or new.fr24_datetime_landed_utc is not null;

  if tg_op = 'UPDATE' then
    v_locked_in := coalesce(old.phase_active_locked, false);
  else
    v_locked_in := false;
  end if;

  select ps.o_phase, ps.o_locked
    into new.api_refresh_phase, new.phase_active_locked
  from public.compute_flight_api_phase_state(
    v_std,
    v_etd,
    new.scheduled_arrival,
    now(),
    v_landed,
    v_locked_in
  ) as ps(o_phase, o_locked);

  return new;
end;
$$;

drop trigger if exists trg_flights_api_refresh_phase_bi on public.flights;
create trigger trg_flights_api_refresh_phase_bi
  before insert or update of
    scheduled_departure,
    scheduled_arrival,
    estimated_departure,
    delay_dep_min,
    actual_arrival,
    roster_entry_kind,
    flight_status,
    fr24_datetime_landed_utc
  on public.flights
  for each row
  execute function public.trg_flights_set_api_refresh_phase();

-- Mid-flight rows: preserve ACTIVE across migration (hysteresis seed).
update public.flights
set phase_active_locked = true
where api_refresh_phase = 'active'
  and roster_entry_kind = 'flight'
  and scheduled_departure is not null;

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
  from public.compute_flight_api_phase_state(
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
    coalesce(f.phase_active_locked, false)
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

comment on function public.refresh_flights_api_refresh_phase() is
  'Periodic refresh: PDF-aligned phase + phase_active_locked for roster flights in date window.';

revoke all on function public.compute_flight_api_phase_state(
  timestamptz, timestamptz, timestamptz, timestamptz, boolean, boolean
) from public;
grant execute on function public.compute_flight_api_phase_state(
  timestamptz, timestamptz, timestamptz, timestamptz, boolean, boolean
) to service_role;

revoke all on function public.refresh_flights_api_refresh_phase() from public;
grant execute on function public.refresh_flights_api_refresh_phase() to service_role;
