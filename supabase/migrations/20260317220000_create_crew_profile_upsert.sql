-- Havayolu seçimi / kurulum tekrarlandığında INSERT ikinci kez unique ihlali vermesin.
-- crew_profiles.user_id tekil; mevcut satırı güncelle.

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
  on conflict (user_id) do update set
    company_name = excluded.company_name,
    time_preference = excluded.time_preference,
    airline_icao = excluded.airline_icao
  returning * into v_crew;

  return v_crew;
end;
$$;

comment on function public.create_crew_profile(text, text, text) is 'Create or update crew profile for auth user (idempotent on user_id).';
