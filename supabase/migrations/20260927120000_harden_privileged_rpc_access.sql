-- Privileged maintenance and purchase application must never be callable
-- directly with anon/authenticated PostgREST credentials.

create or replace function public.apply_verified_store_purchase_for_user(
  p_user_id uuid,
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
  v_uid uuid := p_user_id;
  v_crew_id uuid;
  v_status text;
  v_period_end timestamptz;
  v_product text := trim(p_product_id);
  v_platform text := trim(lower(p_platform));
  v_tx text := trim(p_transaction_id);
  v_plan_code text;
  v_is_yearly boolean := false;
  v_receipt_user_id uuid;
begin
  if v_uid is null then
    raise exception 'Missing user_id';
  end if;

  if v_platform not in ('ios', 'android') then
    raise exception 'Unsupported platform';
  end if;

  if v_tx = '' then
    raise exception 'Missing transaction_id';
  end if;

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
  on conflict (platform, transaction_id) do nothing
  returning user_id into v_receipt_user_id;

  if v_receipt_user_id is null then
    select r.user_id into v_receipt_user_id
    from public.store_purchase_receipts r
    where r.platform = v_platform
      and r.transaction_id = v_tx;
  end if;

  if v_receipt_user_id is distinct from v_uid then
    raise exception 'Store transaction already belongs to another user';
  end if;

  select cp.id into v_crew_id
  from public.crew_profiles cp
  where cp.user_id = v_uid;

  if v_crew_id is null then
    raise exception 'User is not a crew member';
  end if;

  select p.code into v_plan_code
  from public.app_subscription_plans p
  where p.code = v_plan_code
    and p.active = true;

  if v_plan_code is null then
    raise exception 'Inactive subscription plan';
  end if;

  v_period_end := coalesce(
    p_period_ends_at,
    case when v_is_yearly then now() + interval '1 year' else now() + interval '1 month' end
  );

  insert into public.crew_subscriptions (
    crew_id,
    plan_code,
    status,
    provider,
    provider_customer_id,
    provider_subscription_id,
    trial_started_at,
    trial_ends_at,
    current_period_ends_at,
    extra_family_slots
  )
  values (
    v_crew_id,
    v_plan_code,
    case when coalesce(p_is_trial, false) then 'trialing' else 'active' end,
    case when v_platform = 'ios' then 'app_store' else 'play_store' end,
    v_uid::text,
    coalesce(nullif(trim(coalesce(p_original_transaction_id, '')), ''), v_tx),
    case when coalesce(p_is_trial, false) then coalesce(p_purchase_at, now()) else null end,
    case when coalesce(p_is_trial, false) then v_period_end else null end,
    v_period_end,
    0
  )
  on conflict (crew_id) do update
  set
    plan_code = excluded.plan_code,
    extra_family_slots = 0,
    status = excluded.status,
    provider = excluded.provider,
    provider_customer_id = coalesce(public.crew_subscriptions.provider_customer_id, excluded.provider_customer_id),
    provider_subscription_id = excluded.provider_subscription_id,
    trial_started_at = case
      when coalesce(p_is_trial, false)
        then coalesce(public.crew_subscriptions.trial_started_at, excluded.trial_started_at)
      else public.crew_subscriptions.trial_started_at
    end,
    trial_ends_at = case
      when coalesce(p_is_trial, false)
        then greatest(coalesce(public.crew_subscriptions.trial_ends_at, excluded.trial_ends_at), excluded.trial_ends_at)
      else public.crew_subscriptions.trial_ends_at
    end,
    current_period_ends_at = greatest(
      coalesce(public.crew_subscriptions.current_period_ends_at, excluded.current_period_ends_at),
      excluded.current_period_ends_at
    ),
    updated_at = now();

  insert into public.user_entitlements (user_id, premium_active, source, updated_at)
  values (v_uid, true, 'store_purchase', now())
  on conflict (user_id) do update
  set premium_active = true, source = 'store_purchase', updated_at = now();

  select s.status into v_status
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

revoke all on function public.apply_verified_store_purchase_for_user(uuid, text, text, text, text, timestamptz, jsonb, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.apply_verified_store_purchase_for_user(uuid, text, text, text, text, timestamptz, jsonb, timestamptz, boolean) to service_role;

revoke execute on function public.apply_verified_store_purchase(text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_verified_store_purchase(text, text, text, text, timestamptz, jsonb, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.apply_verified_store_purchase(text, text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.apply_verified_store_purchase(text, text, text, text, timestamptz, jsonb, timestamptz, boolean) to service_role;

revoke execute on function public.select_subscription_plan(text) from public, anon, authenticated;
grant execute on function public.select_subscription_plan(text) to service_role;

revoke execute on function public.archive_and_cleanup_old_flights(interval) from public, anon, authenticated;
revoke execute on function public.close_stale_past_flight_phases() from public, anon, authenticated;
revoke execute on function public.purge_old_flight_ops_log(interval) from public, anon, authenticated;
revoke execute on function public.purge_old_flights_archive(interval) from public, anon, authenticated;
revoke execute on function public.refresh_flights_api_refresh_phase() from public, anon, authenticated;
revoke execute on function public.count_crew_approved_followers(uuid) from public, anon, authenticated;
revoke execute on function public.crew_has_active_subscription(uuid) from public, anon, authenticated;
revoke execute on function public.ensure_crew_family_capacity(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.flight_ops_log_insert_from_flight(text, public.flights, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_updated_at() from public, anon, authenticated;
revoke execute on function public.tg_flights_ops_log_ai() from public, anon, authenticated;
revoke execute on function public.tg_flights_ops_log_au() from public, anon, authenticated;
revoke execute on function public.tg_flights_ops_log_bd() from public, anon, authenticated;
revoke execute on function public.tg_flights_protect_premature_landed() from public, anon, authenticated;
revoke execute on function public.trg_flights_set_api_refresh_phase() from public, anon, authenticated;

grant execute on function public.archive_and_cleanup_old_flights(interval) to service_role;
grant execute on function public.close_stale_past_flight_phases() to service_role;
grant execute on function public.purge_old_flight_ops_log(interval) to service_role;
grant execute on function public.purge_old_flights_archive(interval) to service_role;
grant execute on function public.refresh_flights_api_refresh_phase() to service_role;

-- Flight/flight_crew RLS policies call this read-only helper for signed-in
-- crew and family viewers. Keep it unavailable to anon, but executable by
-- authenticated so those policies can evaluate normally.
grant execute on function public.crew_has_active_subscription(uuid) to authenticated;

-- New functions must opt in to PostgREST exposure explicitly instead of
-- inheriting executable access for every anonymous client.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

comment on function public.apply_verified_store_purchase_for_user(uuid, text, text, text, text, timestamptz, jsonb, timestamptz, boolean) is
  'Service-role-only application of a purchase already verified by a trusted store server.';
