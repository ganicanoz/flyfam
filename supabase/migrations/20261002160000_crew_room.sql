-- Ekip Odası / Crew Room
--
-- Crew members share roster visibility with each other at a chosen level
-- (hidden < availability < destination < full). Unlike crew_peer_links, no
-- direct table/RLS access to flights is granted: every read goes through
-- SECURITY DEFINER functions that redact per viewer. Both sides need an
-- active/trialing subscription. Crew Room contacts do not consume family
-- follower capacity.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.crew_room_prefs (
  crew_id uuid primary key references public.crew_profiles (id) on delete cascade,
  default_level text not null default 'availability'
    check (default_level in ('hidden', 'availability', 'destination', 'full')),
  invisible boolean not null default false,
  room_code text not null unique,
  notify_shared_off boolean not null default true,
  notify_layover boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crew_room_links (
  id uuid primary key default gen_random_uuid(),
  requester_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  addressee_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'removed')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  check (requester_crew_id <> addressee_crew_id)
);

create unique index if not exists crew_room_links_pair_uidx
  on public.crew_room_links (
    least(requester_crew_id, addressee_crew_id),
    greatest(requester_crew_id, addressee_crew_id)
  );
create index if not exists crew_room_links_requester_idx on public.crew_room_links (requester_crew_id, created_at);
create index if not exists crew_room_links_addressee_idx on public.crew_room_links (addressee_crew_id);

-- Per-person override: what owner shares with viewer (wins over defaults and groups).
create table if not exists public.crew_room_shares (
  owner_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  viewer_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  level text not null check (level in ('hidden', 'availability', 'destination', 'full')),
  updated_at timestamptz not null default now(),
  primary key (owner_crew_id, viewer_crew_id),
  check (owner_crew_id <> viewer_crew_id)
);

