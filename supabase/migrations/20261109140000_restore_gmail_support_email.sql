-- Public support contact is flyfamapp@gmail.com (App Review + in-app invite copy).
alter table public.app_release_policy
  alter column android_invite_email set default 'flyfamapp@gmail.com';

update public.app_release_policy
set
  body_tr = replace(body_tr, 'support@flyfamapp.com', 'flyfamapp@gmail.com'),
  body_en = replace(body_en, 'support@flyfamapp.com', 'flyfamapp@gmail.com'),
  android_invite_email = 'flyfamapp@gmail.com',
  updated_at = now()
where key = 'default'
   or android_invite_email = 'support@flyfamapp.com'
   or body_tr like '%support@flyfamapp.com%'
   or body_en like '%support@flyfamapp.com%';
