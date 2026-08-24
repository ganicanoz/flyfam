-- Demo roster: PC1 iptal, PC2 divert, PC3 gecikmeli planlı.
-- Supabase Dashboard → SQL Editor → yapıştır → Run.
--
-- v_user: auth.users / profiles id (ganicanoz@gmail.com)

do $$
declare
  v_user uuid := '58e63a65-999d-4bba-9885-e7df05ff5ef8'::uuid;
  v_crew uuid;
  d date := (timezone('utc', now()))::date;
  id1 uuid := gen_random_uuid();
  id2 uuid := gen_random_uuid();
  id3 uuid := gen_random_uuid();
begin
  select id into v_crew from public.crew_profiles where user_id = v_user limit 1;
  if v_crew is null then
    select id into v_crew from public.crew_profiles where id = v_user limit 1;
  end if;
  if v_crew is null then
    raise exception 'crew_profiles satırı yok: user_id=% (veya id) ile eşleşen kayıt bulunamadı', v_user;
  end if;

  delete from public.flight_crew fc
  using public.flights f
  where fc.flight_id = f.id
    and f.flight_number in ('PC1', 'PC2', 'PC3')
    and f.flight_date = d;

  delete from public.flights
  where flight_number in ('PC1', 'PC2', 'PC3') and flight_date = d;

  -- PC1: İstanbul SAW → Ankara ESB iptal
  insert into public.flights (
    id, crew_id, flight_number,
    origin_airport, destination_airport, origin_city, destination_city,
    flight_date,
    scheduled_departure, scheduled_arrival,
    flight_status, internal_status,
    is_delayed, delay_dep_min, delay_arr_min,
    diverted_to, source, roster_entry_kind
  ) values (
    id1, v_crew, 'PC1',
    'SAW', 'ESB', 'İstanbul', 'Ankara',
    d,
    (d::text || 'T08:00:00.000Z')::timestamptz,
    (d::text || 'T09:25:00.000Z')::timestamptz,
    'cancelled', 'cancelled',
    false, null, null,
    null, 'manual', 'flight'
  );

  -- PC2: Antalya → İzmir, divert EDremit / EDLI-tarzı: EZS
  insert into public.flights (
    id, crew_id, flight_number,
    origin_airport, destination_airport, origin_city, destination_city,
    flight_date,
    scheduled_departure, scheduled_arrival, estimated_departure, estimated_arrival,
    flight_status, internal_status,
    is_delayed, delay_dep_min, delay_arr_min,
    diverted_to, source, roster_entry_kind
  ) values (
    id2, v_crew, 'PC2',
    'AYT', 'ADB', 'Antalya', 'İzmir',
    d,
    (d::text || 'T10:30:00.000Z')::timestamptz,
    (d::text || 'T11:45:00.000Z')::timestamptz,
    (d::text || 'T10:35:00.000Z')::timestamptz,
    (d::text || 'T11:50:00.000Z')::timestamptz,
    'diverted', 'en_route',
    false, null, null,
    'EZS', 'manual', 'flight'
  );

  -- PC3: SAW → Köln, kalkış gecikmesi (+55 dk)
  insert into public.flights (
    id, crew_id, flight_number,
    origin_airport, destination_airport, origin_city, destination_city,
    flight_date,
    scheduled_departure, scheduled_arrival, estimated_departure, estimated_arrival,
    flight_status, internal_status,
    is_delayed, delay_dep_min, delay_arr_min,
    diverted_to, source, roster_entry_kind
  ) values (
    id3, v_crew, 'PC3',
    'SAW', 'CGN', 'İstanbul', 'Köln',
    d,
    (d::text || 'T12:00:00.000Z')::timestamptz,
    (d::text || 'T15:10:00.000Z')::timestamptz,
    (d::text || 'T12:55:00.000Z')::timestamptz,
    (d::text || 'T16:05:00.000Z')::timestamptz,
    'scheduled', 'scheduled',
    true, 55, 55,
    null, 'manual', 'flight'
  );

  insert into public.flight_crew (flight_id, crew_id) values
    (id1, v_crew),
    (id2, v_crew),
    (id3, v_crew)
  on conflict do nothing;
end $$;
