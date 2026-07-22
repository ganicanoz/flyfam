-- Flight ops history log: status/phase milestones + ensure archive on delete.
-- Admin panel reads this to verify the system after flights leave the live roster.

create table if not exists public.flight_ops_log (
  id uuid primary key default gen_random_uuid(),
  logged_at timestamptz not null default now(),
  event text not null,
  flight_id uuid,
  crew_id uuid,
  flight_number text,
  flight_date date,
  origin_airport text,
  destination_airport text,
  flight_status text,
  api_refresh_phase text,
  scheduled_departure timestamptz,
  scheduled_arrival timestamptz,
  estimated_departure timestamptz,
  estimated_arrival timestamptz,
  actual_departure timestamptz,
  actual_arrival timestamptz,
  fr24_first_seen_utc timestamptz,
  fr24_datetime_takeoff_utc timestamptz,
  fr24_datetime_landed_utc timestamptz,
  delay_dep_min integer,
  delay_arr_min integer,
  aircraft_registration text,
  note text,
  snapshot jsonb
);

comment on table public.flight_ops_log is
  'Append-only ops timeline for flights (status/phase milestones, delete). Retained for admin health review.';

create index if not exists idx_flight_ops_log_logged_at
  on public.flight_ops_log (logged_at desc);

create index if not exists idx_flight_ops_log_flight_date
  on public.flight_ops_log (flight_date desc, flight_number);

create index if not exists idx_flight_ops_log_flight_id
  on public.flight_ops_log (flight_id, logged_at desc);

create index if not exists idx_flight_ops_log_number
  on public.flight_ops_log (flight_number, logged_at desc);

revoke all on table public.flight_ops_log from public;
grant select, insert on table public.flight_ops_log to service_role;

alter table public.flight_ops_log enable row level security;

create or replace function public.flight_ops_log_insert_from_flight(
  p_event text,
  p_row public.flights,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.flight_ops_log (
    event,
    flight_id,
    crew_id,
    flight_number,
    flight_date,
    origin_airport,
    destination_airport,
    flight_status,
    api_refresh_phase,
    scheduled_departure,
    scheduled_arrival,
    estimated_departure,
    estimated_arrival,
    actual_departure,
    actual_arrival,
    fr24_first_seen_utc,
    fr24_datetime_takeoff_utc,
    fr24_datetime_landed_utc,
    delay_dep_min,
    delay_arr_min,
    aircraft_registration,
    note,
    snapshot
  ) values (
    p_event,
    p_row.id,
    p_row.crew_id,
    p_row.flight_number,
    p_row.flight_date,
    p_row.origin_airport,
    p_row.destination_airport,
    p_row.flight_status,
    p_row.api_refresh_phase,
    p_row.scheduled_departure,
    p_row.scheduled_arrival,
    p_row.estimated_departure,
    p_row.estimated_arrival,
    p_row.actual_departure,
    p_row.actual_arrival,
    p_row.fr24_first_seen_utc,
    p_row.fr24_datetime_takeoff_utc,
    p_row.fr24_datetime_landed_utc,
    p_row.delay_dep_min,
    p_row.delay_arr_min,
    p_row.aircraft_registration,
    p_note,
    to_jsonb(p_row)
  );
end;
$$;

create or replace function public.tg_flights_ops_log_ai()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.roster_entry_kind, 'flight') = 'flight' then
    perform public.flight_ops_log_insert_from_flight('created', new, null);
  end if;
  return new;
end;
$$;

create or replace function public.tg_flights_ops_log_au()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text := null;
  v_note text := null;
begin
  if coalesce(new.roster_entry_kind, 'flight') is distinct from 'flight'
     and coalesce(old.roster_entry_kind, 'flight') is distinct from 'flight' then
    return new;
  end if;

  if old.flight_status is distinct from new.flight_status then
    v_event := 'status_change';
    v_note := format('%s → %s', coalesce(old.flight_status, 'null'), coalesce(new.flight_status, 'null'));
  elsif old.api_refresh_phase is distinct from new.api_refresh_phase then
    v_event := 'phase_change';
    v_note := format('%s → %s', coalesce(old.api_refresh_phase, 'null'), coalesce(new.api_refresh_phase, 'null'));
  elsif old.fr24_first_seen_utc is null and new.fr24_first_seen_utc is not null then
    v_event := 'first_seen';
  elsif old.fr24_datetime_takeoff_utc is null and new.fr24_datetime_takeoff_utc is not null then
    v_event := 'takeoff';
  elsif old.fr24_datetime_landed_utc is null and new.fr24_datetime_landed_utc is not null then
    v_event := 'landed';
  elsif coalesce(old.delay_dep_min, -1) is distinct from coalesce(new.delay_dep_min, -1)
     or coalesce(old.delay_arr_min, -1) is distinct from coalesce(new.delay_arr_min, -1) then
    -- Only log delay jumps of more than 5 minutes to avoid poll noise.
    if abs(coalesce(new.delay_dep_min, 0) - coalesce(old.delay_dep_min, 0)) >= 5
       or abs(coalesce(new.delay_arr_min, 0) - coalesce(old.delay_arr_min, 0)) >= 5 then
      v_event := 'delay_update';
      v_note := format(
        'dep %s→%s · arr %s→%s',
        coalesce(old.delay_dep_min::text, 'null'),
        coalesce(new.delay_dep_min::text, 'null'),
        coalesce(old.delay_arr_min::text, 'null'),
        coalesce(new.delay_arr_min::text, 'null')
      );
    end if;
  end if;

  if v_event is not null then
    perform public.flight_ops_log_insert_from_flight(v_event, new, v_note);
  end if;
  return new;
end;
$$;

create or replace function public.tg_flights_ops_log_bd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.roster_entry_kind, 'flight') = 'flight' then
    perform public.flight_ops_log_insert_from_flight('deleted', old, 'removed from live flights');

    insert into public.flights_archive (
      original_flight_id,
      crew_id,
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
      old.crew_id,
      old.flight_number,
      old.flight_date,
      old.scheduled_departure,
      old.scheduled_arrival,
      old.flight_status,
      old.api_refresh_phase,
      'live_delete',
      to_jsonb(old)
    )
    on conflict (original_flight_id) do update
      set
        archived_at = now(),
        archived_reason = excluded.archived_reason,
        flight_status = excluded.flight_status,
        api_refresh_phase = excluded.api_refresh_phase,
        flight_snapshot = excluded.flight_snapshot;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_flights_ops_log_ai on public.flights;
create trigger trg_flights_ops_log_ai
  after insert on public.flights
  for each row
  execute function public.tg_flights_ops_log_ai();

drop trigger if exists trg_flights_ops_log_au on public.flights;
create trigger trg_flights_ops_log_au
  after update on public.flights
  for each row
  execute function public.tg_flights_ops_log_au();

drop trigger if exists trg_flights_ops_log_bd on public.flights;
create trigger trg_flights_ops_log_bd
  before delete on public.flights
  for each row
  execute function public.tg_flights_ops_log_bd();

-- Retention: keep ops log 90 days (same as archive purge).
create or replace function public.purge_old_flight_ops_log(
  p_retention interval default interval '90 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  delete from public.flight_ops_log
  where logged_at < (now() - p_retention);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skip ops log purge schedule';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-old-flight-ops-log') then
    perform cron.unschedule('purge-old-flight-ops-log');
  end if;
  perform cron.schedule(
    'purge-old-flight-ops-log',
    '25 3 * * *',
    $cron$select public.purge_old_flight_ops_log(interval '90 days')$cron$
  );
exception
  when undefined_table then
    raise notice 'cron schema missing — skip';
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;
