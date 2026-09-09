-- Human-friendly Custom ID on profiles: 00001, 00002, … (UUID auth id unchanged).

create sequence if not exists public.profiles_custom_id_seq
  as integer
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

alter table public.profiles
  add column if not exists custom_id text;

comment on column public.profiles.custom_id is
  'Admin-facing Custom ID: 5-digit zero-padded number starting at 00001';

create or replace function public.format_profile_custom_id(n integer)
returns text
language sql
immutable
as $$
  select lpad(n::text, 5, '0');
$$;

create or replace function public.next_profile_custom_id()
returns text
language plpgsql
as $$
declare
  n integer;
begin
  n := nextval('public.profiles_custom_id_seq')::integer;
  if n > 99999 then
    raise exception 'profiles custom_id sequence exhausted (max 99999)';
  end if;
  return public.format_profile_custom_id(n);
end;
$$;

-- Backfill existing rows in stable order (created_at, id).
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id
    from public.profiles
    where custom_id is null
    order by created_at asc nulls last, id asc
  loop
    n := n + 1;
    update public.profiles
    set custom_id = public.format_profile_custom_id(n)
    where id = r.id;
  end loop;
  if n > 0 then
    perform setval('public.profiles_custom_id_seq', n, true);
  end if;
end;
$$;

alter table public.profiles
  alter column custom_id set default public.next_profile_custom_id();

-- Unique among assigned values (nulls shouldn't remain after backfill).
create unique index if not exists profiles_custom_id_uidx
  on public.profiles (custom_id);

alter table public.profiles
  alter column custom_id set not null;

-- Keep signup trigger in sync: Custom ID via column default (sequence).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, phone, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'family'),
    new.raw_user_meta_data->>'full_name',
    null,
    coalesce(nullif(trim(new.raw_user_meta_data->>'locale'), ''), 'en')
  );
  return new;
end;
$$;
