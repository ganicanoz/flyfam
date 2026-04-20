-- Add preferred language to profiles (en | tr). Used for app UI language.
alter table public.profiles
  add column if not exists locale text default 'en' check (locale in ('en', 'tr'));

comment on column public.profiles.locale is 'Preferred app language: en (English) or tr (Türkçe)';

-- Update trigger to set locale from signup metadata
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
