-- Full alignment with docs/flight-status-algorithm.md
-- 1) Add missing internal/estimated columns
-- 2) Replace phase enum values with passive_future/passive_past naming
-- 3) Stop forcing user-facing status from DB trigger/refresh phase job

alter table public.flights
  add column if not exists estimated_departure timestamptz,
  add column if not exists estimated_arrival timestamptz,
  add column if not exists internal_status text,
  add column if not exists review_flag boolean not null default false;

alter table public.flights drop constraint if exists flights_internal_status_check;
alter table public.flights add constraint flights_internal_status_check
  check (
    internal_status is null
    or internal_status in ('scheduled', 'taxi_out', 'en_route', 'landed', 'cancelled', 'LANDED_CANDIDATE')
  );

update public.flights
set internal_status = case
  when coalesce(flight_status, '') in ('scheduled', 'taxi_out', 'en_route', 'landed', 'cancelled')
    then flight_status
  else 'scheduled'
end
where internal_status is null;

-- Önce eski faz isimlerini yeni isimlere çevir; sonra constraint ekle (aksi halde 23514).
alter table public.flights drop constraint if exists flights_api_refresh_phase_check;

update public.flights
set api_refresh_phase = case
  when api_refresh_phase = 'passive_upcoming' then 'passive_future'
  when api_refresh_phase = 'passive_complete' then 'passive_past'
  else api_refresh_phase
end
where api_refresh_phase in ('passive_upcoming', 'passive_complete');

-- Beklenmeyen / bozuk değerleri temizle (constraint öncesi zorunlu)
update public.flights
set api_refresh_phase = null
where api_refresh_phase is not null
  and api_refresh_phase not in (
    'passive_future',
    'semi_active',
    'active',
    'passive_past'
  );

alter table public.flights add constraint flights_api_refresh_phase_check
  check (
    api_refresh_phase is null
    or api_refresh_phase in (
      'passive_future',
      'semi_active',
      'active',
      'passive_past'
    )
  );

create or replace function public.compute_api_refresh_phase(
  p_dep timestamptz,
  p_arr timestamptz,
  p_actual_arr timestamptz,
  p_now timestamptz
) returns text
language sql
stable
as $$
  select case
    when p_dep is null then null::text
    when p_now < (p_dep - interval '3 hours') then 'passive_future'
    when p_now < (p_dep - interval '20 minutes') then 'semi_active'
    when p_actual_arr is not null and p_now > (p_actual_arr + interval '2 minutes') then 'passive_past'
    when p_now > (coalesce(p_arr, p_dep + interval '4 hours') + interval '3 hours') then 'passive_past'
    else 'active'
  end;
$$;

create or replace function public.trg_flights_set_api_refresh_phase()
returns trigger
language plpgsql
as $$
begin
  if new.roster_entry_kind is distinct from 'flight' or new.scheduled_departure is null then
    new.api_refresh_phase := null;
  else
    new.api_refresh_phase := public.compute_api_refresh_phase(
      new.scheduled_departure,
      new.scheduled_arrival,
      new.actual_arrival,
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_flights_api_refresh_phase_bi on public.flights;
create trigger trg_flights_api_refresh_phase_bi
  before insert or update of scheduled_departure, scheduled_arrival, actual_arrival, roster_entry_kind
  on public.flights
  for each row
  execute function public.trg_flights_set_api_refresh_phase();

create or replace function public.refresh_flights_api_refresh_phase()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.flights f
  set api_refresh_phase = case
    when f.roster_entry_kind is distinct from 'flight' then null
    when f.scheduled_departure is null then null
    else public.compute_api_refresh_phase(
      f.scheduled_departure,
      f.scheduled_arrival,
      f.actual_arrival,
      now()
    )
  end
  where f.flight_date >= (current_date - interval '2 days')
    and f.flight_date <= (current_date + interval '30 days');

  get diagnostics n = row_count;
  return n;
end;
$$;
