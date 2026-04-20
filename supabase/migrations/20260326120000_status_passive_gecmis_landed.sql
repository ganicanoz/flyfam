-- Statü (pasif): pasif gelecek → scheduled; pasif geçmiş → landed (önceki sürümde passive_complete→scheduled yanlıştı).

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
      new.flight_status := 'landed';
    elsif new.api_refresh_phase = 'passive_upcoming' then
      new.flight_status := 'scheduled';
    end if;
  end if;

  return new;
end;
$$;

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
    when f.api_refresh_phase = 'passive_complete' then 'landed'
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
  'api_refresh_phase günceller; passive_upcoming→scheduled; passive_complete→landed.';

update public.flights f
set flight_status = case
  when f.api_refresh_phase = 'passive_complete' then 'landed'
  when f.api_refresh_phase = 'passive_upcoming' then 'scheduled'
  else f.flight_status
end
where f.roster_entry_kind = 'flight'
  and f.api_refresh_phase in ('passive_complete', 'passive_upcoming')
  and f.flight_date >= (current_date - interval '2 days')
  and f.flight_date <= (current_date + interval '30 days')
  and coalesce(f.flight_status, '') not in ('cancelled', 'diverted');
