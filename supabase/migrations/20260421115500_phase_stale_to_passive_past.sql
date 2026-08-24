-- Past-time guard: prevent stale rows from staying active/semi/future forever
-- when landed signal never arrives (provider gaps, missed polls, etc.).
-- Rule: if now > coalesce(STA, STD+4h) + 4h and not airborne/landed, force passive_past.

create or replace function public.compute_flight_api_phase_state(
  p_std timestamptz,
  p_etd timestamptz,
  p_arr timestamptz,
  p_now timestamptz,
  p_landed boolean,
  p_locked_in boolean,
  p_airborne boolean,
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

  if coalesce(p_airborne, false) then
    o_phase := 'active';
    o_locked := true;
    return;
  end if;

  v_end := coalesce(p_arr, p_std + interval '4 hours');

  -- stale closure (independent of lock): row is in the past, no landed signal, no airborne signal.
  if p_now > (v_end + interval '4 hours') then
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
  timestamptz, timestamptz, timestamptz, timestamptz, boolean, boolean, boolean
) is
  'api_refresh_phase: landed→past; airborne→active+lock; stale(now>coalesce(STA,STD+4h)+4h)→past; ETD−30m/STD−3h windows.';