create table if not exists public.crew_room_groups (
  id uuid primary key default gen_random_uuid(),
  owner_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists crew_room_groups_owner_idx on public.crew_room_groups (owner_crew_id);

create table if not exists public.crew_room_group_members (
  group_id uuid not null references public.crew_room_groups (id) on delete cascade,
  crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  -- null = member's default_level
  share_level text check (share_level in ('hidden', 'availability', 'destination', 'full')),
  joined_at timestamptz not null default now(),
  primary key (group_id, crew_id)
);

create index if not exists crew_room_group_members_crew_idx on public.crew_room_group_members (crew_id);

create table if not exists public.crew_room_status (
  crew_id uuid primary key references public.crew_profiles (id) on delete cascade,
  note text not null check (char_length(note) between 1 and 140),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Dedupe for shared-off / layover push notifications.
create table if not exists public.crew_room_notified (
  viewer_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  other_crew_id uuid not null references public.crew_profiles (id) on delete cascade,
  kind text not null check (kind in ('shared_off', 'layover')),
  day date not null,
  created_at timestamptz not null default now(),
  primary key (viewer_crew_id, other_crew_id, kind, day)
);

alter table public.crew_room_prefs enable row level security;
alter table public.crew_room_links enable row level security;
alter table public.crew_room_shares enable row level security;
alter table public.crew_room_groups enable row level security;
alter table public.crew_room_group_members enable row level security;
alter table public.crew_room_status enable row level security;
alter table public.crew_room_notified enable row level security;

revoke all on public.crew_room_prefs from anon, authenticated;
revoke all on public.crew_room_links from anon, authenticated;
revoke all on public.crew_room_shares from anon, authenticated;
revoke all on public.crew_room_groups from anon, authenticated;
revoke all on public.crew_room_group_members from anon, authenticated;
revoke all on public.crew_room_status from anon, authenticated;
revoke all on public.crew_room_notified from anon, authenticated;

comment on table public.crew_room_links is
  'Crew Room contacts (crew↔crew). Approved links grant redacted roster visibility via crew_room_* functions only; no RLS access to flights.';

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

create or replace function public.crew_room_level_rank(p_level text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_level
    when 'full' then 3
    when 'destination' then 2
    when 'availability' then 1
    else 0
  end;
$$;

create or replace function public.crew_room_level_name(p_rank integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_rank >= 3 then 'full'
    when p_rank = 2 then 'destination'
    when p_rank = 1 then 'availability'
    else 'hidden'
  end;
$$;

create or replace function public.crew_room_my_crew_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cp.id
  from public.crew_profiles cp
  where cp.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.crew_room_new_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  i integer;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alpha, 1 + (get_byte(v_bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.crew_room_prefs p where p.room_code = v_code)
      and not exists (select 1 from public.crew_room_groups g where g.join_code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.crew_room_ensure_prefs(p_crew_id uuid)
returns public.crew_room_prefs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.crew_room_prefs;
begin
  insert into public.crew_room_prefs (crew_id, room_code)
  values (p_crew_id, public.crew_room_new_code())
  on conflict (crew_id) do nothing;
  select * into v_row from public.crew_room_prefs where crew_id = p_crew_id;
  return v_row;
end;
$$;

/** Mirrors mobile/supabase occupationLabels.ts: catalog category first, then code fallbacks. */
create or replace function public.crew_room_classify(
  p_kind text,
  p_code text,
  p_airline_icao text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_kind text := lower(coalesce(p_kind, 'flight'));
  v_cat text;
begin
  if v_code = 'LAYOVER' then
    return 'skip';
  end if;

  if v_code <> '' then
    select oc.category into v_cat
    from public.roster_occupation_codes oc
    where oc.active
      and upper(oc.code) = v_code
      and (nullif(btrim(coalesce(oc.airline_icao, '')), '') is null
           or upper(oc.airline_icao) = upper(coalesce(p_airline_icao, '')))
    order by (nullif(btrim(coalesce(oc.airline_icao, '')), '') is null) asc
    limit 1;
  end if;

  if v_cat in ('off', 'leave') then return 'off'; end if;
  if v_cat = 'standby' then return 'standby'; end if;
  if v_cat in ('training', 'office', 'meeting', 'simulator') then return 'duty'; end if;

  if v_code ~ '^(STBY|STB)' or v_code ~ '^RSV[0-9]*$' or v_code ~ '^SB[1-6X]?$'
     or v_code in ('HSBY', 'HSYB', 'ASYB', 'ASBD', 'SBYP', 'SBY', 'SBX', 'RZV', 'RZVM')
     or v_code like 'COTD%'
  then
    return 'standby';
  end if;

  if v_code in (
    'MSF', 'FSF', 'FOF', 'FREE', 'OFF', 'OFFB', 'DOFF', 'RQST', 'RSF', 'ROF', 'RUF', 'SOF',
    'SOS', 'LSF', 'OFG', 'IBB', 'IBE', 'IBX', 'IOZ', 'IBC', 'IBY', 'IBI', 'III', 'VAC',
    'AVAC', 'VAV', 'UPV', 'CFR'
  ) then
    return 'off';
  end if;

  if v_code like '%TRAINING%' or v_code like '%YERDR%' or v_code ~ '^RC[0-9]+$'
     or v_code ~ '^G[34]A[0-9]$' or v_code like 'GOA%' or v_code like 'OSA%'
     or v_code ~ '^(SIM|IPT|FFS|LOE|LPC|OPC)'
     or v_code in (
       'REC', 'TRT', 'KDME', 'FAA', 'FAT', 'IKA', 'ISG', 'SMA', 'TRA', 'SEM', 'SNV', 'SDM',
       'EMM', 'O1A', 'O2A'
     )
  then
    return 'duty';
  end if;

  if v_cat = 'other' then
    return case when v_kind = 'duty_off' then 'off' else 'duty' end;
  end if;
  if v_kind = 'sim' then return 'duty'; end if;
  if v_kind = 'duty_off' then return 'off'; end if;
  return 'flight';
end;
$$;

/** Everyone the viewer is connected to: approved links ∪ shared groups. */
create or replace function public.crew_room_contacts(p_viewer uuid)
returns table (crew_id uuid, link_id uuid, group_ids uuid[])
language sql
stable
security definer
set search_path = public
as $$
  with link_peers as (
    select
      case when l.requester_crew_id = p_viewer then l.addressee_crew_id else l.requester_crew_id end as crew_id,
      l.id as link_id
    from public.crew_room_links l
    where l.status = 'approved'
      and p_viewer in (l.requester_crew_id, l.addressee_crew_id)
  ),
  group_peers as (
    select mo.crew_id, array_agg(distinct mo.group_id) as group_ids
    from public.crew_room_group_members mv
    join public.crew_room_group_members mo
      on mo.group_id = mv.group_id and mo.crew_id <> p_viewer
    where mv.crew_id = p_viewer
    group by mo.crew_id
  )
  select
    coalesce(lp.crew_id, gp.crew_id) as crew_id,
    lp.link_id,
    coalesce(gp.group_ids, '{}'::uuid[]) as group_ids
  from link_peers lp
  full join group_peers gp on gp.crew_id = lp.crew_id;
$$;

/** What p_owner shares with p_viewer, after subscription / invisible / override rules. */
create or replace function public.crew_room_effective_level(p_owner uuid, p_viewer uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_default text;
  v_invisible boolean;
  v_override text;
  v_linked boolean;
  v_group_best integer;
  v_best integer := 0;
begin
  if p_owner is null or p_viewer is null then
    return 'hidden';
  end if;
  if p_owner = p_viewer then
    return 'full';
  end if;

  select p.default_level, p.invisible into v_default, v_invisible
  from public.crew_room_prefs p
  where p.crew_id = p_owner;
  v_default := coalesce(v_default, 'availability');
  if coalesce(v_invisible, false) then
    return 'hidden';
  end if;

  v_linked := exists (
    select 1 from public.crew_room_links l
    where l.status = 'approved'
      and ((l.requester_crew_id = p_owner and l.addressee_crew_id = p_viewer)
        or (l.requester_crew_id = p_viewer and l.addressee_crew_id = p_owner))
  );

  select max(public.crew_room_level_rank(coalesce(mo.share_level, v_default)))
  into v_group_best
  from public.crew_room_group_members mo
  join public.crew_room_group_members mv
    on mv.group_id = mo.group_id and mv.crew_id = p_viewer
  where mo.crew_id = p_owner;

  if not v_linked and v_group_best is null then
    return 'hidden';
  end if;

  if not public.crew_has_active_subscription(p_owner)
     or not public.crew_has_active_subscription(p_viewer)
  then
    return 'hidden';
  end if;

  select s.level into v_override
  from public.crew_room_shares s
  where s.owner_crew_id = p_owner and s.viewer_crew_id = p_viewer;
  if v_override is not null then
    return v_override;
  end if;

  if v_linked then
    v_best := public.crew_room_level_rank(v_default);
  end if;
  v_best := greatest(v_best, coalesce(v_group_best, 0));
  return public.crew_room_level_name(v_best);
end;
$$;

/**
 * Day grid for p_viewer: self + contacts, redacted by level.
 * status (raw): flying | layover | standby | duty | off | free | unknown
 * availability level collapses flying/standby/duty → busy and hides stations/flights.
 */
create or replace function public.crew_room_days_for(p_viewer uuid, p_from date, p_to date)
returns table (
  crew_id uuid,
  day date,
  level text,
  status text,
  stations text[],
  flights jsonb
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
  has_rows as (
    select distinct c.crew_id from classed c where c.cls <> 'skip'
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
        when exists (select 1 from has_rows hr where hr.crew_id = a.crew_id) then 'free'
        else 'unknown'
      end as raw_status
    from agg a
    left join lateral (
      select array_agg(distinct l2.station) as stations
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
    case when s.level = 'full' then s.fl else '[]'::jsonb end as flights
  from shaped s
  order by s.crew_id, s.d;
end;
$$;

revoke all on function public.crew_room_level_rank(text) from public, anon, authenticated;
revoke all on function public.crew_room_level_name(integer) from public, anon, authenticated;
revoke all on function public.crew_room_my_crew_id() from public, anon, authenticated;
revoke all on function public.crew_room_new_code() from public, anon, authenticated;
revoke all on function public.crew_room_ensure_prefs(uuid) from public, anon, authenticated;
revoke all on function public.crew_room_classify(text, text, text) from public, anon, authenticated;
revoke all on function public.crew_room_contacts(uuid) from public, anon, authenticated;
revoke all on function public.crew_room_effective_level(uuid, uuid) from public, anon, authenticated;
revoke all on function public.crew_room_days_for(uuid, date, date) from public, anon, authenticated;
grant execute on function public.crew_room_days_for(uuid, date, date) to service_role;
grant execute on function public.crew_room_effective_level(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Client RPCs
-- ---------------------------------------------------------------------------

create or replace function public.crew_room_require_crew()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_me := public.crew_room_my_crew_id();
  if v_me is null then
    raise exception 'crew_only';
  end if;
  return v_me;
end;
$$;

revoke all on function public.crew_room_require_crew() from public, anon, authenticated;

create or replace function public.crew_room_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_prefs public.crew_room_prefs;
  v_status public.crew_room_status;
  v_result jsonb;
begin
  v_prefs := public.crew_room_ensure_prefs(v_me);
  select * into v_status from public.crew_room_status s where s.crew_id = v_me and s.expires_at > now();

  select jsonb_build_object(
    'me', jsonb_build_object(
      'crew_id', v_me,
      'name', (select pr.full_name from public.crew_profiles cp join public.profiles pr on pr.id = cp.user_id where cp.id = v_me),
      'has_access', public.crew_has_active_subscription(v_me),
      'room_code', v_prefs.room_code,
      'default_level', v_prefs.default_level,
      'invisible', v_prefs.invisible,
      'notify_shared_off', v_prefs.notify_shared_off,
      'notify_layover', v_prefs.notify_layover,
      'status_note', v_status.note,
      'status_expires_at', v_status.expires_at
    ),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'crew_id', c.crew_id,
        'name', pr.full_name,
        'avatar_url', pr.avatar_url,
        'airline_icao', cp.airline_icao,
        'home_base', cp.home_base_iata,
        'link_id', c.link_id,
        'group_ids', to_jsonb(c.group_ids),
        'has_access', public.crew_has_active_subscription(c.crew_id),
        'their_level', public.crew_room_effective_level(c.crew_id, v_me),
        'my_level', public.crew_room_effective_level(v_me, c.crew_id),
        'my_override', (select s.level from public.crew_room_shares s where s.owner_crew_id = v_me and s.viewer_crew_id = c.crew_id),
        'status_note', (
          select st.note from public.crew_room_status st
          where st.crew_id = c.crew_id and st.expires_at > now()
            and public.crew_room_effective_level(c.crew_id, v_me) <> 'hidden'
        )
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
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'is_owner', g.owner_crew_id = v_me,
        'join_code', case when g.owner_crew_id = v_me then g.join_code else null end,
        'member_count', (select count(*) from public.crew_room_group_members m2 where m2.group_id = g.id),
        'my_share_level', m.share_level
      ) order by lower(g.name))
      from public.crew_room_group_members m
      join public.crew_room_groups g on g.id = m.group_id
      where m.crew_id = v_me
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.crew_room_days(p_from date, p_to date)
returns table (
  crew_id uuid,
  day date,
  level text,
  status text,
  stations text[],
  flights jsonb
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

/** Add a contact by email or code. A group code joins that group directly. */
create or replace function public.crew_room_request(p_email text default null, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_target uuid;
  v_group public.crew_room_groups;
  v_link public.crew_room_links;
  v_recent integer;
begin
  if not public.crew_has_active_subscription(v_me) then
    raise exception 'subscription_required';
  end if;

  select count(*) into v_recent
  from public.crew_room_links l
  where l.requester_crew_id = v_me and l.created_at > now() - interval '1 day';
  if v_recent >= 30 then
    raise exception 'rate_limited';
  end if;

  if v_code <> '' then
    select * into v_group from public.crew_room_groups g where g.join_code = v_code;
    if v_group.id is not null then
      if (select count(*) from public.crew_room_group_members m where m.group_id = v_group.id) >= 200 then
        raise exception 'group_full';
      end if;
      insert into public.crew_room_group_members (group_id, crew_id)
      values (v_group.id, v_me)
      on conflict do nothing;
      return jsonb_build_object('result', 'joined_group', 'group_id', v_group.id, 'group_name', v_group.name);
    end if;
    select p.crew_id into v_target from public.crew_room_prefs p where p.room_code = v_code;
  elsif v_email <> '' then
    select cp.id into v_target
    from auth.users u
    join public.crew_profiles cp on cp.user_id = u.id
    where lower(u.email) = v_email
    limit 1;
  else
    raise exception 'email_or_code_required';
  end if;

  if v_target is null then
    return jsonb_build_object('result', 'not_found');
  end if;
  if v_target = v_me then
    return jsonb_build_object('result', 'self');
  end if;

  select * into v_link
  from public.crew_room_links l
  where least(l.requester_crew_id, l.addressee_crew_id) = least(v_me, v_target)
    and greatest(l.requester_crew_id, l.addressee_crew_id) = greatest(v_me, v_target)
  for update;

  if v_link.id is null then
    insert into public.crew_room_links (requester_crew_id, addressee_crew_id)
    values (v_me, v_target)
    returning * into v_link;
    return jsonb_build_object('result', 'requested', 'link_id', v_link.id);
  end if;

  if v_link.status = 'approved' then
    return jsonb_build_object('result', 'already_connected', 'link_id', v_link.id);
  end if;

  if v_link.status = 'pending' then
    if v_link.requester_crew_id = v_me then
      return jsonb_build_object('result', 'already_requested', 'link_id', v_link.id);
    end if;
    update public.crew_room_links
    set status = 'approved', responded_at = now(), updated_at = now()
    where id = v_link.id;
    return jsonb_build_object('result', 'connected', 'link_id', v_link.id);
  end if;

  update public.crew_room_links
  set requester_crew_id = v_me,
      addressee_crew_id = v_target,
      status = 'pending',
      created_at = now(),
      responded_at = null,
      updated_at = now()
  where id = v_link.id;
  return jsonb_build_object('result', 'requested', 'link_id', v_link.id);
end;
$$;

create or replace function public.crew_room_respond(p_link_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_count integer;
begin
  update public.crew_room_links
  set status = case when p_accept then 'approved' else 'declined' end,
      responded_at = now(),
      updated_at = now()
  where id = p_link_id
    and addressee_crew_id = v_me
    and status = 'pending';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'request_not_found';
  end if;
  return case when p_accept then 'approved' else 'declined' end;
end;
$$;

/** Either side ends the contact (or cancels own pending request). */
create or replace function public.crew_room_remove(p_link_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_link public.crew_room_links;
begin
  select * into v_link
  from public.crew_room_links l
  where l.id = p_link_id and v_me in (l.requester_crew_id, l.addressee_crew_id)
  for update;
  if v_link.id is null then
    raise exception 'link_not_found';
  end if;

  update public.crew_room_links
  set status = 'removed', updated_at = now()
  where id = v_link.id;

  delete from public.crew_room_shares s
  where (s.owner_crew_id = v_link.requester_crew_id and s.viewer_crew_id = v_link.addressee_crew_id)
     or (s.owner_crew_id = v_link.addressee_crew_id and s.viewer_crew_id = v_link.requester_crew_id);
  return 'removed';
end;
$$;

/** Per-person override; p_level null clears it. */
create or replace function public.crew_room_set_share(p_viewer_crew_id uuid, p_level text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
begin
  if p_viewer_crew_id is null or p_viewer_crew_id = v_me then
    raise exception 'invalid_viewer';
  end if;
  if not exists (select 1 from public.crew_room_contacts(v_me) c where c.crew_id = p_viewer_crew_id) then
    raise exception 'not_connected';
  end if;
  if p_level is null then
    delete from public.crew_room_shares s where s.owner_crew_id = v_me and s.viewer_crew_id = p_viewer_crew_id;
    return 'cleared';
  end if;
  if p_level not in ('hidden', 'availability', 'destination', 'full') then
    raise exception 'invalid_level';
  end if;
  insert into public.crew_room_shares (owner_crew_id, viewer_crew_id, level)
  values (v_me, p_viewer_crew_id, p_level)
  on conflict (owner_crew_id, viewer_crew_id)
  do update set level = excluded.level, updated_at = now();
  return p_level;
end;
$$;

create or replace function public.crew_room_update_prefs(
  p_default_level text default null,
  p_invisible boolean default null,
  p_notify_shared_off boolean default null,
  p_notify_layover boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_row public.crew_room_prefs;
begin
  if p_default_level is not null and p_default_level not in ('hidden', 'availability', 'destination', 'full') then
    raise exception 'invalid_level';
  end if;
  perform public.crew_room_ensure_prefs(v_me);
  update public.crew_room_prefs p
  set default_level = coalesce(p_default_level, p.default_level),
      invisible = coalesce(p_invisible, p.invisible),
      notify_shared_off = coalesce(p_notify_shared_off, p.notify_shared_off),
      notify_layover = coalesce(p_notify_layover, p.notify_layover),
      updated_at = now()
  where p.crew_id = v_me
  returning * into v_row;
  return jsonb_build_object(
    'default_level', v_row.default_level,
    'invisible', v_row.invisible,
    'notify_shared_off', v_row.notify_shared_off,
    'notify_layover', v_row.notify_layover
  );
end;
$$;

create or replace function public.crew_room_regenerate_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_code text;
begin
  perform public.crew_room_ensure_prefs(v_me);
  v_code := public.crew_room_new_code();
  update public.crew_room_prefs set room_code = v_code, updated_at = now() where crew_id = v_me;
  return v_code;
end;
$$;

/** Empty note clears; note lives 1–72 hours (default 24). */
create or replace function public.crew_room_set_status(p_note text, p_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_note text := btrim(coalesce(p_note, ''));
  v_expires timestamptz;
begin
  if v_note = '' then
    delete from public.crew_room_status where crew_id = v_me;
    return jsonb_build_object('status_note', null, 'status_expires_at', null);
  end if;
  if char_length(v_note) > 140 then
    v_note := left(v_note, 140);
  end if;
  v_expires := now() + make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 72));
  insert into public.crew_room_status (crew_id, note, expires_at)
  values (v_me, v_note, v_expires)
  on conflict (crew_id) do update set note = excluded.note, expires_at = excluded.expires_at, updated_at = now();
  return jsonb_build_object('status_note', v_note, 'status_expires_at', v_expires);
end;
$$;

create or replace function public.crew_room_create_group(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_name text := btrim(coalesce(p_name, ''));
  v_group public.crew_room_groups;
begin
  if not public.crew_has_active_subscription(v_me) then
    raise exception 'subscription_required';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;
  if (select count(*) from public.crew_room_groups g where g.owner_crew_id = v_me) >= 20 then
    raise exception 'too_many_groups';
  end if;
  insert into public.crew_room_groups (owner_crew_id, name, join_code)
  values (v_me, v_name, public.crew_room_new_code())
  returning * into v_group;
  insert into public.crew_room_group_members (group_id, crew_id) values (v_group.id, v_me);
  return jsonb_build_object('id', v_group.id, 'name', v_group.name, 'join_code', v_group.join_code);
end;
$$;

/** Owner leaving deletes the group. */
create or replace function public.crew_room_leave_group(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
begin
  if exists (select 1 from public.crew_room_groups g where g.id = p_group_id and g.owner_crew_id = v_me) then
    delete from public.crew_room_groups where id = p_group_id;
    return 'deleted';
  end if;
  delete from public.crew_room_group_members where group_id = p_group_id and crew_id = v_me;
  return 'left';
end;
$$;

create or replace function public.crew_room_remove_group_member(p_group_id uuid, p_crew_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
begin
  if not exists (select 1 from public.crew_room_groups g where g.id = p_group_id and g.owner_crew_id = v_me) then
    raise exception 'not_group_owner';
  end if;
  if p_crew_id = v_me then
    raise exception 'owner_cannot_be_removed';
  end if;
  delete from public.crew_room_group_members where group_id = p_group_id and crew_id = p_crew_id;
  return 'removed';
end;
$$;

/** Member's level inside a group; null = default_level. */
create or replace function public.crew_room_set_group_share(p_group_id uuid, p_level text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_count integer;
begin
  if p_level is not null and p_level not in ('hidden', 'availability', 'destination', 'full') then
    raise exception 'invalid_level';
  end if;
  update public.crew_room_group_members
  set share_level = p_level
  where group_id = p_group_id and crew_id = v_me;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'not_group_member';
  end if;
  return coalesce(p_level, 'default');
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.crew_room_overview()',
    'public.crew_room_days(date, date)',
    'public.crew_room_request(text, text)',
    'public.crew_room_respond(uuid, boolean)',
    'public.crew_room_remove(uuid)',
    'public.crew_room_set_share(uuid, text)',
    'public.crew_room_update_prefs(text, boolean, boolean, boolean)',
    'public.crew_room_regenerate_code()',
    'public.crew_room_set_status(text, integer)',
    'public.crew_room_create_group(text)',
    'public.crew_room_leave_group(uuid)',
    'public.crew_room_remove_group_member(uuid, uuid)',
    'public.crew_room_set_group_share(uuid, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
