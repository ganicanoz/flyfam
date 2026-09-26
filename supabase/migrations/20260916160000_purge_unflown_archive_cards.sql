-- Remove archive cards for flights that were never actually flown / live-tracked.
-- Roster replacements and manual deletes often leave scheduled-only rows; those are not history.
-- Keep: takeoff/first_seen/FR24/actual times, or terminal airborne/landed statuses.
-- Keep: duty_off / sim roster entries.

with flown_ids as (
  select distinct flight_id
  from public.flight_ops_log
  where flight_id is not null
    and (
      event in ('takeoff', 'first_seen')
      or coalesce(flight_status, '') in (
        'landed', 'en_route', 'took_off', 'diverted', 'arrived', 'airborne', 'parked'
      )
      or actual_departure is not null
      or actual_arrival is not null
      or fr24_datetime_takeoff_utc is not null
      or fr24_datetime_landed_utc is not null
    )
),
purge as (
  select a.original_flight_id
  from public.flights_archive a
  where coalesce(a.flight_snapshot->>'roster_entry_kind', 'flight') = 'flight'
    and not (
      a.flight_snapshot->>'actual_departure' is not null
      or a.flight_snapshot->>'actual_arrival' is not null
      or a.flight_snapshot->>'fr24_datetime_takeoff_utc' is not null
      or a.flight_snapshot->>'fr24_datetime_landed_utc' is not null
      or a.original_flight_id in (select flight_id from flown_ids)
      or lower(coalesce(a.flight_status, a.flight_snapshot->>'flight_status', '')) in (
        'landed', 'en_route', 'took_off', 'diverted', 'arrived', 'airborne', 'parked'
      )
    )
)
delete from public.flights_archive a
using purge p
where a.original_flight_id = p.original_flight_id;
