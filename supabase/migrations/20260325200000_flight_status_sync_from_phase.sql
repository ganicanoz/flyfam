-- Fazlama → statü (geçici kurallar; API statü yenilemesi sonra ayrıca kurulacak):
--   passive_complete  → flight_status = 'scheduled' (şimdilik kesin planlı)
--   passive_upcoming  → last_seen_utc veya actual_arrival varsa 'landed' (indi sinyali; gecikmeli uçuşta last_seen inince doğru)
--                       yoksa 'scheduled'
-- last_seen_utc: ileride FR24/API doldurur. Şimdilik actual_arrival da “indi” sayılır.
-- İptal / aktarmalı korunur. semi_active / active satırlara dokunulmaz.

alter table public.flights
  add column if not exists last_seen_utc timestamptz;

comment on column public.flights.last_seen_utc is
  'Track sonu (FR24 last_seen). Pasif gelecek fazında doluysa statü landed. API yenileme ile yazılır.';

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
      now()
    );
  end if;

  if new.roster_entry_kind = 'flight'
     and new.scheduled_departure is not null
     and coalesce(new.flight_status, '') not in ('cancelled', 'diverted') then
    if new.api_refresh_phase = 'passive_complete' then
      new.flight_status := 'scheduled';
    elsif new.api_refresh_phase = 'passive_upcoming' then
      if new.last_seen_utc is not null or new.actual_arrival is not null then
        new.flight_status := 'landed';
      else
        new.flight_status := 'scheduled';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_flights_api_refresh_phase_bi on public.flights;
create trigger trg_flights_api_refresh_phase_bi
  before insert or update of scheduled_departure, scheduled_arrival, roster_entry_kind, last_seen_utc, actual_arrival
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
  set
    api_refresh_phase = case
      when f.roster_entry_kind is distinct from 'flight' then null
      when f.scheduled_departure is null then null
      else public.compute_api_refresh_phase(f.scheduled_departure, f.scheduled_arrival, now())
    end
  where f.flight_date >= (current_date - interval '2 days')
    and f.flight_date <= (current_date + interval '30 days');

  get diagnostics n = row_count;

  update public.flights f
  set flight_status = case
    when f.api_refresh_phase = 'passive_complete' then 'scheduled'
    when f.api_refresh_phase = 'passive_upcoming'
         and (f.last_seen_utc is not null or f.actual_arrival is not null) then 'landed'
    when f.api_refresh_phase = 'passive_upcoming' then 'scheduled'
    else f.flight_status
  end
  where f.roster_entry_kind = 'flight'
    and f.api_refresh_phase in ('passive_complete', 'passive_upcoming')
    and f.flight_date >= (current_date - interval '2 days')
    and f.flight_date <= (current_date + interval '30 days')
    and coalesce(f.flight_status, '') not in ('cancelled', 'diverted');

  return n;
end;
$$;

comment on function public.refresh_flights_api_refresh_phase() is
  'api_refresh_phase günceller; passive_complete→scheduled; passive_upcoming+(last_seen_utc|actual_arrival)→landed yoksa scheduled.';

-- Mevcut satırlar
update public.flights f
set flight_status = case
  when f.api_refresh_phase = 'passive_complete' then 'scheduled'
  when f.api_refresh_phase = 'passive_upcoming'
       and (f.last_seen_utc is not null or f.actual_arrival is not null) then 'landed'
  when f.api_refresh_phase = 'passive_upcoming' then 'scheduled'
  else f.flight_status
end
where f.roster_entry_kind = 'flight'
  and f.api_refresh_phase in ('passive_complete', 'passive_upcoming')
  and f.flight_date >= (current_date - interval '2 days')
  and f.flight_date <= (current_date + interval '30 days')
  and coalesce(f.flight_status, '') not in ('cancelled', 'diverted');
