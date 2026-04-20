-- Subscription package bootstrap for crew + family seat limits.
-- Store billing webhook integration can update crew_subscriptions later.

create table if not exists public.app_subscription_plans (
  code text primary key,
  title text not null,
  max_family_members integer not null check (max_family_members >= 0),
  max_extra_family_members integer not null default 5 check (max_extra_family_members >= 0),
  extra_family_member_price_usd numeric(10,2) not null default 1.00 check (extra_family_member_price_usd >= 0),
  monthly_price_usd numeric(10,2) not null check (monthly_price_usd >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.app_subscription_plans (
  code,
  title,
  max_family_members,
  max_extra_family_members,
  extra_family_member_price_usd,
  monthly_price_usd,
  active
)
values
  ('couple', 'Cift paketi (1 crew + 1 family)', 1, 5, 1.00, 2.00, true),
  ('family', 'Aile paketi (1 crew + 2 family)', 2, 5, 1.00, 3.00, true),
  ('big_family', 'Buyuk aile paketi (1 crew + 3 family)', 3, 5, 1.00, 4.00, true)
on conflict (code) do update set
  title = excluded.title,
  max_family_members = excluded.max_family_members,
  max_extra_family_members = excluded.max_extra_family_members,
  extra_family_member_price_usd = excluded.extra_family_member_price_usd,
  monthly_price_usd = excluded.monthly_price_usd,
  active = excluded.active;

create table if not exists public.crew_subscriptions (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null unique references public.crew_profiles(id) on delete cascade,
  plan_code text not null references public.app_subscription_plans(code),
  extra_family_slots integer not null default 0 check (extra_family_slots >= 0),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  provider text not null default 'manual_bootstrap',
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists crew_subscriptions_updated_at on public.crew_subscriptions;
create trigger crew_subscriptions_updated_at
before update on public.crew_subscriptions
for each row execute function public.handle_updated_at();

create index if not exists crew_subscriptions_status_idx on public.crew_subscriptions(status);
create index if not exists crew_subscriptions_plan_idx on public.crew_subscriptions(plan_code);

alter table public.app_subscription_plans enable row level security;
alter table public.crew_subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_subscription_plans'
      and policyname = 'subscription plans readable by authenticated'
  ) then
    create policy "subscription plans readable by authenticated"
      on public.app_subscription_plans
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'crew_subscriptions'
      and policyname = 'crew can read own subscription'
  ) then
    create policy "crew can read own subscription"
      on public.crew_subscriptions
      for select
      to authenticated
      using (
        crew_id in (
          select cp.id
          from public.crew_profiles cp
          where cp.user_id = auth.uid()
        )
      );
  end if;
end$$;

create or replace function public.ensure_crew_family_capacity(
  p_crew_id uuid,
  p_include_pending boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_family integer;
  v_extra_slots integer;
  v_max_family integer;
  v_used integer;
begin
  select p.max_family_members, s.extra_family_slots
    into v_base_family, v_extra_slots
  from public.crew_subscriptions s
  join public.app_subscription_plans p on p.code = s.plan_code
  where s.crew_id = p_crew_id
    and s.status in ('trialing', 'active')
    and p.active = true
  order by s.updated_at desc
  limit 1;

  if v_base_family is null then
    raise exception 'No active subscription plan for this crew';
  end if;
  v_max_family := coalesce(v_base_family, 0) + coalesce(v_extra_slots, 0);

  select count(*)
    into v_used
  from public.family_connections fc
  where fc.crew_id = p_crew_id
    and (
      fc.status = 'approved'
      or (p_include_pending and fc.status = 'pending')
    );

  if coalesce(v_used, 0) >= v_max_family then
    raise exception 'Family member limit reached for current plan';
  end if;
end;
$$;

comment on function public.ensure_crew_family_capacity(uuid, boolean) is
  'Raises exception when crew has no active plan or no available family slot.';

create or replace function public.select_subscription_plan(p_plan_code text)
returns public.crew_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_plan public.app_subscription_plans;
  v_sub public.crew_subscriptions;
  v_now timestamptz := now();
  v_trial_end timestamptz;
begin
  select cp.id into v_crew_id
  from public.crew_profiles cp
  where cp.user_id = auth.uid();

  if v_crew_id is null then
    raise exception 'User is not a crew member';
  end if;

  select * into v_plan
  from public.app_subscription_plans
  where code = trim(lower(p_plan_code))
    and active = true;

  if v_plan is null then
    raise exception 'Invalid subscription plan';
  end if;

  select * into v_sub
  from public.crew_subscriptions
  where crew_id = v_crew_id
  order by updated_at desc
  limit 1;

  if v_sub is null then
    v_trial_end := v_now + interval '30 days';
    insert into public.crew_subscriptions (
      crew_id,
      plan_code,
      status,
      trial_started_at,
      trial_ends_at,
      current_period_ends_at,
      provider
    )
    values (
      v_crew_id,
      v_plan.code,
      'trialing',
      v_now,
      v_trial_end,
      v_trial_end,
      'manual_bootstrap'
    )
    returning * into v_sub;
  else
    v_trial_end := coalesce(v_sub.trial_ends_at, v_now + interval '30 days');
    update public.crew_subscriptions
    set
      plan_code = v_plan.code,
      extra_family_slots = least(coalesce(v_sub.extra_family_slots, 0), v_plan.max_extra_family_members),
      status = case when v_trial_end > v_now then 'trialing' else 'active' end,
      trial_started_at = coalesce(v_sub.trial_started_at, v_now),
      trial_ends_at = v_trial_end,
      current_period_ends_at = coalesce(v_sub.current_period_ends_at, v_trial_end),
      updated_at = v_now
    where id = v_sub.id
    returning * into v_sub;
  end if;

  return v_sub;
end;
$$;

comment on function public.select_subscription_plan(text) is
  'Crew chooses a package. Bootstraps 30-day trial if first-time.';

create or replace function public.set_my_extra_family_slots(p_slots integer)
returns public.crew_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_sub public.crew_subscriptions;
  v_plan public.app_subscription_plans;
  v_slots integer;
begin
  v_slots := greatest(coalesce(p_slots, 0), 0);

  select cp.id into v_crew_id
  from public.crew_profiles cp
  where cp.user_id = auth.uid();

  if v_crew_id is null then
    raise exception 'User is not a crew member';
  end if;

  select * into v_sub
  from public.crew_subscriptions s
  where s.crew_id = v_crew_id
    and s.status in ('trialing', 'active')
  order by s.updated_at desc
  limit 1;

  if v_sub is null then
    raise exception 'No active subscription';
  end if;

  select * into v_plan
  from public.app_subscription_plans p
  where p.code = v_sub.plan_code
    and p.active = true;

  if v_plan is null then
    raise exception 'Plan not found';
  end if;

  if v_slots > v_plan.max_extra_family_members then
    raise exception 'Requested extra slots exceed plan limit';
  end if;

  update public.crew_subscriptions
  set extra_family_slots = v_slots, updated_at = now()
  where id = v_sub.id
  returning * into v_sub;

  return v_sub;
end;
$$;

comment on function public.set_my_extra_family_slots(integer) is
  'Crew sets paid extra family slots (0..plan.max_extra_family_members).';

create or replace function public.get_my_subscription_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_crew_id uuid;
  v_plan_code text;
  v_plan_title text;
  v_status text;
  v_trial_ends_at timestamptz;
  v_period_ends_at timestamptz;
  v_base_family integer;
  v_extra_slot_price numeric;
  v_max_extra_family integer;
  v_extra_family_slots integer := 0;
  v_total_family integer;
  v_used_approved integer := 0;
  v_used_pending integer := 0;
  v_access boolean := false;
begin
  select role into v_role
  from public.profiles
  where id = v_uid;

  if v_role is null then
    return jsonb_build_object(
      'role', null,
      'has_access', false
    );
  end if;

  if v_role = 'crew' then
    select cp.id into v_crew_id
    from public.crew_profiles cp
    where cp.user_id = v_uid;
  else
    select fc.crew_id into v_crew_id
    from public.family_connections fc
    where fc.family_id = v_uid
      and fc.status = 'approved'
    order by fc.updated_at desc nulls last, fc.created_at desc
    limit 1;
  end if;

  if v_crew_id is not null then
    select
      s.plan_code,
      p.title,
      s.status,
      s.trial_ends_at,
      s.current_period_ends_at,
      p.max_family_members,
      p.max_extra_family_members,
      p.extra_family_member_price_usd,
      s.extra_family_slots
    into
      v_plan_code,
      v_plan_title,
      v_status,
      v_trial_ends_at,
      v_period_ends_at,
      v_base_family,
      v_max_extra_family,
      v_extra_slot_price,
      v_extra_family_slots
    from public.crew_subscriptions s
    join public.app_subscription_plans p on p.code = s.plan_code
    where s.crew_id = v_crew_id
      and p.active = true
    order by s.updated_at desc
    limit 1;
  end if;

  v_total_family := coalesce(v_base_family, 0) + coalesce(v_extra_family_slots, 0);

  if v_crew_id is not null and v_total_family is not null then
    select count(*) into v_used_approved
    from public.family_connections fc
    where fc.crew_id = v_crew_id
      and fc.status = 'approved';

    select count(*) into v_used_pending
    from public.family_connections fc
    where fc.crew_id = v_crew_id
      and fc.status = 'pending';
  end if;

  v_access := (v_status in ('trialing', 'active'));

  return jsonb_build_object(
    'role', v_role,
    'crew_id', v_crew_id,
    'plan_code', v_plan_code,
    'plan_title', v_plan_title,
    'subscription_status', v_status,
    'trial_ends_at', v_trial_ends_at,
    'current_period_ends_at', v_period_ends_at,
    'base_family_members', v_base_family,
    'extra_family_slots', coalesce(v_extra_family_slots, 0),
    'max_extra_family_members', coalesce(v_max_extra_family, 0),
    'extra_family_member_price_usd', v_extra_slot_price,
    'max_family_members', v_total_family,
    'used_family_approved', v_used_approved,
    'used_family_pending', v_used_pending,
    'available_family_slots', greatest(coalesce(v_total_family, 0) - coalesce(v_used_approved, 0), 0),
    'can_invite_more', (coalesce(v_total_family, 0) > coalesce(v_used_approved, 0) + coalesce(v_used_pending, 0)),
    'has_access', v_access
  );
end;
$$;

comment on function public.get_my_subscription_access() is
  'Returns current user access and package seat usage (crew and family aware).';

-- Enforce package capacity in existing invitation + approval flow.
create or replace function public.generate_invite_code(
  p_expires_hours int default 168
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crew_id uuid;
  v_code text;
begin
  select id into v_crew_id from public.crew_profiles where user_id = auth.uid();
  if v_crew_id is null then
    raise exception 'User is not a crew member';
  end if;

  perform public.ensure_crew_family_capacity(v_crew_id, true);

  v_code := 'FLYF-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4)) || '-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4));

  insert into public.invite_codes (crew_id, code, expires_at)
  values (v_crew_id, v_code, now() + (p_expires_hours || ' hours')::interval);

  return v_code;
end;
$$;

create or replace function public.approve_connection(p_connection_id uuid)
returns public.family_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn public.family_connections;
begin
  select *
    into v_conn
  from public.family_connections fc
  where fc.id = p_connection_id
    and fc.crew_id in (select id from public.crew_profiles where user_id = auth.uid())
    and fc.status = 'pending'
  limit 1;

  if v_conn is null then
    raise exception 'Connection not found or not pending';
  end if;

  perform public.ensure_crew_family_capacity(v_conn.crew_id, false);

  update public.family_connections
  set status = 'approved', updated_at = now()
  where id = p_connection_id
  returning * into v_conn;

  insert into public.notification_preferences (user_id, connection_id)
  values (v_conn.family_id, v_conn.id)
  on conflict (user_id, connection_id) do nothing;

  return v_conn;
end;
$$;
