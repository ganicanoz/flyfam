-- Roster import (PDF/JSON): gönderilen plan ve havalimanları doluysa mevcut satırın üzerine yaz.
-- Önceki davranış coalesce(f, p) — yanlış önceki import veya API ile doldurulmuş alanlar düzelmezdi.

create or replace function public.add_me_to_flight(
  p_flight_number text,
  p_flight_date date,
  p_origin_airport text default null,
  p_destination_airport text default null,
  p_scheduled_departure timestamptz default null,
  p_scheduled_arrival timestamptz default null,
  p_roster_entry_kind text default 'flight',
  p_duty_rest_end timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_flight_id uuid;
  v_kind text;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    return null;
  end if;

  v_kind := coalesce(nullif(btrim(p_roster_entry_kind), ''), 'flight');
  if v_kind not in ('flight', 'duty_off', 'sim') then
    v_kind := 'flight';
  end if;

  select id into v_flight_id from public.flights
  where flight_number = p_flight_number and flight_date = p_flight_date
  limit 1;

  if v_flight_id is not null then
    insert into public.flight_crew (flight_id, crew_id) values (v_flight_id, v_crew_id)
    on conflict (flight_id, crew_id) do nothing;
    update public.flights f set
      scheduled_departure = case
        when p_scheduled_departure is not null then p_scheduled_departure
        else f.scheduled_departure
      end,
      scheduled_arrival = case
        when p_scheduled_arrival is not null then p_scheduled_arrival
        else f.scheduled_arrival
      end,
      origin_airport = case
        when p_origin_airport is not null and btrim(p_origin_airport) <> '' then btrim(p_origin_airport)
        else f.origin_airport
      end,
      destination_airport = case
        when p_destination_airport is not null and btrim(p_destination_airport) <> '' then btrim(p_destination_airport)
        else f.destination_airport
      end,
      roster_entry_kind = case
        when v_kind in ('duty_off', 'sim') then v_kind
        else coalesce(f.roster_entry_kind, 'flight')
      end,
      duty_rest_end = case
        when p_duty_rest_end is not null then p_duty_rest_end
        else f.duty_rest_end
      end
    where f.id = v_flight_id
      and (
        p_scheduled_departure is not null
        or p_scheduled_arrival is not null
        or (p_origin_airport is not null and btrim(p_origin_airport) <> '')
        or (p_destination_airport is not null and btrim(p_destination_airport) <> '')
        or v_kind in ('duty_off', 'sim')
        or p_duty_rest_end is not null
      );
    return v_flight_id;
  end if;

  insert into public.flights (
    crew_id, flight_number, origin_airport, destination_airport, flight_date,
    scheduled_departure, scheduled_arrival, source, roster_entry_kind, duty_rest_end
  ) values (
    v_crew_id, p_flight_number, p_origin_airport, p_destination_airport, p_flight_date,
    p_scheduled_departure, p_scheduled_arrival, 'manual', v_kind, p_duty_rest_end
  )
  returning id into v_flight_id;
  insert into public.flight_crew (flight_id, crew_id) values (v_flight_id, v_crew_id)
  on conflict (flight_id, crew_id) do nothing;
  return v_flight_id;
end;
$$;

comment on function public.add_me_to_flight(text, date, text, text, timestamptz, timestamptz, text, timestamptz) is
  'Find flight by number+date or create; add crew. Non-null p_* schedule/airports/rest overwrite existing row (roster import).';
