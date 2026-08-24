-- Tiered auto-renewable family packages (replaces base + consumable add-on).
-- Capacity = plan.max_family_members only (extra_family_slots forced to 0 for new model).

alter table public.app_subscription_plans
  add column if not exists ios_product_id_monthly text,
  add column if not exists ios_product_id_yearly text,
  add column if not exists sort_order integer not null default 0;

-- Deactivate legacy / unused codes
update public.app_subscription_plans
set active = false
where code in ('couple', 'big_family');

insert into public.app_subscription_plans (
  code,
  title,
  max_family_members,
  max_extra_family_members,
  extra_family_member_price_usd,
  monthly_price_usd,
  active,
  ios_product_id_monthly,
  ios_product_id_yearly,
  sort_order
)
values
  ('duo', 'Duo (1 crew + 1 family)', 1, 0, 0, 2.99, true, 'flyfam.duo.monthly', 'flyfam.duo.yearly', 10),
  ('trio', 'Trio (1 crew + 2 family)', 2, 0, 0, 3.99, true, 'flyfam.trio.monthly', 'flyfam.trio.yearly', 20),
  ('family', 'Family (1 crew + 3 family)', 3, 0, 0, 4.99, true, 'flyfam.family.monthly', 'flyfam.family.yearly', 30),
  ('family_plus', 'Family Plus (1 crew + 4 family)', 4, 0, 0, 5.99, true, 'flyfam.family_plus.monthly', 'flyfam.family_plus.yearly', 40),
  ('extended', 'Extended (1 crew + 5 family)', 5, 0, 0, 6.99, true, 'flyfam.extended.monthly', 'flyfam.extended.yearly', 50),
  ('clan', 'Clan (1 crew + 6 family)', 6, 0, 0, 7.99, true, 'flyfam.clan.monthly', 'flyfam.clan.yearly', 60),
  ('circle', 'Circle (1 crew + 7 family)', 7, 0, 0, 8.99, true, 'flyfam.circle.monthly', 'flyfam.circle.yearly', 70)
on conflict (code) do update set
  title = excluded.title,
  max_family_members = excluded.max_family_members,
  max_extra_family_members = 0,
  extra_family_member_price_usd = 0,
  monthly_price_usd = excluded.monthly_price_usd,
  active = true,
  ios_product_id_monthly = excluded.ios_product_id_monthly,
  ios_product_id_yearly = excluded.ios_product_id_yearly,
  sort_order = excluded.sort_order;

-- Reactivate / normalize `family` if it existed as 1+2 before — now 1+3 per product matrix above.
-- Ensure all active tiers have zero add-on capacity.
update public.app_subscription_plans
set
  max_extra_family_members = 0,
  extra_family_member_price_usd = 0
where active = true;

-- Migrate subscribers on legacy couple → duo; clear consumable add-on slots into plan if needed.
-- If they had extra slots, bump to the smallest tier that covers 1 + extras (best-effort).
with mapped as (
  select
    s.id,
    s.extra_family_slots,
    case
      when coalesce(s.extra_family_slots, 0) <= 0 then 'duo'
      when s.extra_family_slots = 1 then 'trio'
      when s.extra_family_slots = 2 then 'family'
      when s.extra_family_slots = 3 then 'family_plus'
      when s.extra_family_slots = 4 then 'extended'
      when s.extra_family_slots = 5 then 'clan'
      else 'circle'
    end as new_plan
  from public.crew_subscriptions s
  where s.plan_code in ('couple', 'big_family')
     or coalesce(s.extra_family_slots, 0) > 0
)
update public.crew_subscriptions s
set
  plan_code = m.new_plan,
  extra_family_slots = 0,
  updated_at = now()
from mapped m
where s.id = m.id;

update public.crew_subscriptions
set plan_code = 'duo', updated_at = now()
where plan_code = 'couple';

