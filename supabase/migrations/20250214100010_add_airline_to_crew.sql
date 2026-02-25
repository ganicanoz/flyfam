-- Add airline_icao to crew_profiles for MVP (PGT, THY, SXS)
alter table public.crew_profiles
  add column if not exists airline_icao text;

comment on column public.crew_profiles.airline_icao is 'Airline ICAO code (PGT, THY, SXS) for MVP';

-- Update create_crew_profile to accept airline_icao
create or replace function public.create_crew_profile(
  p_company_name text default null,
  p_time_preference text default 'local',
  p_airline_icao text default null
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

  insert into public.crew_profiles (user_id, company_name, time_preference, airline_icao)
  values (auth.uid(), p_company_name, p_time_preference, p_airline_icao)
  returning * into v_crew;
  return v_crew;
end;
$$;
