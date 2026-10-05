-- Crew Room is invite-only: person connections only by FlyFam email invitation.
-- Codes now only join groups; personal room codes no longer resolve to a person (column kept, unused).

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
    return jsonb_build_object('result', 'not_found');
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

revoke all on function public.crew_room_request(text, text) from public, anon;
grant execute on function public.crew_room_request(text, text) to authenticated, service_role;
