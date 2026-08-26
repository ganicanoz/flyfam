alter table public.crew_profiles
  add column if not exists home_base_iata text,
  add column if not exists home_base_city text;

create or replace function public.create_crew_profile(
  p_company_name text default null,
  p_time_preference text default 'local',
  p_airline_icao text default null,
  p_home_base_iata text default null,
  p_home_base_city text default null
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

  insert into public.crew_profiles (user_id, company_name, time_preference, airline_icao, home_base_iata, home_base_city)
  values (auth.uid(), p_company_name, p_time_preference, p_airline_icao, p_home_base_iata, p_home_base_city)
  on conflict (user_id) do update set
    company_name = excluded.company_name,
    time_preference = excluded.time_preference,
    airline_icao = excluded.airline_icao,
    home_base_iata = excluded.home_base_iata,
    home_base_city = excluded.home_base_city
  returning * into v_crew;

  return v_crew;
end;
$$;

comment on function public.create_crew_profile(text, text, text, text, text)
  is 'Create or update crew profile for auth user (idempotent on user_id), including home base fields.';

-- Seed explicit home base for existing test account.
update public.crew_profiles cp
set home_base_iata = 'SAW',
    home_base_city = 'Istanbul'
from public.profiles p
where cp.user_id = p.id
  and p.role = 'crew'
  and p.full_name ilike 'gani can oz%';
