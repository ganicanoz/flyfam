-- One flight row per (flight_number, flight_date) globally. Who is on the flight = flight_crew.
-- 1) Create junction table and backfill from current flights.
create table if not exists public.flight_crew (
  flight_id uuid not null references public.flights(id) on delete cascade,
  crew_id uuid not null references public.crew_profiles(id) on delete cascade,
  primary key (flight_id, crew_id)
);
create index if not exists idx_flight_crew_crew on public.flight_crew(crew_id);
create index if not exists idx_flight_crew_flight on public.flight_crew(flight_id);
comment on table public.flight_crew is 'Which crew are on which flight; one flight can have many crew.';

insert into public.flight_crew (flight_id, crew_id)
select id, crew_id from public.flights
on conflict (flight_id, crew_id) do nothing;

-- 2) Dedupe flights: keep one row per (flight_number, flight_date), merge flight_crew, drop duplicate flight rows.
do $$
declare
  r record;
  keeper uuid;
begin
  for r in (
    select flight_number, flight_date,
      (array_agg(id order by updated_at desc nulls last, id))[1] as keeper_id,
      array_agg(id) as ids
    from public.flights
    group by flight_number, flight_date
    having count(*) > 1
  )
  loop
    keeper := r.keeper_id;
    -- attach all crew from duplicate rows to keeper
    insert into public.flight_crew (flight_id, crew_id)
    select keeper, fc.crew_id
    from public.flight_crew fc
    where fc.flight_id = any(r.ids) and fc.flight_id <> keeper
    on conflict (flight_id, crew_id) do nothing;
    -- remove crew from duplicate flight rows (so we can delete those rows)
    delete from public.flight_crew where flight_id = any(r.ids) and flight_id <> keeper;
    delete from public.flights where id = any(r.ids) and id <> keeper;
  end loop;
end $$;

-- 3) Replace per-crew unique with global unique.
alter table public.flights drop constraint if exists flights_crew_number_date_unique;
alter table public.flights add constraint flights_number_date_unique unique (flight_number, flight_date);
comment on constraint flights_number_date_unique on public.flights is 'One flight row per flight number and date; crew linked via flight_crew.';

-- 4) crew_id optional (first adder / legacy).
alter table public.flights alter column crew_id drop not null;

-- 5) RLS for flight_crew
alter table public.flight_crew enable row level security;

drop policy if exists "Crew can manage own flight_crew rows" on public.flight_crew;
create policy "Crew can manage own flight_crew rows"
  on public.flight_crew for all
  using (crew_id in (select id from public.crew_profiles where user_id = auth.uid()))
  with check (crew_id in (select id from public.crew_profiles where user_id = auth.uid()));

drop policy if exists "Family can read flight_crew of connections" on public.flight_crew;
create policy "Family can read flight_crew of connections"
  on public.flight_crew for select
  using (
    crew_id in (
      select fc.crew_id from public.family_connections fc
      where fc.family_id = auth.uid() and fc.status = 'approved'
    )
  );

-- 6) RLS for flights: select by flight_crew membership or family connection
drop policy if exists "Crew can manage own flights" on public.flights;
drop policy if exists "Family can read flights of approved connections" on public.flights;

create policy "Crew and family can read flights via flight_crew"
  on public.flights for select
  using (
    exists (
      select 1 from public.flight_crew fc
      where fc.flight_id = flights.id
      and (
        fc.crew_id in (select id from public.crew_profiles where user_id = auth.uid())
        or fc.crew_id in (
          select fc2.crew_id from public.family_connections fc2
          where fc2.family_id = auth.uid() and fc2.status = 'approved'
        )
      )
    )
  );

create policy "Crew can insert flights"
  on public.flights for insert
  with check (
    crew_id is null or crew_id in (select id from public.crew_profiles where user_id = auth.uid())
  );

create policy "Crew on flight can update"
  on public.flights for update
  using (
    exists (
      select 1 from public.flight_crew fc
      where fc.flight_id = flights.id
      and fc.crew_id in (select id from public.crew_profiles where user_id = auth.uid())
    )
  );

-- Delete only when no crew left on flight (used by RPC after removing last crew)
create policy "Allow delete when no crew on flight"
  on public.flights for delete
  using (not exists (select 1 from public.flight_crew fc where fc.flight_id = flights.id));

-- 7) RPC: remove current crew from flight; delete flight if no one left
create or replace function public.remove_me_from_flight(p_flight_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    return;
  end if;
  delete from public.flight_crew where flight_id = p_flight_id and crew_id = v_crew_id;
  if not exists (select 1 from public.flight_crew where flight_id = p_flight_id) then
    delete from public.flights where id = p_flight_id;
  end if;
end;
$$;
comment on function public.remove_me_from_flight(uuid) is 'Remove current user from flight; deletes flight if no crew left.';

-- 8) RPC: add current crew to flight (find by flight_number+date or create); returns flight_id
-- 20260317200000 sekiz parametreli sürüm bırakırsa overload birikir; COMMENT "not unique" hatası verir.
drop function if exists public.add_me_to_flight(text, date, text, text, timestamptz, timestamptz, text, timestamptz);

create or replace function public.add_me_to_flight(
  p_flight_number text,
  p_flight_date date,
  p_origin_airport text default null,
  p_destination_airport text default null,
  p_scheduled_departure timestamptz default null,
  p_scheduled_arrival timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_flight_id uuid;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    return null;
  end if;
  select id into v_flight_id from public.flights
  where flight_number = p_flight_number and flight_date = p_flight_date
  limit 1;
  if v_flight_id is not null then
    insert into public.flight_crew (flight_id, crew_id) values (v_flight_id, v_crew_id)
    on conflict (flight_id, crew_id) do nothing;
    return v_flight_id;
  end if;
  insert into public.flights (
    crew_id, flight_number, origin_airport, destination_airport, flight_date,
    scheduled_departure, scheduled_arrival, source
  ) values (
    v_crew_id, p_flight_number, p_origin_airport, p_destination_airport, p_flight_date,
    p_scheduled_departure, p_scheduled_arrival, 'manual'
  )
  returning id into v_flight_id;
  insert into public.flight_crew (flight_id, crew_id) values (v_flight_id, v_crew_id)
  on conflict (flight_id, crew_id) do nothing;
  return v_flight_id;
end;
$$;
comment on function public.add_me_to_flight(text, date, text, text, timestamptz, timestamptz) is 'Find flight by number+date or create; add current crew to flight_crew. Returns flight id.';

-- 9) RPC: remove current crew from all flights; delete flights that end up with no crew
create or replace function public.remove_me_from_all_flights()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_flight_id uuid;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then return; end if;
  delete from public.flight_crew where crew_id = v_crew_id;
  for v_flight_id in
    select id from public.flights f
    where not exists (select 1 from public.flight_crew fc where fc.flight_id = f.id)
  loop
    delete from public.flights where id = v_flight_id;
  end loop;
end;
$$;
comment on function public.remove_me_from_all_flights() is 'Remove current user from all flights; delete flights with no crew left.';
