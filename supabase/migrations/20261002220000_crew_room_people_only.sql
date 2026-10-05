-- Ekip Odası: only people, added by email invite.
-- Removes groups, personal room codes and status notes (all unused / empty when removed).

drop function if exists public.crew_room_create_group(text);
drop function if exists public.crew_room_leave_group(uuid);
drop function if exists public.crew_room_remove_group_member(uuid, uuid);
drop function if exists public.crew_room_set_group_share(uuid, text);
drop function if exists public.crew_room_regenerate_code();
drop function if exists public.crew_room_set_status(text, integer);
drop function if exists public.crew_room_request(text, text);

drop function if exists public.crew_room_contacts(uuid);

/** Everyone the viewer is connected to (approved links). */
create function public.crew_room_contacts(p_viewer uuid)
returns table (crew_id uuid, link_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when l.requester_crew_id = p_viewer then l.addressee_crew_id else l.requester_crew_id end as crew_id,
    l.id as link_id
  from public.crew_room_links l
  where l.status = 'approved'
    and p_viewer in (l.requester_crew_id, l.addressee_crew_id);
$$;

revoke all on function public.crew_room_contacts(uuid) from public, anon, authenticated;

/** What p_owner shares with p_viewer, after link / subscription / invisible / override rules. */
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
  if coalesce(v_invisible, false) then
    return 'hidden';
  end if;

  if not exists (
    select 1 from public.crew_room_links l
    where l.status = 'approved'
      and ((l.requester_crew_id = p_owner and l.addressee_crew_id = p_viewer)
        or (l.requester_crew_id = p_viewer and l.addressee_crew_id = p_owner))
  ) then
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
  return coalesce(v_override, v_default, 'availability');
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
  insert into public.crew_room_prefs (crew_id)
  values (p_crew_id)
  on conflict (crew_id) do nothing;
  select * into v_row from public.crew_room_prefs where crew_id = p_crew_id;
  return v_row;
end;
$$;

drop function if exists public.crew_room_new_code();

alter table public.crew_room_prefs drop column if exists room_code;
drop table if exists public.crew_room_group_members;
drop table if exists public.crew_room_groups;
drop table if exists public.crew_room_status;

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
      'invisible', v_prefs.invisible
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

/** Invite a crew member by email; they must accept. A pending invite from them is accepted instead. */
create function public.crew_room_request(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_me uuid := public.crew_room_require_crew();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_target uuid;
  v_link public.crew_room_links;
  v_recent integer;
begin
  if not public.crew_has_active_subscription(v_me) then
    raise exception 'subscription_required';
  end if;
  if v_email = '' then
    raise exception 'email_required';
  end if;

  select count(*) into v_recent
  from public.crew_room_links l
  where l.requester_crew_id = v_me and l.created_at > now() - interval '1 day';
  if v_recent >= 30 then
    raise exception 'rate_limited';
  end if;

  select cp.id into v_target
  from auth.users u
  join public.crew_profiles cp on cp.user_id = u.id
  where lower(u.email) = v_email
  limit 1;

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

revoke all on function public.crew_room_overview() from public, anon;
grant execute on function public.crew_room_overview() to authenticated, service_role;
revoke all on function public.crew_room_request(text) from public, anon;
grant execute on function public.crew_room_request(text) to authenticated, service_role;
