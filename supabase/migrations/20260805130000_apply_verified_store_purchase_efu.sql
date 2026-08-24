-- Accept ASC product EFU (flyfam_extra_user) as family add-on.

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
  v_is_addon boolean := false;
  v_extra integer;
  v_max_extra integer;
  v_sub_id uuid;
  v_claimed uuid;
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

  v_is_addon := upper(v_product) in (
    'EFU',
    '03'
  ) or v_product in (
    'flyfam.monthly.addon_family_slot',
    'com.flyfam.addon.familypack'
  );

  if v_product not in ('01', '02') and not v_is_addon then
    raise exception 'Unsupported product_id';
  end if;

  -- Normalize EFU casing for storage
  if upper(v_product) = 'EFU' then
    v_product := 'EFU';
  end if;

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

  if v_is_addon then
    select s.id, s.extra_family_slots, coalesce(p.max_extra_family_members, 10)
      into v_sub_id, v_extra, v_max_extra
    from public.crew_subscriptions s
    left join public.app_subscription_plans p on p.code = s.plan_code
    where s.crew_id = v_crew_id
      and s.status in ('trialing', 'active')
    order by s.updated_at desc
    limit 1;

    if v_sub_id is null then
      raise exception 'Active base subscription required before buying family add-on';
    end if;

    update public.store_purchase_receipts
    set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('addon_slot_applied', true)
    where platform = v_platform
      and transaction_id = v_tx
      and coalesce((raw_payload->>'addon_slot_applied')::boolean, false) is not true
    returning id into v_claimed;

    if v_claimed is not null then
      v_extra := least(coalesce(v_extra, 0) + 1, v_max_extra);

      update public.crew_subscriptions
      set
        extra_family_slots = v_extra,
        updated_at = now()
      where id = v_sub_id;

      update public.store_purchase_receipts
      set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
        'extra_family_slots_after', v_extra
      )
      where id = v_claimed;
    else
      select s.extra_family_slots into v_extra
      from public.crew_subscriptions s
      where s.id = v_sub_id;
    end if;

    perform public.refresh_my_entitlements();

    select s.status into v_status
    from public.crew_subscriptions s
    where s.crew_id = v_crew_id
    order by s.updated_at desc
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'kind', 'family_addon',
      'extra_family_slots', v_extra,
      'subscription_status', v_status,
      'premium_active', (v_status in ('trialing', 'active'))
    );
  end if;

  perform public.select_subscription_plan('couple');

  v_period_end := coalesce(
    p_period_ends_at,
    case
      when v_product = '01' then now() + interval '1 month'
      when v_product = '02' then now() + interval '1 year'
      else now() + interval '1 month'
    end
  );

  update public.crew_subscriptions
  set
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
    'kind', 'base_subscription',
    'subscription_status', v_status,
    'premium_active', (v_status in ('trialing', 'active'))
  );
end;
$$;

comment on function public.apply_verified_store_purchase(text, text, text, text, timestamptz, jsonb, timestamptz, boolean) is
  'Applies verified store purchase: base (01/02) or family add-on EFU (+1 extra_family_slots).';
