-- Add avatar URL to profiles so users can have profile photos
alter table if exists public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is 'Public URL for user avatar image (small square).';

