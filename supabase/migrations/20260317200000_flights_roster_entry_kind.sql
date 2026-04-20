-- FSF/FOF (duty_off) ve ileride sim: takvimde gösterim; uçuş satırları roster_entry_kind = flight kalır.

alter table public.flights
  add column if not exists roster_entry_kind text default 'flight';

alter table public.flights
  add column if not exists duty_rest_end timestamptz;

update public.flights set roster_entry_kind = 'flight' where roster_entry_kind is null;

alter table public.flights alter column roster_entry_kind set not null;
alter table public.flights alter column roster_entry_kind set default 'flight';

alter table public.flights drop constraint if exists flights_roster_entry_kind_check;
alter table public.flights add constraint flights_roster_entry_kind_check
  check (roster_entry_kind in ('flight', 'duty_off', 'sim'));

comment on column public.flights.roster_entry_kind is 'flight: scheduled_* = kalkış/iniş. duty_off: PDF FSF/FOF görev penceresi. sim: ayrılmış.';
comment on column public.flights.duty_rest_end is 'duty_off: PDF ikinci slash çifti (dinlenme sonu), opsiyonel.';

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
      end,
      roster_entry_kind = case
        when v_kind in ('duty_off', 'sim') then v_kind
        else coalesce(f.roster_entry_kind, 'flight')
      end,
      duty_rest_end = coalesce(f.duty_rest_end, p_duty_rest_end)
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
comment on function public.add_me_to_flight(text, date, text, text, timestamptz, timestamptz, text, timestamptz) is 'Find flight by number+date or create; add crew to flight_crew. roster_entry_kind duty_off/sim için scheduled_* = PDF görev penceresi.';
