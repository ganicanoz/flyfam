-- RPC: return family connections for current user with the other party's name (crew sees family names, family sees crew names).
-- Uses SECURITY DEFINER so names are readable without extra RLS on profiles.

create or replace function public.get_family_connections_with_names()
returns table (
  id uuid,
  family_id uuid,
  crew_id uuid,
  status text,
  other_name text,
  other_avatar_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Crew: my connections, show family member's name
  if exists (select 1 from public.crew_profiles where user_id = auth.uid()) then
    return query
    select
      fc.id,
      fc.family_id,
      fc.crew_id,
      fc.status,
      p.full_name::text as other_name,
      p.avatar_url::text as other_avatar_url
    from public.family_connections fc
    join public.profiles p on p.id = fc.family_id
    where fc.crew_id in (select cp.id from public.crew_profiles cp where cp.user_id = auth.uid());
    return;
  end if;

  -- Family: my approved connections, show crew's name
  return query
  select
    fc.id,
    fc.family_id,
    fc.crew_id,
    fc.status,
    p.full_name::text as other_name,
    p.avatar_url::text as other_avatar_url
  from public.family_connections fc
  join public.crew_profiles cp on cp.id = fc.crew_id
  join public.profiles p on p.id = cp.user_id
  where fc.family_id = auth.uid()
    and fc.status = 'approved';
end;
$$;

comment on function public.get_family_connections_with_names is 'Returns connections for current user (crew or family) with the other party display name';
