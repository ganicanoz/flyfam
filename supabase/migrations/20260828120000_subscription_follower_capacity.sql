-- Follower-based subscription capacity:
-- - Capacity belongs to roster-owning crew (not viewers).
-- - Counts approved family_connections + approved crew_peer_links on peer_crew_id.
-- - Pending invites/links do not consume capacity.
-- - Roster visibility for followers requires owner's active/trial subscription (links kept on lapse).

create or replace function public.crew_has_active_subscription(p_crew_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crew_subscriptions s
    join public.app_subscription_plans p on p.code = s.plan_code
    where s.crew_id = p_crew_id
      and s.status in ('trialing', 'active')
      and p.active = true
  );
$$;

comment on function public.crew_has_active_subscription(uuid) is
  'True when crew has trialing or active subscription on an active plan.';

create or replace function public.count_crew_approved_followers(p_crew_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(count(*)::integer, 0)
  from (
    select fc.family_id as viewer_user_id
    from public.family_connections fc
    where fc.crew_id = p_crew_id
      and fc.status = 'approved'
    union all
    select cpl.follower_user_id as viewer_user_id
    from public.crew_peer_links cpl
    where cpl.peer_crew_id = p_crew_id
      and cpl.status = 'approved'
  ) viewers
  where viewers.viewer_user_id is distinct from (
    select cp.user_id
    from public.crew_profiles cp
    where cp.id = p_crew_id
    limit 1
  );
$$;

comment on function public.count_crew_approved_followers(uuid) is
  'Approved followers (family + crew peer) viewing roster owner; excludes self.';

create or replace function public.ensure_crew_family_capacity(
  p_crew_id uuid,
  p_include_pending boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_family integer;
  v_extra_slots integer;
  v_max_family integer;
  v_used integer;
begin
  select p.max_family_members, s.extra_family_slots
    into v_base_family, v_extra_slots
  from public.crew_subscriptions s
  join public.app_subscription_plans p on p.code = s.plan_code
  where s.crew_id = p_crew_id
    and s.status in ('trialing', 'active')
    and p.active = true
  order by s.updated_at desc
  limit 1;

  if v_base_family is null then
    raise exception 'No active subscription plan for this crew';
  end if;

  v_max_family := coalesce(v_base_family, 0) + coalesce(v_extra_slots, 0);
  v_used := public.count_crew_approved_followers(p_crew_id);

  if coalesce(v_used, 0) >= v_max_family then
    raise exception 'Follower limit reached for current plan';
  end if;
end;
$$;

comment on function public.ensure_crew_family_capacity(uuid, boolean) is
  'Raises when roster owner has no active plan or approved follower count is at capacity. Pending links are ignored.';

create or replace function public.get_my_subscription_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_crew_id uuid;
  v_plan_code text;
  v_plan_title text;
  v_status text;
  v_trial_ends_at timestamptz;
  v_period_ends_at timestamptz;
  v_base_family integer;
  v_extra_slot_price numeric;
  v_max_extra_family integer;
  v_extra_family_slots integer := 0;
  v_total_family integer;
  v_used_approved integer := 0;
  v_used_pending integer := 0;
  v_access boolean := false;
begin
  select role into v_role
  from public.profiles
  where id = v_uid;

  if v_role is null then
    return jsonb_build_object(
      'role', null,
      'has_access', false
    );
  end if;

  if v_role = 'crew' then
    select cp.id into v_crew_id
    from public.crew_profiles cp
    where cp.user_id = v_uid;
  else
    select fc.crew_id into v_crew_id
    from public.family_connections fc
    where fc.family_id = v_uid
      and fc.status = 'approved'
    order by fc.updated_at desc nulls last, fc.created_at desc
    limit 1;
  end if;

  if v_crew_id is not null then
    select
      s.plan_code,
      p.title,
      s.status,
      s.trial_ends_at,
      s.current_period_ends_at,
      p.max_family_members,
      p.max_extra_family_members,
      p.extra_family_member_price_usd,
      s.extra_family_slots
    into
      v_plan_code,
      v_plan_title,
      v_status,
      v_trial_ends_at,
      v_period_ends_at,
      v_base_family,
      v_max_extra_family,
      v_extra_slot_price,
      v_extra_family_slots
    from public.crew_subscriptions s
    join public.app_subscription_plans p on p.code = s.plan_code
    where s.crew_id = v_crew_id
      and p.active = true
    order by s.updated_at desc
    limit 1;
  end if;

  v_total_family := coalesce(v_base_family, 0) + coalesce(v_extra_family_slots, 0);

  if v_crew_id is not null then
    v_used_approved := public.count_crew_approved_followers(v_crew_id);

    select count(*) into v_used_pending
    from public.family_connections fc
    where fc.crew_id = v_crew_id
      and fc.status = 'pending';

    v_used_pending := coalesce(v_used_pending, 0) + coalesce((
      select count(*)::integer
      from public.crew_peer_links cpl
      where cpl.peer_crew_id = v_crew_id
        and cpl.status = 'pending'
    ), 0);
  end if;

  v_access := (v_status in ('trialing', 'active'));

  return jsonb_build_object(
    'role', v_role,
    'crew_id', v_crew_id,
    'plan_code', v_plan_code,
    'plan_title', v_plan_title,
    'subscription_status', v_status,
    'trial_ends_at', v_trial_ends_at,
    'current_period_ends_at', v_period_ends_at,
    'base_family_members', v_base_family,
    'extra_family_slots', coalesce(v_extra_family_slots, 0),
    'max_extra_family_members', coalesce(v_max_extra_family, 0),
    'extra_family_member_price_usd', v_extra_slot_price,
    'max_family_members', v_total_family,
    'used_family_approved', v_used_approved,
    'used_family_pending', v_used_pending,
    'available_family_slots', greatest(coalesce(v_total_family, 0) - coalesce(v_used_approved, 0), 0),
    'can_invite_more', (coalesce(v_total_family, 0) > coalesce(v_used_approved, 0)),
    'has_access', v_access
  );
end;
$$;

create or replace function public.get_crew_roster_access(p_crew_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan_title text;
  v_status text;
  v_has_link boolean := false;
begin
  if v_uid is null or p_crew_id is null then
    return jsonb_build_object('has_access', false, 'subscription_status', null, 'plan_title', null);
  end if;

  select exists (
    select 1 from public.crew_profiles cp where cp.id = p_crew_id and cp.user_id = v_uid
  ) into v_has_link;

  if not v_has_link then
    select exists (
      select 1
      from public.family_connections fc
      where fc.crew_id = p_crew_id
        and fc.family_id = v_uid
        and fc.status = 'approved'
    ) into v_has_link;
  end if;

  if not v_has_link then
    select exists (
      select 1
      from public.crew_peer_links cpl
      where cpl.peer_crew_id = p_crew_id
        and cpl.follower_user_id = v_uid
        and cpl.status = 'approved'
    ) into v_has_link;
  end if;

  if not v_has_link then
    return jsonb_build_object('has_access', false, 'subscription_status', null, 'plan_title', null);
  end if;

  select p.title, s.status
    into v_plan_title, v_status
  from public.crew_subscriptions s
  join public.app_subscription_plans p on p.code = s.plan_code
  where s.crew_id = p_crew_id
    and p.active = true
  order by s.updated_at desc
  limit 1;

  return jsonb_build_object(
    'has_access', public.crew_has_active_subscription(p_crew_id),
    'subscription_status', v_status,
    'plan_title', v_plan_title
  );
end;
$$;

comment on function public.get_crew_roster_access(uuid) is
  'Roster visibility for a linked viewer based on roster owner subscription (not viewer subscription).';

-- Invitation / approval flows: enforce capacity on roster owner.
create or replace function public.send_crew_invitation(p_family_email text)
returns public.crew_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_email text;
  v_inv public.crew_invitations;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    raise exception 'User is not a crew member';
  end if;

  perform public.ensure_crew_family_capacity(v_crew_id, false);

  v_email := lower(trim(p_family_email));
  if v_email = '' then
    raise exception 'Email is required';
  end if;

  insert into public.crew_invitations (crew_id, family_email, status)
  values (v_crew_id, v_email, 'pending')
  returning * into v_inv;

  return v_inv;
end;
$$;

create or replace function public.accept_crew_invitation(p_invitation_id uuid)
returns public.family_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.crew_invitations;
  v_conn public.family_connections;
begin
  select * into v_inv from public.crew_invitations
  where id = p_invitation_id
    and status = 'pending'
    and lower(trim(family_email)) = lower(trim(public.current_user_email()));

  if v_inv is null then
    raise exception 'Invitation not found or already responded';
  end if;

  perform public.ensure_crew_family_capacity(v_inv.crew_id, false);

  insert into public.family_connections (crew_id, family_id, status)
  values (v_inv.crew_id, auth.uid(), 'approved')
  on conflict (crew_id, family_id) do update set status = 'approved'
  returning * into v_conn;

  update public.crew_invitations set status = 'accepted' where id = p_invitation_id;

  insert into public.notification_preferences (user_id, connection_id)
  values (auth.uid(), v_conn.id)
  on conflict (user_id, connection_id) do nothing;

  return v_conn;
end;
$$;

create or replace function public.generate_invite_code(
  p_expires_hours int default 168
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_code text;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    raise exception 'User is not a crew member';
  end if;

  perform public.ensure_crew_family_capacity(v_crew_id, false);

  v_code := 'FLYF-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4)) || '-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4));

  insert into public.invite_codes (crew_id, code, expires_at)
  values (v_crew_id, v_code, now() + (p_expires_hours || ' hours')::interval);

  return v_code;
end;
$$;

create or replace function public.request_crew_peer_follow(p_peer_crew_id uuid)
returns public.crew_peer_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_follower uuid := auth.uid();
  v_own_crew uuid;
  v_link public.crew_peer_links;
begin
  if v_follower is null then
    raise exception 'Not authenticated';
  end if;

  select cp.id into v_own_crew
  from public.crew_profiles cp
  where cp.user_id = v_follower;

  if v_own_crew is not null and v_own_crew = p_peer_crew_id then
    raise exception 'Cannot follow your own roster';
  end if;

  if not exists (select 1 from public.crew_profiles where id = p_peer_crew_id) then
    raise exception 'Crew not found';
  end if;

  insert into public.crew_peer_links (follower_user_id, peer_crew_id, status)
  values (v_follower, p_peer_crew_id, 'pending')
  on conflict (follower_user_id, peer_crew_id) do update
    set status = case
      when public.crew_peer_links.status = 'revoked' then 'pending'
      else public.crew_peer_links.status
    end
  returning * into v_link;

  return v_link;
end;
$$;

create or replace function public.approve_crew_peer_follow(p_link_id uuid)
returns public.crew_peer_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.crew_peer_links;
begin
  select * into v_link
  from public.crew_peer_links cpl
  where cpl.id = p_link_id
    and cpl.status = 'pending'
    and cpl.peer_crew_id in (
      select cp.id from public.crew_profiles cp where cp.user_id = auth.uid()
    )
  limit 1;

  if v_link is null then
    raise exception 'Follow request not found or not pending';
  end if;

  perform public.ensure_crew_family_capacity(v_link.peer_crew_id, false);

  update public.crew_peer_links
  set status = 'approved'
  where id = p_link_id
  returning * into v_link;

  return v_link;
end;
$$;

-- Roster visibility: suspend when owner subscription lapses; keep links intact.
drop policy if exists "Crew and family can read flights via flight_crew" on public.flights;
create policy "Crew and family can read flights via flight_crew"
  on public.flights for select
  using (
    exists (
      select 1
      from public.flight_crew fc
      where fc.flight_id = flights.id
        and (
          fc.crew_id in (select id from public.crew_profiles where user_id = auth.uid())
          or (
            exists (
              select 1
              from public.family_connections fc2
              where fc2.crew_id = fc.crew_id
                and fc2.family_id = auth.uid()
                and fc2.status = 'approved'
            )
            and public.crew_has_active_subscription(fc.crew_id)
          )
          or (
            exists (
              select 1
              from public.crew_peer_links cpl
              where cpl.peer_crew_id = fc.crew_id
                and cpl.follower_user_id = auth.uid()
                and cpl.status = 'approved'
            )
            and public.crew_has_active_subscription(fc.crew_id)
          )
        )
    )
  );

drop policy if exists "Family can read flight_crew of connections" on public.flight_crew;
create policy "Family can read flight_crew of connections"
  on public.flight_crew for select
  using (
    crew_id in (select id from public.crew_profiles where user_id = auth.uid())
    or (
      exists (
        select 1
        from public.family_connections fc
        where fc.crew_id = flight_crew.crew_id
          and fc.family_id = auth.uid()
          and fc.status = 'approved'
      )
      and public.crew_has_active_subscription(flight_crew.crew_id)
    )
    or (
      exists (
        select 1
        from public.crew_peer_links cpl
        where cpl.peer_crew_id = flight_crew.crew_id
          and cpl.follower_user_id = auth.uid()
          and cpl.status = 'approved'
      )
      and public.crew_has_active_subscription(flight_crew.crew_id)
    )
  );

drop policy if exists "Peer crew can read linked flight_crew" on public.flight_crew;
drop policy if exists "Peer crew can read linked flights" on public.flights;
