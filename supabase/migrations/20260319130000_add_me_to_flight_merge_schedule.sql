-- PDF / tekrar içe aktarma: uçuş satırı zaten varsa, boş kalan plan saatleri (ve istasyon) doldurulur.
create or replace function public.add_me_to_flight(
  p_flight_number text,
  p_flight_date date,
  p_origin_airport text default null,
  p_destination_airport text default null,
  p_scheduled_departure timestamptz default null,
  p_scheduled_arrival timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_flight_id uuid;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    return null;
  end if;
  select id into v_flight_id from public.flights
  where flight_number = p_flight_number and flight_date = p_flight_date
  limit 1;
  if v_flight_id is not null then
    insert into public.flight_crew (flight_id, crew_id) values (v_flight_id, v_crew_id)
    on conflict (flight_id, crew_id) do nothing;
    update public.flights f set
      scheduled_departure = coalesce(f.scheduled_departure, p_scheduled_departure),
      scheduled_arrival = coalesce(f.scheduled_arrival, p_scheduled_arrival),
      origin_airport = case
        when (f.origin_airport is null or btrim(f.origin_airport) = '')
          and p_origin_airport is not null and btrim(p_origin_airport) <> ''
        then btrim(p_origin_airport)
        else f.origin_airport
      end,
      destination_airport = case
        when (f.destination_airport is null or btrim(f.destination_airport) = '')
          and p_destination_airport is not null and btrim(p_destination_airport) <> ''
        then btrim(p_destination_airport)
        else f.destination_airport
      end
    where f.id = v_flight_id
      and (
        p_scheduled_departure is not null
        or p_scheduled_arrival is not null
        or (p_origin_airport is not null and btrim(p_origin_airport) <> '')
        or (p_destination_airport is not null and btrim(p_destination_airport) <> '')
      );
    return v_flight_id;
  end if;
  insert into public.flights (
    crew_id, flight_number, origin_airport, destination_airport, flight_date,
    scheduled_departure, scheduled_arrival, source
  ) values (
    v_crew_id, p_flight_number, p_origin_airport, p_destination_airport, p_flight_date,
    p_scheduled_departure, p_scheduled_arrival, 'manual'
  )
  returning id into v_flight_id;
  insert into public.flight_crew (flight_id, crew_id) values (v_flight_id, v_crew_id)
  on conflict (flight_id, crew_id) do nothing;
  return v_flight_id;
end;
$$;
comment on function public.add_me_to_flight(text, date, text, text, timestamptz, timestamptz) is 'Find flight by number+date or create; add crew to flight_crew. Fills missing schedule/airports when row already exists.';
