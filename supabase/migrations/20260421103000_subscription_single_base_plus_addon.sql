-- Simplify subscription model:
-- - Single base plan: 1 crew + 1 family
-- - Extra family slots billed per-member

update public.app_subscription_plans
set
  title = 'FlyFam Monthly (1 crew + 1 family)',
  max_family_members = 1,
  max_extra_family_members = 10,
  extra_family_member_price_usd = 0.99,
  monthly_price_usd = 2.00,
  active = true
where code = 'couple';

update public.app_subscription_plans
set active = false
where code in ('family', 'big_family');

update public.crew_subscriptions
set
  plan_code = 'couple',
  extra_family_slots = greatest(coalesce(extra_family_slots, 0), 0),
  updated_at = now()
where plan_code in ('family', 'big_family');
