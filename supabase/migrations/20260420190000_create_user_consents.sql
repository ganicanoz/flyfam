-- Consent history for KVKK/disclaimer/optional permissions.
create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null,
  accepted boolean not null default false,
  policy_version text not null,
  locale text,
  source text not null default 'signup',
  accepted_at timestamptz not null default now(),
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create unique index if not exists user_consents_unique_user_type_version
  on public.user_consents (user_id, consent_type, policy_version);

create index if not exists user_consents_user_id_idx
  on public.user_consents (user_id, accepted_at desc);

alter table public.user_consents enable row level security;

drop policy if exists "Users can read own consents" on public.user_consents;
create policy "Users can read own consents"
  on public.user_consents for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own consents" on public.user_consents;
create policy "Users can insert own consents"
  on public.user_consents for insert
  with check (auth.uid() = user_id);

