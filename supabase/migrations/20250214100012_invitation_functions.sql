-- send_crew_invitation: crew invites family member by email
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

  v_email := lower(trim(p_family_email));
  if v_email = '' then
    raise exception 'Email is required';
  end if;

  -- Create invitation (allow resend if previous was declined)
  insert into public.crew_invitations (crew_id, family_email, status)
  values (v_crew_id, v_email, 'pending')
  returning * into v_inv;

  return v_inv;
end;
$$;

comment on function public.send_crew_invitation is 'Crew sends invitation to family by email';

-- accept_crew_invitation: family accepts invitation
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

  -- Create connection as approved (invitation = explicit invite, no crew approval needed)
  insert into public.family_connections (crew_id, family_id, status)
  values (v_inv.crew_id, auth.uid(), 'approved')
  on conflict (crew_id, family_id) do update set status = 'approved'
  returning * into v_conn;

  update public.crew_invitations set status = 'accepted' where id = p_invitation_id;

  -- Create default notification preferences
  insert into public.notification_preferences (user_id, connection_id)
  values (auth.uid(), v_conn.id)
  on conflict (user_id, connection_id) do nothing;

  return v_conn;
end;
$$;

comment on function public.accept_crew_invitation is 'Family accepts crew invitation';

-- decline_crew_invitation: family declines invitation
create or replace function public.decline_crew_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.crew_invitations;
begin
  update public.crew_invitations
  set status = 'declined'
  where id = p_invitation_id
    and status = 'pending'
    and lower(trim(family_email)) = lower(trim(public.current_user_email()));

  if not found then
    raise exception 'Invitation not found or already responded';
  end if;
end;
$$;

comment on function public.decline_crew_invitation is 'Family declines crew invitation';
