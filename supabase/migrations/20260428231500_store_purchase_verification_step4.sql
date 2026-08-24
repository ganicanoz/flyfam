-- Step 4: Store purchase verification persistence and entitlement update.

create table if not exists public.store_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  transaction_id text not null,
  original_transaction_id text,
  purchase_at timestamptz not null default now(),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (platform, transaction_id)
);

create index if not exists store_purchase_receipts_user_idx on public.store_purchase_receipts(user_id);
create index if not exists store_purchase_receipts_product_idx on public.store_purchase_receipts(product_id);

alter table public.store_purchase_receipts enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_purchase_receipts'
      and policyname = 'users can read own store receipts'
  ) then
    create policy "users can read own store receipts"
      on public.store_purchase_receipts
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end$$;

create or replace function public.apply_verified_store_purchase(
  p_platform text,
  p_product_id text,
  p_transaction_id text,
  p_original_transaction_id text default null,
  p_purchase_at timestamptz default now(),
  p_raw_payload jsonb default '{}'::jsonb
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
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(trim(lower(p_platform)), '') not in ('ios', 'android') then
    raise exception 'Unsupported platform';
  end if;

  if coalesce(trim(p_transaction_id), '') = '' then
    raise exception 'Missing transaction_id';
  end if;

  -- Current iOS live IDs in FlyFam. Expand here when Android products are added.
  if trim(p_product_id) not in ('01', '02') then
    raise exception 'Unsupported product_id';
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
    trim(lower(p_platform)),
    trim(p_product_id),
    trim(p_transaction_id),
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

  perform public.select_subscription_plan('couple');

  v_period_end := case
    when trim(p_product_id) = '01' then now() + interval '1 month'
    when trim(p_product_id) = '02' then now() + interval '1 year'
    else now() + interval '1 month'
  end;

  update public.crew_subscriptions
  set
    status = 'active',
    provider = case when trim(lower(p_platform)) = 'ios' then 'app_store' else 'play_store' end,
    provider_customer_id = coalesce(provider_customer_id, v_uid::text),
    provider_subscription_id = coalesce(nullif(trim(coalesce(p_original_transaction_id, '')), ''), p_transaction_id),
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
    'subscription_status', v_status,
    'premium_active', (v_status in ('trialing', 'active'))
  );
end;
$$;

comment on function public.apply_verified_store_purchase(text, text, text, text, timestamptz, jsonb) is
  'Applies a backend-verified store purchase, updates subscription state, then refreshes entitlements.';
