-- On live DELETE:
-- - Flown / live-tracked flights: keep slim archive history (do not clobber past_12h_slim_card).
-- - Never-flown / never-tracked flights (roster replace / user clear): hard-remove only —
--   do NOT insert flights_archive (and drop any junk archive row for that id).
-- Re-import will recreate live rows with new ids; that is expected. Archive must not
-- resurrect those unflown deletes.

create or replace function public.flight_row_was_live_tracked(f public.flights)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(f.roster_entry_kind, 'flight') = 'flight'
    and (
      f.actual_departure is not null
      or f.actual_arrival is not null
      or f.fr24_datetime_takeoff_utc is not null
      or f.fr24_datetime_landed_utc is not null
      or f.fr24_first_seen_utc is not null
      or lower(coalesce(f.flight_status, '')) in (
        'landed', 'en_route', 'took_off', 'diverted', 'arrived', 'airborne', 'parked'
      )
      or lower(coalesce(f.internal_status, '')) in (
        'landed', 'en_route', 'took_off', 'diverted', 'arrived', 'airborne', 'parked'
      )
    );
$$;

comment on function public.flight_row_was_live_tracked(public.flights) is
  'True when a flight had live tracking / airborne evidence; used to decide archive-on-delete.';

create or replace function public.tg_flights_ops_log_bd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_ids uuid[];
  v_existing_reason text;
  v_tracked boolean;
begin
  if coalesce(old.roster_entry_kind, 'flight') not in ('flight', 'duty_off', 'sim') then
    return old;
  end if;

  -- Ops audit for flights only (light). Duties/sims skip ops + archive on user delete.
  if coalesce(old.roster_entry_kind, 'flight') = 'flight' then
    perform public.flight_ops_log_insert_from_flight('deleted', old, 'removed from live flights');
  end if;

  v_tracked := public.flight_row_was_live_tracked(old);

  -- Unflown flight or duty/sim: remove any archive junk; do not insert new archive.
  if not v_tracked then
    delete from public.flights_archive a where a.original_flight_id = old.id;
    return old;
  end if;

  select coalesce(array_agg(distinct fc.crew_id), '{}'::uuid[])
    into v_crew_ids
  from public.flight_crew fc
  where fc.flight_id = old.id;

  if cardinality(v_crew_ids) = 0 and old.crew_id is not null then
    v_crew_ids := array[old.crew_id];
  end if;

  select a.archived_reason
    into v_existing_reason
  from public.flights_archive a
  where a.original_flight_id = old.id;

  if v_existing_reason is not null then
    -- Already archived (typically by archive_and_cleanup). Refresh crew ids only;
    -- never downgrade past_12h_slim_card → live_delete.
    update public.flights_archive a
    set
      crew_id = coalesce(a.crew_id, old.crew_id, v_crew_ids[1]),
      crew_ids = case
        when coalesce(cardinality(a.crew_ids), 0) = 0 then coalesce(v_crew_ids, '{}'::uuid[])
        else a.crew_ids
      end,
      flight_snapshot = coalesce(a.flight_snapshot, public.flight_card_snapshot(old))
    where a.original_flight_id = old.id;
    return old;
  end if;

  -- Tracked flight deleted before cron slim-archive: keep card history.
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
    flight_snapshot
  ) values (
    old.id,
    coalesce(old.crew_id, v_crew_ids[1]),
    v_crew_ids,
    old.flight_number,
    old.flight_date,
    old.scheduled_departure,
    old.scheduled_arrival,
    old.flight_status,
    'passive_past',
    'past_12h_slim_card',
    public.flight_card_snapshot(old)
  );
  return old;
end;
$$;

-- One more sweep: any leftover unflown archive flight cards (re-import churn).
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
