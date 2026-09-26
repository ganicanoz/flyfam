-- Remote min-build policy for client-side force-update gate (no server API lock).

create table if not exists public.app_release_policy (
  key text primary key default 'default',
  min_ios_build integer not null default 39,
  min_android_build integer not null default 39,
  force boolean not null default true,
  title_tr text not null,
  body_tr text not null,
  title_en text not null,
  body_en text not null,
  ios_store_url text not null default 'https://apps.apple.com/app/id6759844455',
  android_store_url text not null default 'https://play.google.com/store/apps/details?id=com.flyfam.app',
  android_invite_email text not null default 'flyfamapp@gmail.com',
  updated_at timestamptz not null default now(),
  constraint app_release_policy_key_default check (key = 'default')
);

comment on table public.app_release_policy is
  'Single-row release gate: clients block when native build < platform min_*_build and force=true.';

insert into public.app_release_policy (
  key,
  min_ios_build,
  min_android_build,
  force,
  title_tr,
  body_tr,
  title_en,
  body_en,
  ios_store_url,
  android_store_url,
  android_invite_email
) values (
  'default',
  39,
  39,
  true,
  'Yeni sürüm gerekli',
  'Yeni özellikler için güncel FlyFam sürümünü kullanın. Eski sürüm yakında kullanıma kapatılacaktır. iOS: TestFlight veya App Store’dan güncelleyin. Android: Play Store closed testing üzerinden güncelleyin; listede değilseniz flyfamapp@gmail.com adresine yazarak davet isteyin.',
  'Update required',
  'Please use the latest FlyFam version for new features. Older versions will be discontinued soon. iOS: update via TestFlight or the App Store. Android: update via Play Store closed testing; if you are not on the tester list, email flyfamapp@gmail.com to request an invite.',
  'https://apps.apple.com/app/id6759844455',
  'https://play.google.com/store/apps/details?id=com.flyfam.app',
  'flyfamapp@gmail.com'
)
on conflict (key) do update set
  min_ios_build = excluded.min_ios_build,
  min_android_build = excluded.min_android_build,
  force = excluded.force,
  title_tr = excluded.title_tr,
  body_tr = excluded.body_tr,
  title_en = excluded.title_en,
  body_en = excluded.body_en,
  ios_store_url = excluded.ios_store_url,
  android_store_url = excluded.android_store_url,
  android_invite_email = excluded.android_invite_email,
  updated_at = now();

alter table public.app_release_policy enable row level security;

drop policy if exists "Anyone can read app release policy" on public.app_release_policy;
create policy "Anyone can read app release policy"
  on public.app_release_policy
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.app_release_policy from anon, authenticated;
grant select on public.app_release_policy to anon, authenticated;
