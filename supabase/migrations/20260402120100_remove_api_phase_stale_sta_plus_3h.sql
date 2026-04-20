-- Kaldırılan kural: coalesce(STA, STD+4h) + 3 saat → passive_past (kilit yokken).
-- Gecikmeli gerçek inişlerde planlı varışa göre uçak hâlâ havadayken yanlış passive_past oluşuyordu.
-- İstemci: mobile/lib/flightApiRefreshPhase.ts ile aynı mantık.
-- Pasif geçmiş: yalnızca iniş sinyali (p_landed) veya havada değilken mevcut ETD−30m / STD−3h / kilit dalları.

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
  'api_refresh_phase: landed→past; taxi_out/departed/en_route→active+lock; ETD−30m / STD−3h; STA+3h stale yok.';
