-- Uçuş listesinde hangi görev türlerinin gösterileceği (crew tercihi).
alter table public.crew_profiles
  add column if not exists roster_list_show jsonb default '{
    "off_days": true,
    "training": true,
    "simulator": true,
    "other": true
  }'::jsonb;

comment on column public.crew_profiles.roster_list_show is 'Roster filters: off_days (FSF/FOF), training, simulator, other. Defaults all true.';

update public.crew_profiles
set roster_list_show = '{
  "off_days": true,
  "training": true,
  "simulator": true,
  "other": true
}'::jsonb
where roster_list_show is null;
