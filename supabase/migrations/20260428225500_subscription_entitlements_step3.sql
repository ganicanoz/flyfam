-- Step 3: Backend entitlement persistence for subscription access.
-- This creates a simple, explicit entitlement record per user.

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  premium_active boolean not null default false,
  source text not null default 'subscription_access',
  updated_at timestamptz not null default now()
);

alter table public.user_entitlements enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_entitlements'
      and policyname = 'users can read own entitlements'
  ) then
    create policy "users can read own entitlements"
      on public.user_entitlements
      for select
      to authenticated
      using (user_id = auth.uid());
  end if;
end$$;

create or replace function public.refresh_my_entitlements()
returns public.user_entitlements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_access jsonb;
  v_premium_active boolean := false;
  v_row public.user_entitlements;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_access := public.get_my_subscription_access();
  v_premium_active := coalesce((v_access ->> 'has_access')::boolean, false);

  insert into public.user_entitlements (user_id, premium_active, source, updated_at)
  values (v_uid, v_premium_active, 'subscription_access', now())
  on conflict (user_id) do update
    set premium_active = excluded.premium_active,
        source = excluded.source,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.refresh_my_entitlements() is
  'Recomputes and persists current user premium entitlement from subscription access.';
