-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.crew_profiles enable row level security;
alter table public.flights enable row level security;
alter table public.family_connections enable row level security;
alter table public.invite_codes enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.device_tokens enable row level security;
alter table public.notification_log enable row level security;

-- profiles: users can read and update own
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- crew_profiles: crew can CRUD own (user_id = their profile id)
create policy "Crew can read own crew_profile"
  on public.crew_profiles for select
  using (auth.uid() = user_id);

create policy "Crew can insert own crew_profile"
  on public.crew_profiles for insert
  with check (auth.uid() = user_id);

create policy "Crew can update own crew_profile"
  on public.crew_profiles for update
  using (auth.uid() = user_id);

create policy "Crew can delete own crew_profile"
  on public.crew_profiles for delete
  using (auth.uid() = user_id);

-- flights: crew CRUD own; family read via approved connection
create policy "Crew can manage own flights"
  on public.flights for all
  using (
    crew_id in (select id from public.crew_profiles where user_id = auth.uid())
  )
  with check (
    crew_id in (select id from public.crew_profiles where user_id = auth.uid())
  );

create policy "Family can read flights of approved connections"
  on public.flights for select
  using (
    crew_id in (
      select fc.crew_id from public.family_connections fc
      where fc.family_id = auth.uid() and fc.status = 'approved'
    )
  );

-- family_connections: crew CRUD where crew; family read where family
create policy "Crew can manage connections where they are crew"
  on public.family_connections for all
  using (
    crew_id in (select id from public.crew_profiles where user_id = auth.uid())
  )
  with check (
    crew_id in (select id from public.crew_profiles where user_id = auth.uid())
  );

create policy "Family can read own connections"
  on public.family_connections for select
  using (family_id = auth.uid());

create policy "Family can insert connection (request to connect)"
  on public.family_connections for insert
  with check (family_id = auth.uid());

-- invite_codes: crew CRUD own; anyone can lookup by code (for redemption)
create policy "Crew can manage own invite codes"
  on public.invite_codes for all
  using (
    crew_id in (select id from public.crew_profiles where user_id = auth.uid())
  )
  with check (
    crew_id in (select id from public.crew_profiles where user_id = auth.uid())
  );

create policy "Anyone can read invite codes (for lookup by code)"
  on public.invite_codes for select
  using (true);

-- invite_codes updates (used_at, used_by) are done via redeem_invite_code RPC (security definer)

-- notification_preferences: family CRUD own
create policy "Users can manage own notification preferences"
  on public.notification_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- device_tokens: users CRUD own
create policy "Users can manage own device tokens"
  on public.device_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- notification_log: service role writes; users can read own (optional)
create policy "Users can read own notification log"
  on public.notification_log for select
  using (user_id = auth.uid());