create or replace function public.resolve_plan_code_from_store_product(p_product_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_product text := trim(p_product_id);
  v_code text;
begin
  if v_product = '' then
    return null;
  end if;

  -- Legacy App Store IDs for Duo
  if v_product in ('01', 'flyfam.duo.monthly') then
    return 'duo';
  end if;
  if v_product in ('02', 'flyfam.duo.yearly') then
    return 'duo';
  end if;

  select p.code into v_code
  from public.app_subscription_plans p
  where p.active = true
    and (
      p.ios_product_id_monthly = v_product
      or p.ios_product_id_yearly = v_product
    )
  limit 1;

  return v_code;
end;
$$;

comment on function public.resolve_plan_code_from_store_product(text) is
  'Maps App Store / Play product_id to app_subscription_plans.code';

create or replace function public.apply_verified_store_purchase(
  p_platform text,
  p_product_id text,
  p_transaction_id text,
  p_original_transaction_id text default null,
  p_purchase_at timestamptz default now(),
  p_raw_payload jsonb default '{}'::jsonb,
  p_period_ends_at timestamptz default null,
  p_is_trial boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_crew_id uuid;
  v_status text;
  v_period_end timestamptz;
  v_product text := trim(p_product_id);
  v_platform text := trim(lower(p_platform));
  v_tx text := trim(p_transaction_id);
  v_plan_code text;
  v_is_yearly boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_platform not in ('ios', 'android') then
    raise exception 'Unsupported platform';
  end if;

  if v_tx = '' then
    raise exception 'Missing transaction_id';
  end if;

  -- Deprecated consumable family add-on — no longer sold.
  if upper(v_product) in ('EFUC', 'EFU', '03')
     or v_product in (
       'flyfam.monthly.addon_family_slot',
       'com.flyfam.addon.familypack',
       'flyfam_extra_user_slot'
     )
  then
    raise exception 'Family add-on purchases are discontinued. Choose a subscription package with more family seats.';
  end if;

  v_plan_code := public.resolve_plan_code_from_store_product(v_product);
  if v_plan_code is null then
    raise exception 'Unsupported product_id';
  end if;

  v_is_yearly := (
    v_product = '02'
    or v_product like '%.yearly'
    or exists (
      select 1
      from public.app_subscription_plans p
      where p.code = v_plan_code
        and p.ios_product_id_yearly = v_product
    )
  );

  insert into public.store_purchase_receipts (
    user_id,
    platform,
    product_id,
    transaction_id,
    original_transaction_id,
    purchase_at,
    raw_payload
  )
  values (
    v_uid,
    v_platform,
    v_product,
    v_tx,
    nullif(trim(coalesce(p_original_transaction_id, '')), ''),
    coalesce(p_purchase_at, now()),
    coalesce(p_raw_payload, '{}'::jsonb)
  )
  on conflict (platform, transaction_id) do nothing;

  select cp.id into v_crew_id
  from public.crew_profiles cp
  where cp.user_id = v_uid;

  if v_crew_id is null then
    raise exception 'User is not a crew member';
  end if;

  perform public.select_subscription_plan(v_plan_code);

  v_period_end := coalesce(
    p_period_ends_at,
    case
      when v_is_yearly then now() + interval '1 year'
      else now() + interval '1 month'
    end
  );

  update public.crew_subscriptions
  set
    plan_code = v_plan_code,
    extra_family_slots = 0,
    status = case when coalesce(p_is_trial, false) then 'trialing' else 'active' end,
    provider = case when v_platform = 'ios' then 'app_store' else 'play_store' end,
    provider_customer_id = coalesce(provider_customer_id, v_uid::text),
    provider_subscription_id = coalesce(nullif(trim(coalesce(p_original_transaction_id, '')), ''), p_transaction_id),
    trial_ends_at = case
      when coalesce(p_is_trial, false) then greatest(coalesce(trial_ends_at, v_period_end), v_period_end)
      else trial_ends_at
    end,
    current_period_ends_at = greatest(coalesce(current_period_ends_at, now()), v_period_end),
    updated_at = now()
  where crew_id = v_crew_id;

  perform public.refresh_my_entitlements();

  select s.status
    into v_status
  from public.crew_subscriptions s
  where s.crew_id = v_crew_id
  order by s.updated_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'kind', 'subscription_tier',
    'plan_code', v_plan_code,
    'subscription_status', v_status,
    'premium_active', (v_status in ('trialing', 'active'))
  );
end;
$$;

comment on function public.apply_verified_store_purchase(text, text, text, text, timestamptz, jsonb, timestamptz, boolean) is
  'Applies verified store purchase for tiered subscription packages (duo…circle). Add-on consumables rejected.';

create or replace function public.set_my_extra_family_slots(p_slots integer)
returns public.crew_subscriptions
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Extra family add-on slots are discontinued. Upgrade to a larger subscription package.';
end;
$$;

comment on function public.set_my_extra_family_slots(integer) is
  'Deprecated: family capacity comes only from subscription plan tiers.';
