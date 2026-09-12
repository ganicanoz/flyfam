-- User suggestions for undefined roster occupation codes (admin approve → catalog).

create table if not exists public.roster_occupation_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  crew_airline_icao text,
  code text not null,
  label_tr text not null,
  label_en text,
  category text not null default 'other',
  note text,
  status text not null default 'pending',
  sample_flight_id uuid,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint roster_occupation_suggestions_code_chk check (char_length(btrim(code)) >= 1),
  constraint roster_occupation_suggestions_label_tr_chk check (char_length(btrim(label_tr)) >= 1),
  constraint roster_occupation_suggestions_status_chk check (status in ('pending', 'approved', 'rejected')),
  constraint roster_occupation_suggestions_category_chk check (
    category in ('standby','off','leave','training','office','meeting','simulator','other','flight')
  )
);

create index if not exists roster_occupation_suggestions_status_idx
  on public.roster_occupation_suggestions (status, created_at desc);

create index if not exists roster_occupation_suggestions_user_idx
  on public.roster_occupation_suggestions (user_id, created_at desc);

-- One active pending suggestion per user+code
create unique index if not exists roster_occupation_suggestions_user_code_pending_uidx
  on public.roster_occupation_suggestions (user_id, upper(btrim(code)))
  where status = 'pending';

alter table public.roster_occupation_suggestions enable row level security;

drop policy if exists roster_occupation_suggestions_select_own on public.roster_occupation_suggestions;
create policy roster_occupation_suggestions_select_own
  on public.roster_occupation_suggestions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists roster_occupation_suggestions_insert_own on public.roster_occupation_suggestions;
create policy roster_occupation_suggestions_insert_own
  on public.roster_occupation_suggestions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

revoke all on public.roster_occupation_suggestions from anon;
grant select, insert on public.roster_occupation_suggestions to authenticated;
grant all on public.roster_occupation_suggestions to service_role;

comment on table public.roster_occupation_suggestions is
  'Crew-proposed labels for unknown duty codes; admin approves into roster_occupation_codes + Deploy';
