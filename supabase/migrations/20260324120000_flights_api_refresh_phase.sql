-- Cron / API: yalnızca semi_active + active uçuşlar için dış API tazelenir.
-- Zamanla değişen faz için: tetikleyici (schedule değişince) + refresh_flights_api_refresh_phase() periyodik çağrı.

alter table public.flights
  add column if not exists api_refresh_phase text;

alter table public.flights drop constraint if exists flights_api_refresh_phase_check;
alter table public.flights add constraint flights_api_refresh_phase_check
  check (
    api_refresh_phase is null
    or api_refresh_phase in (
      'passive_upcoming',
      'semi_active',
      'active',
      'passive_complete'
    )
  );

comment on column public.flights.api_refresh_phase is
  'Uçuş segmenti (roster_entry_kind=flight) için API yenileme fazı: passive_upcoming | semi_active | active | passive_complete. duty/sim NULL. Zaman now() ile hesaplanır; periyodik RPC ile güncellenir.';

create index if not exists idx_flights_api_refresh_phase_poll
  on public.flights (api_refresh_phase)
  where roster_entry_kind = 'flight'
    and api_refresh_phase in ('semi_active', 'active');

-- X = scheduled_departure, Y = scheduled_arrival (yoksa Y ≈ X+4h).
create or replace function public.compute_api_refresh_phase(
  p_dep timestamptz,
  p_arr timestamptz,
  p_now timestamptz
) returns text
language sql
stable
as $$
  select case
    when p_dep is null then null::text
    when p_now > coalesce(p_arr, p_dep + interval '4 hours') then 'passive_complete'
    when p_now + interval '30 minutes' > p_dep then 'active'
    when p_now + interval '12 hours' > p_dep then 'semi_active'
    else 'passive_upcoming'
  end;
$$;

comment on function public.compute_api_refresh_phase(timestamptz, timestamptz, timestamptz) is
  'Faz sırası: now>Y → passive_complete; now+30m>X → active; now+12h>X → semi_active; else passive_upcoming.';

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
  return new;
end;
$$;

drop trigger if exists trg_flights_api_refresh_phase_bi on public.flights;
create trigger trg_flights_api_refresh_phase_bi
  before insert or update of scheduled_departure, scheduled_arrival, roster_entry_kind
  on public.flights
  for each row
  execute function public.trg_flights_set_api_refresh_phase();

-- Tüm yakın tarihli satırları now() ile yeniden etiketle (zaman geçişleri için cron’da çağırın).
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
  return n;
end;
$$;

comment on function public.refresh_flights_api_refresh_phase() is
  'flight_date -2..+30 gün aralığındaki satırlarda api_refresh_phase günceller. Edge cron başında çağrılmalı.';

revoke all on function public.refresh_flights_api_refresh_phase() from public;
grant execute on function public.refresh_flights_api_refresh_phase() to service_role;

-- Mevcut satırlar
update public.flights f
set
  api_refresh_phase = case
    when f.roster_entry_kind is distinct from 'flight' then null
    when f.scheduled_departure is null then null
    else public.compute_api_refresh_phase(f.scheduled_departure, f.scheduled_arrival, now())
  end
where f.flight_date >= (current_date - interval '2 days')
  and f.flight_date <= (current_date + interval '30 days');
