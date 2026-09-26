-- Protect live flights from premature slim-archive when provider wrote
-- wrong-day ATA/ETA (previous calendar day) and marked landed early.
-- Rules:
-- 1) Never archive while scheduled_departure is still in the future.
-- 2) Ignore actual_arrival that precedes STD by >90 minutes when computing block_end.

create or replace function public.archive_and_cleanup_old_flights(
  p_cutoff interval default interval '12 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with candidates as (
    select
      f.*,
      coalesce(
        (
          select array_agg(distinct fc.crew_id)
          from public.flight_crew fc
          where fc.flight_id = f.id
        ),
        case when f.crew_id is not null then array[f.crew_id] else '{}'::uuid[] end
      ) as resolved_crew_ids,
      coalesce(
        f.fr24_datetime_landed_utc,
        case
          when f.actual_arrival is not null
            and (
              f.scheduled_departure is null
              or f.actual_arrival >= (f.scheduled_departure - interval '90 minutes')
            )
          then f.actual_arrival
        end,
        f.scheduled_arrival,
        f.duty_rest_end,
        f.scheduled_departure + interval '4 hours',
        (f.flight_date::timestamptz + interval '1 day')
      ) as block_end_utc
    from public.flights f
    where coalesce(f.roster_entry_kind, 'flight') in ('flight', 'duty_off', 'sim')
      -- Hard guard: flight that has not reached STD must stay on live roster.
      and (
        coalesce(f.roster_entry_kind, 'flight') in ('duty_off', 'sim')
        or f.scheduled_departure is null
        or f.scheduled_departure <= now()
      )
      and coalesce(
        f.fr24_datetime_landed_utc,
        case
          when f.actual_arrival is not null
            and (
              f.scheduled_departure is null
              or f.actual_arrival >= (f.scheduled_departure - interval '90 minutes')
            )
          then f.actual_arrival
        end,
        f.scheduled_arrival,
        f.duty_rest_end,
        f.scheduled_departure + interval '4 hours',
        (f.flight_date::timestamptz + interval '1 day')
      ) < (now() - p_cutoff)
      and (
        coalesce(f.roster_entry_kind, 'flight') in ('duty_off', 'sim')
        or coalesce(f.flight_status, '') in ('landed', 'cancelled', 'diverted', 'arrived')
        or f.api_refresh_phase in ('passive_past', 'passive_complete')
        or (
          f.actual_arrival is not null
          and (
            f.scheduled_departure is null
            or f.actual_arrival >= (f.scheduled_departure - interval '90 minutes')
          )
        )
        or f.fr24_datetime_landed_utc is not null
      )
  ),
  archived as (
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
    )
    select
      c.id,
      coalesce(c.crew_id, (c.resolved_crew_ids)[1]),
      coalesce(c.resolved_crew_ids, '{}'::uuid[]),
      c.flight_number,
      c.flight_date,
      c.scheduled_departure,
      c.scheduled_arrival,
      c.flight_status,
      'passive_past',
      'past_12h_slim_card',
      (select public.flight_card_snapshot(f) from public.flights f where f.id = c.id)
    from candidates c
    on conflict (original_flight_id) do update
      set
        archived_at = now(),
        crew_id = excluded.crew_id,
        crew_ids = excluded.crew_ids,
        flight_number = excluded.flight_number,
        flight_date = excluded.flight_date,
        scheduled_departure = excluded.scheduled_departure,
        scheduled_arrival = excluded.scheduled_arrival,
        flight_status = excluded.flight_status,
        api_refresh_phase = 'passive_past',
        archived_reason = excluded.archived_reason,
        flight_snapshot = excluded.flight_snapshot
    returning original_flight_id
  ),
  deleted as (
    delete from public.flights f
    using archived a
    where f.id = a.original_flight_id
    returning f.id
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$;

comment on function public.archive_and_cleanup_old_flights(interval) is
  'Slim-archives ended roster rows after cutoff (default 12h). Never archives before STD; ignores wrong-day ATA before STD-90m.';
