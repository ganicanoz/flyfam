-- Keep public support contact on the owned FlyFam domain.
-- The historical app_release_policy migration is intentionally left unchanged.

alter table public.app_release_policy
  alter column android_invite_email set default 'support@flyfamapp.com';

update public.app_release_policy
set
  body_tr = replace(body_tr, 'flyfamapp@gmail.com', 'support@flyfamapp.com'),
  body_en = replace(body_en, 'flyfamapp@gmail.com', 'support@flyfamapp.com'),
  android_invite_email = 'support@flyfamapp.com',
  updated_at = now()
where key = 'default';
