-- Ekip Odası layovers.
-- 1) Day grid gets `layover` (away overnight that day, also on flight days) at every visible level and
--    `layover_at` (layover station) only at 'destination' / 'full'. Status values are unchanged.
-- 2) Opt-in push only for shared layovers (same station, same day). A viewer is notified only if they
--    turned notify_layover on (default off) and both sides share at least 'destination' with each other,
--    i.e. the push never reveals more than the room already shows.

drop function if exists public.crew_room_days(date, date);
drop function if exists public.crew_room_days_for(uuid, date, date);

create function public.crew_room_days_for(p_viewer uuid, p_from date, p_to date)
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
    where f.flight_date between p_from - 4 and p_to + 1
  ),
  seq as (
    select
      c.crew_id, c.dst, c.arr, c.hb,
      lead(c.org) over w as next_org,
      lead(c.dep) over w as next_dep
    from classed c
    where c.cls = 'flight' and c.dep is not null and c.arr is not null
    window w as (partition by c.crew_id order by c.dep)
  ),
  lay as (
    select s.crew_id, s.dst as station, s.arr, s.next_dep
    from seq s
    where s.hb is not null
      and s.dst is not null
      and s.dst <> s.hb
      and s.next_org = s.dst
      and s.next_dep - s.arr between interval '10 hours' and interval '72 hours'
  ),
  lay_days as (
    select l.crew_id, l.station, g::date as d
    from lay l
    cross join lateral generate_series(
      (l.arr at time zone 'UTC')::date,
      (l.next_dep at time zone 'UTC')::date,
      interval '1 day'
    ) g
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

create function public.crew_room_days(p_from date, p_to date)
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
declare
  v_me uuid := public.crew_room_require_crew();
begin
  if not public.crew_has_active_subscription(v_me) then
    raise exception 'subscription_required';
  end if;
  return query select * from public.crew_room_days_for(v_me, p_from, p_to);
end;
$$;

revoke all on function public.crew_room_days(date, date) from public, anon;
grant execute on function public.crew_room_days(date, date) to authenticated, service_role;

alter table public.crew_room_prefs alter column notify_layover set default false;
alter table public.crew_room_prefs alter column notify_shared_off set default false;

create table if not exists public.crew_room_notified (
  viewer_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  other_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (viewer_crew_id, other_crew_id, day)
);

alter table public.crew_room_notified enable row level security;
revoke all on public.crew_room_notified from anon, authenticated;

create or replace function public.crew_room_pending_layovers(p_from date, p_to date)
returns table (
  viewer_crew_id uuid,
  other_crew_id uuid,
  other_name text,
  day date,
  stations text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v record;
begin
  if p_from is null or p_to is null or p_to < p_from then
    return;
  end if;
  for v in
    select p.crew_id as vid
    from public.crew_room_prefs p
    where p.notify_layover
      and not p.invisible
      and public.crew_has_active_subscription(p.crew_id)
      and exists (select 1 from public.crew_room_contacts(p.crew_id))
  loop
    return query
    with d as (
      select x.crew_id as cid, x.day as dday, x.layover_at as sts, x.level as lvl
      from public.crew_room_days_for(v.vid, p_from, p_to) x
      where x.layover
    ),
    mine as (select d.dday, d.sts from d where d.cid = v.vid),
    m as (
      select t.cid as other, t.dday,
        array(select unnest(me.sts) intersect select unnest(t.sts)) as shared
      from d t
      join mine me on me.dday = t.dday
      where t.cid <> v.vid
        and me.sts && t.sts
        and public.crew_room_level_rank(t.lvl) >= 2
        and public.crew_room_level_rank(public.crew_room_effective_level(v.vid, t.cid)) >= 2
    )
    select v.vid, m.other, pr.full_name, m.dday, m.shared
    from m
    join public.crew_profiles cp on cp.id = m.other
    left join public.profiles pr on pr.id = cp.user_id
    where not exists (
      select 1 from public.crew_room_notified n
      where n.viewer_crew_id = v.vid and n.other_crew_id = m.other and n.day = m.dday
    );
  end loop;
end;
$$;

revoke all on function public.crew_room_pending_layovers(date, date) from public, anon, authenticated;
grant execute on function public.crew_room_pending_layovers(date, date) to service_role;

create or replace function public.crew_room_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_prefs public.crew_room_prefs;
  v_result jsonb;
begin
  v_prefs := public.crew_room_ensure_prefs(v_me);

  select jsonb_build_object(
    'me', jsonb_build_object(
      'crew_id', v_me,
      'name', (select pr.full_name from public.crew_profiles cp join public.profiles pr on pr.id = cp.user_id where cp.id = v_me),
      'has_access', public.crew_has_active_subscription(v_me),
      'default_level', v_prefs.default_level,
      'invisible', v_prefs.invisible,
      'notify_layover', v_prefs.notify_layover
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew_id', c.crew_id,
        'name', pr.full_name,
        'avatar_url', pr.avatar_url,
        'airline_icao', cp.airline_icao,
        'home_base', cp.home_base_iata,
        'link_id', c.link_id,
        'has_access', public.crew_has_active_subscription(c.crew_id),
        'their_level', public.crew_room_effective_level(c.crew_id, v_me),
        'my_level', public.crew_room_effective_level(v_me, c.crew_id),
        'my_override', (select s.level from public.crew_room_shares s where s.owner_crew_id = v_me and s.viewer_crew_id = c.crew_id)
      ) order by lower(coalesce(pr.full_name, '')))
      from public.crew_room_contacts(v_me) c
      join public.crew_profiles cp on cp.id = c.crew_id
      left join public.profiles pr on pr.id = cp.user_id
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'link_id', l.id,
        'crew_id', l.requester_crew_id,
        'name', pr.full_name,
        'avatar_url', pr.avatar_url,
        'airline_icao', cp.airline_icao,
        'created_at', l.created_at
      ) order by l.created_at desc)
      from public.crew_room_links l
      join public.crew_profiles cp on cp.id = l.requester_crew_id
      left join public.profiles pr on pr.id = cp.user_id
      where l.addressee_crew_id = v_me and l.status = 'pending'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'link_id', l.id,
        'crew_id', l.addressee_crew_id,
        'name', pr.full_name,
        'created_at', l.created_at
      ) order by l.created_at desc)
      from public.crew_room_links l
      join public.crew_profiles cp on cp.id = l.addressee_crew_id
      left join public.profiles pr on pr.id = cp.user_id
      where l.requester_crew_id = v_me and l.status = 'pending'
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.crew_room_overview() from public, anon;
grant execute on function public.crew_room_overview() to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron/pg_net missing — skip crew-room-notify schedule';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'crew-room-notify') then
    perform cron.unschedule('crew-room-notify');
  end if;
  perform cron.schedule(
    'crew-room-notify',
    '7 * * * *',
    $cron$select net.http_post(
      url := 'https://slmgmcpluanezvkgkozw.supabase.co/functions/v1/crew-room-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'crew_room_cron_secret' limit 1), '')
      ),
      body := '{"action":"cron"}'::jsonb,
      timeout_milliseconds := 30000
    )$cron$
  );
exception
  when undefined_table then
    raise notice 'cron schema missing — skip';
  when others then
    raise notice 'crew-room-notify schedule skipped: %', sqlerrm;
end $$;
