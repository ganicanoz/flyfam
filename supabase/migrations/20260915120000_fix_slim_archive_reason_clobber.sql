-- Root cause: archive_and_cleanup inserts past_12h_slim_card, then DELETE fires
-- tg_flights_ops_log_bd which upserted archived_reason = live_delete and hid cards
-- from clients that only read past_12h_slim_card.
--
-- Fix: if archive row already exists, do not clobber slim reason; repair all victims.

create or replace function public.tg_flights_ops_log_bd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_ids uuid[];
  v_existing_reason text;
begin
  if coalesce(old.roster_entry_kind, 'flight') in ('flight', 'duty_off', 'sim') then
    if coalesce(old.roster_entry_kind, 'flight') = 'flight' then
      perform public.flight_ops_log_insert_from_flight('deleted', old, 'removed from live flights');
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
      'live_delete',
      public.flight_card_snapshot(old)
    );
  end if;
  return old;
end;
$$;

-- Repair every slim-card row wrongly labeled live_delete (all crews).
update public.flights_archive a
set archived_reason = 'past_12h_slim_card'
where a.archived_reason = 'live_delete'
  and coalesce(a.flight_snapshot->>'_archived', '') in ('true', 't', '1');
