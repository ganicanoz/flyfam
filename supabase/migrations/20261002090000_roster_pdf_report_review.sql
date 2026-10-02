-- Admin roster PDF incelemesi: rapor inceleme alanları + service role için ekip adına uçuş ekleme/çıkarma.
-- `admin_*` gövdeleri `add_me_to_flight` (20260518120000) ve `remove_me_from_flight` (20260927180000)
-- ile aynıdır; tek fark ekip kimliğinin `auth.uid()` yerine parametreden gelmesidir. Yalnız service role.

alter table public.roster_pdf_reports
  add column if not exists admin_note text check (admin_note is null or char_length(admin_note) <= 2000),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text check (reviewed_by is null or char_length(reviewed_by) <= 120),
  add column if not exists last_action jsonb;

alter table public.roster_pdf_reports drop constraint if exists roster_pdf_reports_status_check;
alter table public.roster_pdf_reports
  add constraint roster_pdf_reports_status_check check (status in ('new', 'reviewed', 'fixed', 'dismissed'));

create or replace function public.admin_add_crew_to_flight(
  p_crew_id uuid,
  p_flight_number text,
  p_flight_date date,
  p_origin_airport text default null,
  p_destination_airport text default null,
  p_scheduled_departure timestamptz default null,
  p_scheduled_arrival timestamptz default null,
  p_roster_entry_kind text default 'flight',
  p_duty_rest_end timestamptz default null,
  p_roster_detail text default null
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
  select id into v_crew_id from public.crew_profiles where id = p_crew_id;
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
      crew_id = v_crew_id,
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
      end,
      roster_detail = case
        when p_roster_detail is not null and btrim(p_roster_detail) <> '' then btrim(p_roster_detail)
        else f.roster_detail
      end
    where f.id = v_flight_id
      and (
        p_scheduled_departure is not null
        or p_scheduled_arrival is not null
        or (p_origin_airport is not null and btrim(p_origin_airport) <> '')
        or (p_destination_airport is not null and btrim(p_destination_airport) <> '')
        or v_kind in ('duty_off', 'sim')
        or p_duty_rest_end is not null
        or (p_roster_detail is not null and btrim(p_roster_detail) <> '')
      );
    return v_flight_id;
  end if;

  insert into public.flights (
    crew_id, flight_number, origin_airport, destination_airport, flight_date,
    scheduled_departure, scheduled_arrival, source, roster_entry_kind, duty_rest_end, roster_detail
  ) values (
    v_crew_id, p_flight_number, p_origin_airport, p_destination_airport, p_flight_date,
    p_scheduled_departure, p_scheduled_arrival, 'manual', v_kind, p_duty_rest_end,
    case when p_roster_detail is not null and btrim(p_roster_detail) <> '' then btrim(p_roster_detail) else null end
  )
  returning id into v_flight_id;
  insert into public.flight_crew (flight_id, crew_id) values (v_flight_id, v_crew_id)
  on conflict (flight_id, crew_id) do nothing;
  return v_flight_id;
end;
$$;

create or replace function public.admin_remove_crew_from_flight(p_crew_id uuid, p_flight_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
begin
  select id into v_crew_id from public.crew_profiles where id = p_crew_id;
  if v_crew_id is null then
    return;
  end if;

  delete from public.flight_crew where flight_id = p_flight_id and crew_id = v_crew_id;
  if not exists (select 1 from public.flight_crew where flight_id = p_flight_id) then
    delete from public.flights where id = p_flight_id;
  end if;

  update public.flights_archive a
  set
    crew_ids = array_remove(coalesce(a.crew_ids, '{}'::uuid[]), v_crew_id),
    crew_id = case
      when a.crew_id = v_crew_id then (array_remove(coalesce(a.crew_ids, '{}'::uuid[]), v_crew_id))[1]
      else a.crew_id
    end
  where a.original_flight_id = p_flight_id
    and (a.crew_id = v_crew_id or v_crew_id = any(coalesce(a.crew_ids, '{}'::uuid[])));

  delete from public.flights_archive a
  where a.original_flight_id = p_flight_id
    and a.crew_id is null
    and coalesce(cardinality(a.crew_ids), 0) = 0;
end;
$$;

revoke all on function public.admin_add_crew_to_flight(uuid, text, date, text, text, timestamptz, timestamptz, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.admin_remove_crew_from_flight(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_add_crew_to_flight(uuid, text, date, text, text, timestamptz, timestamptz, text, timestamptz, text) to service_role;
grant execute on function public.admin_remove_crew_from_flight(uuid, uuid) to service_role;
