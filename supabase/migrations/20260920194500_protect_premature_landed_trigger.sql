-- Guard live flights against wrong-day provider/client writes:
-- - Do not move STD/STA/flight_date onto a previous calendar day while the roster leg is still ahead.
-- - Do not accept landed / FR24 takeoff-landed stamps before STD (or >12h away from roster times).

create or replace function public.tg_flights_protect_premature_landed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_std timestamptz;
  v_sta timestamptz;
  v_new_std timestamptz;
  v_new_sta timestamptz;
begin
  if coalesce(new.roster_entry_kind, 'flight') <> 'flight' then
    return new;
  end if;

  v_std := old.scheduled_departure;
  v_sta := old.scheduled_arrival;
  v_new_std := new.scheduled_departure;
  v_new_sta := new.scheduled_arrival;

  -- Keep roster STD/STA/date stable when an update tries to pull them ~1 day earlier
  -- (classic wrong-day PC398 overwrite).
  if v_std is not null and v_new_std is not null
     and v_new_std < (v_std - interval '6 hours')
     and v_std > v_now then
    new.scheduled_departure := old.scheduled_departure;
    new.flight_date := old.flight_date;
  end if;

  if v_sta is not null and v_new_sta is not null
     and v_new_sta < (v_sta - interval '6 hours')
     and coalesce(new.scheduled_departure, v_std) > v_now then
    new.scheduled_arrival := old.scheduled_arrival;
  end if;

  -- Re-read after possible revert.
  v_std := new.scheduled_departure;
  v_sta := new.scheduled_arrival;

  -- Before STD: never land / never keep previous-day FR24 stamps.
  if v_std is not null and v_std > (v_now + interval '2 minutes') then
    if lower(coalesce(new.flight_status, '')) in ('landed', 'parked', 'arrived', 'en_route', 'departed', 'taxi_out') then
      new.flight_status := 'scheduled';
    end if;
    if lower(coalesce(new.internal_status, '')) in ('landed', 'parked', 'arrived', 'en_route', 'departed', 'taxi_out') then
      new.internal_status := 'scheduled';
    end if;
    if new.actual_arrival is not null and new.actual_arrival < (v_std - interval '90 minutes') then
      new.actual_arrival := null;
    end if;
    if new.actual_departure is not null and new.actual_departure < (v_std - interval '90 minutes') then
      new.actual_departure := null;
    end if;
    if new.fr24_datetime_takeoff_utc is not null
       and abs(extract(epoch from (new.fr24_datetime_takeoff_utc - v_std))) > 12 * 3600 then
      new.fr24_datetime_takeoff_utc := null;
      new.fr24_first_seen_utc := null;
      new.fr24_progress_dep_utc := null;
      new.fr24_progress_eta_utc := null;
    end if;
    if new.fr24_datetime_landed_utc is not null
       and (
         new.fr24_datetime_landed_utc < (v_std - interval '90 minutes')
         or (v_sta is not null and abs(extract(epoch from (new.fr24_datetime_landed_utc - v_sta))) > 18 * 3600)
       ) then
      new.fr24_datetime_landed_utc := null;
    end if;
    if new.last_seen_utc is not null
       and abs(extract(epoch from (new.last_seen_utc - v_std))) > 18 * 3600 then
      new.last_seen_utc := null;
    end if;
    -- Keep polling window open; do not freeze as passive_past before STD.
    if coalesce(new.api_refresh_phase, '') in ('passive_past', 'passive_complete') then
      new.api_refresh_phase := coalesce(old.api_refresh_phase, 'semi_active');
      if new.api_refresh_phase in ('passive_past', 'passive_complete') then
        new.api_refresh_phase := 'semi_active';
      end if;
      new.phase_active_locked := false;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tg_flights_protect_premature_landed on public.flights;
create trigger tg_flights_protect_premature_landed
  before update on public.flights
  for each row
  execute function public.tg_flights_protect_premature_landed();

comment on function public.tg_flights_protect_premature_landed() is
  'Blocks wrong-day STD/STA overwrite and premature landed/FR24 stamps before roster STD.';
