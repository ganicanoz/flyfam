-- Pre-slim purge wiped flights_archive history. Rebuild slim cards from flight_ops_log
-- so roster can show ~12 months of past cards again (client merges archive + live).
-- Only restore flights that were actually flown / live-tracked (or non-flight duties).

insert into public.flights_archive (
  original_flight_id,
  crew_id,
  crew_ids,
  flight_number,
  flight_date,
  scheduled_departure,
  scheduled_arrival,
  flight_status,
  api_refresh_phase,
  archived_reason,
  flight_snapshot,
  archived_at
)
select
  l.flight_id,
  l.crew_id,
  array[l.crew_id]::uuid[],
  coalesce(nullif(l.flight_number, ''), l.snapshot->>'flight_number', '?'),
  l.flight_date,
  coalesce(l.scheduled_departure, (l.snapshot->>'scheduled_departure')::timestamptz),
  coalesce(l.scheduled_arrival, (l.snapshot->>'scheduled_arrival')::timestamptz),
  coalesce(l.flight_status, l.snapshot->>'flight_status', 'landed'),
  'passive_past',
  'past_12h_slim_card',
  jsonb_strip_nulls(
    coalesce(l.snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'id', l.flight_id,
      'flight_number', coalesce(nullif(l.flight_number, ''), l.snapshot->>'flight_number'),
      'flight_date', l.flight_date,
      'origin_airport', coalesce(l.origin_airport, l.snapshot->>'origin_airport'),
      'destination_airport', coalesce(l.destination_airport, l.snapshot->>'destination_airport'),
      'scheduled_departure', coalesce(l.scheduled_departure, (l.snapshot->>'scheduled_departure')::timestamptz),
      'scheduled_arrival', coalesce(l.scheduled_arrival, (l.snapshot->>'scheduled_arrival')::timestamptz),
      'estimated_departure', coalesce(l.estimated_departure, (l.snapshot->>'estimated_departure')::timestamptz),
      'estimated_arrival', coalesce(l.estimated_arrival, (l.snapshot->>'estimated_arrival')::timestamptz),
      'actual_departure', coalesce(l.actual_departure, (l.snapshot->>'actual_departure')::timestamptz),
      'actual_arrival', coalesce(l.actual_arrival, (l.snapshot->>'actual_arrival')::timestamptz),
      'delay_dep_min', coalesce(l.delay_dep_min, (l.snapshot->>'delay_dep_min')::int),
      'delay_arr_min', coalesce(l.delay_arr_min, (l.snapshot->>'delay_arr_min')::int),
      'flight_status', coalesce(l.flight_status, l.snapshot->>'flight_status', 'landed'),
      'api_refresh_phase', 'passive_past',
      'phase_active_locked', false,
      'roster_entry_kind', coalesce(l.snapshot->>'roster_entry_kind', 'flight'),
      'aircraft_registration', coalesce(l.aircraft_registration, l.snapshot->>'aircraft_registration'),
      '_archived', true
    )
  ),
  coalesce(l.logged_at, now())
from (
  select distinct on (flight_id)
    flight_id,
    crew_id,
    flight_number,
    flight_date,
    origin_airport,
    destination_airport,
    flight_status,
    scheduled_departure,
    scheduled_arrival,
    estimated_departure,
    estimated_arrival,
    actual_departure,
    actual_arrival,
    delay_dep_min,
    delay_arr_min,
    aircraft_registration,
    snapshot,
    logged_at
  from public.flight_ops_log
  where flight_date >= (current_date - 365)
    and flight_date < current_date
    and flight_id is not null
    and crew_id is not null
  order by flight_id, logged_at desc nulls last
) l
where not exists (select 1 from public.flights f where f.id = l.flight_id)
  and not exists (
    select 1 from public.flights_archive a where a.original_flight_id = l.flight_id
  )
  and (
    -- duty/sim always keep
    coalesce(l.snapshot->>'roster_entry_kind', 'flight') <> 'flight'
    or exists (
      select 1
      from public.flight_ops_log o
      where o.flight_id = l.flight_id
        and (
          o.event in ('takeoff', 'first_seen')
          or coalesce(o.flight_status, '') in (
            'landed', 'en_route', 'took_off', 'diverted', 'arrived', 'airborne', 'parked'
          )
          or o.actual_departure is not null
          or o.actual_arrival is not null
          or o.fr24_datetime_takeoff_utc is not null
          or o.fr24_datetime_landed_utc is not null
        )
    )
    or l.actual_departure is not null
    or l.actual_arrival is not null
    or coalesce(l.snapshot->>'actual_departure', '') <> ''
    or coalesce(l.snapshot->>'actual_arrival', '') <> ''
    or coalesce(l.snapshot->>'fr24_datetime_takeoff_utc', '') <> ''
    or coalesce(l.snapshot->>'fr24_datetime_landed_utc', '') <> ''
    or lower(coalesce(l.flight_status, l.snapshot->>'flight_status', '')) in (
      'landed', 'en_route', 'took_off', 'diverted', 'arrived', 'airborne', 'parked'
    )
  )
on conflict (original_flight_id) do nothing;
