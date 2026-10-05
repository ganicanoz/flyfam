-- Ekip Odası layover detection aligned with the Roster screen (computeLayoverWindows):
-- * outbound = earliest later departure FROM the layover station (not simply the next row), so an
--   overlapping/unrelated row between the two legs no longer hides the layover;
-- * Istanbul airports (IST/SAW/ISL) count as the same home city;
-- * layover days span the roster dates (flight_date) of the inbound and outbound legs, like the calendar;
-- * flights are read up to p_to + 4 so a layover that ends after the range still marks its first days.
-- Signature, return columns, visibility rules and grants are unchanged.

create or replace function public.crew_room_days_for(p_viewer uuid, p_from date, p_to date)
returns table (
  crew_id uuid,
  day date,
  level text,
  status text,
  stations text[],
  flights jsonb,
  layover boolean,
  layover_at text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_viewer is null or p_from is null or p_to is null or p_to < p_from then
    return;
  end if;
  if p_to - p_from > 62 then
    raise exception 'range_too_large';
  end if;

  return query
  with people as (
    select p_viewer as crew_id, 'full'::text as level
    union all
    select c.crew_id, public.crew_room_effective_level(c.crew_id, p_viewer)
    from public.crew_room_contacts(p_viewer) c
  ),
  vis as (
    select p.crew_id, p.level, upper(nullif(btrim(coalesce(cp.home_base_iata, '')), '')) as hb, cp.airline_icao
    from people p
    join public.crew_profiles cp on cp.id = p.crew_id
    where p.level <> 'hidden'
  ),
  classed as (
    select
      v.crew_id,
      f.flight_date as d,
      upper(regexp_replace(coalesce(f.flight_number, ''), '\s', '', 'g')) as code,
      upper(f.origin_airport) as org,
      upper(f.destination_airport) as dst,
      f.scheduled_departure as dep,
      f.scheduled_arrival as arr,
      v.hb,
      public.crew_room_classify(f.roster_entry_kind, f.flight_number, v.airline_icao) as cls
    from vis v
    join public.flight_crew fc on fc.crew_id = v.crew_id
    join public.flights f on f.id = fc.flight_id
    where f.flight_date between p_from - 4 and p_to + 4
  ),
  legs as (
    select c.*,
      case when c.dst in ('IST', 'SAW', 'ISL') then 'IST' else c.dst end as dst_city,
      case when c.hb in ('IST', 'SAW', 'ISL') then 'IST' else c.hb end as hb_city
    from classed c
    where c.cls = 'flight' and c.dep is not null and c.arr is not null
  ),
  lay as (
    select i.crew_id, i.dst as station, i.d as start_d, o.d as end_d
    from legs i
    cross join lateral (
      select l2.d, l2.dep
      from legs l2
      where l2.crew_id = i.crew_id
        and l2.org = i.dst
        and l2.dep > i.arr
      order by l2.dep
      limit 1
    ) o
    where i.hb is not null
      and i.dst is not null
      and i.dst_city <> i.hb_city
      and o.dep - i.arr between interval '10 hours' and interval '72 hours'
      and o.d >= i.d
  ),
  lay_days as (
    select l.crew_id, l.station, g::date as d
    from lay l
    cross join lateral generate_series(l.start_d, l.end_d, interval '1 day') g
  ),
  last_rows as (
    select c.crew_id, max(c.d) as last_d from classed c where c.cls <> 'skip' group by c.crew_id
  ),
  days as (
    select v.crew_id, v.level, v.hb, g::date as d
    from vis v
    cross join generate_series(p_from, p_to, interval '1 day') g
  ),
  agg as (
    select
      dd.crew_id, dd.level, dd.hb, dd.d,
      coalesce(bool_or(c.cls = 'flight'), false) as has_flight,
      coalesce(bool_or(c.cls = 'standby'), false) as has_standby,
      coalesce(bool_or(c.cls = 'duty'), false) as has_duty,
      coalesce(bool_or(c.cls = 'off'), false) as has_off,
      coalesce(
        jsonb_agg(
          jsonb_build_object('no', c.code, 'from', c.org, 'to', c.dst, 'dep', c.dep, 'arr', c.arr)
          order by c.dep
        ) filter (where c.cls = 'flight'),
        '[]'::jsonb
      ) as fl,
      coalesce(array_agg(distinct c.dst) filter (where c.cls = 'flight' and c.dst is not null), '{}'::text[]) as dsts
    from days dd
    left join classed c on c.crew_id = dd.crew_id and c.d = dd.d
    group by dd.crew_id, dd.level, dd.hb, dd.d
  ),
  shaped as (
    select
      a.crew_id, a.d, a.level, a.fl,
      ld.stations as lay_stations,
      array(
        select distinct x
        from unnest(a.dsts || coalesce(ld.stations, '{}'::text[])) x
        where x is not null and x is distinct from a.hb
      ) as stations,
      case
        when a.has_flight then 'flying'
        when ld.stations is not null then 'layover'
        when a.has_standby then 'standby'
        when a.has_duty then 'duty'
        when a.has_off then 'off'
        when exists (select 1 from last_rows lr where lr.crew_id = a.crew_id and a.d <= lr.last_d) then 'free'
        else 'unknown'
      end as raw_status
    from agg a
    left join lateral (
      select array_agg(distinct l2.station order by l2.station) as stations
      from lay_days l2
      where l2.crew_id = a.crew_id and l2.d = a.d
    ) ld on true
  )
  select
    s.crew_id,
    s.d as day,
    s.level,
    case
      when s.level = 'availability' and s.raw_status in ('flying', 'standby', 'duty') then 'busy'
      else s.raw_status
    end as status,
    case when s.level = 'availability' then '{}'::text[] else s.stations end as stations,
    case when s.level = 'full' then s.fl else '[]'::jsonb end as flights,
    s.lay_stations is not null as layover,
    case when s.level in ('full', 'destination') then coalesce(s.lay_stations, '{}'::text[]) else '{}'::text[] end as layover_at
  from shaped s
  order by s.crew_id, s.d;
end;
$$;

revoke all on function public.crew_room_days_for(uuid, date, date) from public, anon, authenticated;
grant execute on function public.crew_room_days_for(uuid, date, date) to service_role;
