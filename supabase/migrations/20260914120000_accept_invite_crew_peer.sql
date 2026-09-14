-- Email invite accept: if invitee is crew, create approved crew_peer_link
-- (crew↔crew). Family invitees keep family_connections path.

create or replace function public.accept_crew_invitation(p_invitation_id uuid)
returns public.family_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.crew_invitations;
  v_conn public.family_connections;
  v_own_crew uuid;
begin
  select * into v_inv from public.crew_invitations
  where id = p_invitation_id
    and status = 'pending'
    and lower(trim(family_email)) = lower(trim(public.current_user_email()));

  if v_inv is null then
    raise exception 'Invitation not found or already responded';
  end if;

  select cp.id into v_own_crew
  from public.crew_profiles cp
  where cp.user_id = auth.uid();

  -- Crew invitee → follow inviter's roster via peer link (not family_connections).
  if v_own_crew is not null then
    if v_own_crew = v_inv.crew_id then
      raise exception 'Cannot accept an invitation to your own roster';
    end if;

    perform public.ensure_crew_family_capacity(v_inv.crew_id, false);

    insert into public.crew_peer_links (follower_user_id, peer_crew_id, status)
    values (auth.uid(), v_inv.crew_id, 'approved')
    on conflict (follower_user_id, peer_crew_id) do update
      set status = 'approved'
      where public.crew_peer_links.status is distinct from 'approved';

    update public.crew_invitations set status = 'accepted' where id = p_invitation_id;

    return null;
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

comment on function public.accept_crew_invitation(uuid) is
  'Accept email invite: family → family_connections; crew → approved crew_peer_links.';

-- List approved peers the caller follows (names via security definer; avoids RLS recursion).
create or replace function public.get_my_approved_crew_peers()
returns table (
  link_id uuid,
  peer_crew_id uuid,
  peer_user_id uuid,
  peer_full_name text,
  company_name text,
  airline_icao text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cpl.id as link_id,
    cpl.peer_crew_id,
    cp.user_id as peer_user_id,
    p.full_name as peer_full_name,
    cp.company_name,
    cp.airline_icao
  from public.crew_peer_links cpl
  join public.crew_profiles cp on cp.id = cpl.peer_crew_id
  left join public.profiles p on p.id = cp.user_id
  where cpl.follower_user_id = auth.uid()
    and cpl.status = 'approved'
  order by coalesce(p.full_name, cp.company_name, cp.airline_icao, cp.id::text);
$$;

comment on function public.get_my_approved_crew_peers() is
  'Approved crew peers the current user follows, with display names.';

grant execute on function public.get_my_approved_crew_peers() to authenticated;
grant execute on function public.accept_crew_invitation(uuid) to authenticated;

-- Pending email invites addressed to the current user (crew or family), with inviter name.
create or replace function public.get_my_pending_crew_invitations()
returns table (
  id uuid,
  crew_id uuid,
  family_email text,
  crew_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    inv.id,
    inv.crew_id,
    inv.family_email,
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(cp.company_name), ''), 'Crew') as crew_name
  from public.crew_invitations inv
  join public.crew_profiles cp on cp.id = inv.crew_id
  left join public.profiles p on p.id = cp.user_id
  where inv.status = 'pending'
    and lower(trim(inv.family_email)) = lower(trim(public.current_user_email()))
  order by inv.created_at desc;
$$;

comment on function public.get_my_pending_crew_invitations() is
  'Pending crew_invitations for the signed-in email, with inviter display name.';

grant execute on function public.get_my_pending_crew_invitations() to authenticated;
