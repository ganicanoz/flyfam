-- create_profile: called by app after signup to create profile with role
create or replace function public.create_profile(
  p_role text,
  p_full_name text default null,
  p_phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  insert into public.profiles (id, role, full_name, phone)
  values (auth.uid(), p_role, p_full_name, p_phone)
  returning * into v_profile;
  return v_profile;
end;
$$;

comment on function public.create_profile is 'Create app profile after signup; role must be crew or family';

-- create_crew_profile: called when crew completes onboarding
create or replace function public.create_crew_profile(
  p_company_name text default null,
  p_time_preference text default 'local'
)
returns public.crew_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_crew public.crew_profiles;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile is null or v_profile.role != 'crew' then
    raise exception 'User must have crew role';
  end if;

  insert into public.crew_profiles (user_id, company_name, time_preference)
  values (auth.uid(), p_company_name, p_time_preference)
  returning * into v_crew;
  return v_crew;
end;
$$;

comment on function public.create_crew_profile is 'Create crew profile for crew user';

-- generate_invite_code: crew generates a code for family to connect
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

  v_code := 'FLYF-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4)) || '-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4));

  insert into public.invite_codes (crew_id, code, expires_at)
  values (v_crew_id, v_code, now() + (p_expires_hours || ' hours')::interval);

  return v_code;
end;
$$;

comment on function public.generate_invite_code is 'Generate invite code for family to connect; default 7 day expiry';

-- redeem_invite_code: family uses code to request connection
create or replace function public.redeem_invite_code(p_code text)
returns public.family_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes;
  v_profile public.profiles;
  v_conn public.family_connections;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile is null or v_profile.role != 'family' then
    raise exception 'User must have family role';
  end if;

  select * into v_invite from public.invite_codes
  where upper(trim(code)) = upper(trim(p_code))
    and used_at is null
    and (expires_at is null or expires_at > now());

  if v_invite is null then
    raise exception 'Invalid or expired invite code';
  end if;

  -- Create or get existing connection (idempotent)
  insert into public.family_connections (crew_id, family_id, status, invited_by)
  values (v_invite.crew_id, auth.uid(), 'pending', null)
  on conflict (crew_id, family_id) do update set status = 'pending'
  returning * into v_conn;

  -- Mark code as used
  update public.invite_codes
  set used_at = now(), used_by = auth.uid()
  where id = v_invite.id;

  return v_conn;
end;
$$;

comment on function public.redeem_invite_code is 'Family redeems invite code to request connection to crew';

-- approve_connection: crew approves a pending family connection
create or replace function public.approve_connection(p_connection_id uuid)
returns public.family_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn public.family_connections;
begin
  update public.family_connections
  set status = 'approved', updated_at = now()
  where id = p_connection_id
    and crew_id in (select id from public.crew_profiles where user_id = auth.uid())
    and status = 'pending'
  returning * into v_conn;

  if v_conn is null then
    raise exception 'Connection not found or not pending';
  end if;

  -- Create default notification preferences for the family user
  insert into public.notification_preferences (user_id, connection_id)
  values (v_conn.family_id, v_conn.id)
  on conflict (user_id, connection_id) do nothing;

  return v_conn;
end;
$$;

comment on function public.approve_connection is 'Crew approves a pending family connection';
