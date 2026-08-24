-- Test continuity: grant Geniş Sülale (circle) to all existing crew so
-- tier migration / ASC setup does not interrupt testers.
-- Family users inherit access via their linked crew subscription.

insert into public.crew_subscriptions (
  crew_id,
  plan_code,
  extra_family_slots,
  status,
  trial_started_at,
  trial_ends_at,
  current_period_ends_at,
  provider,
  updated_at
)
select
  cp.id,
  'circle',
  0,
  'active',
  now(),
  null,
  now() + interval '365 days',
  'manual_test_grant_circle',
  now()
from public.crew_profiles cp
on conflict (crew_id) do update set
  plan_code = 'circle',
  extra_family_slots = 0,
  status = 'active',
  current_period_ends_at = greatest(
    coalesce(public.crew_subscriptions.current_period_ends_at, now()),
    excluded.current_period_ends_at
  ),
  provider = case
    when public.crew_subscriptions.provider in (
      'manual_bootstrap',
      'manual_admin_grant',
      'manual_test_grant_circle'
    )
      or public.crew_subscriptions.provider is null
      then 'manual_test_grant_circle'
    else public.crew_subscriptions.provider
  end,
  updated_at = now();

-- Mark premium entitlements for all crew users.
insert into public.user_entitlements (user_id, premium_active, source, updated_at)
select
  cp.user_id,
  true,
  'manual_test_grant_circle',
  now()
from public.crew_profiles cp
where cp.user_id is not null
on conflict (user_id) do update set
  premium_active = true,
  source = 'manual_test_grant_circle',
  updated_at = now();

-- Family users with an approved link also get premium (access follows crew, but cache stays warm).
insert into public.user_entitlements (user_id, premium_active, source, updated_at)
select distinct
  fc.family_id,
  true,
  'manual_test_grant_circle_family',
  now()
from public.family_connections fc
join public.crew_subscriptions s on s.crew_id = fc.crew_id
where fc.status = 'approved'
  and s.status in ('trialing', 'active')
on conflict (user_id) do update set
  premium_active = true,
  source = excluded.source,
  updated_at = now();
