-- invite_codes: codes crew shares for family to connect
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew_profiles(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now() not null
);

create index idx_invite_codes_code on public.invite_codes(code);

comment on table public.invite_codes is 'Invite codes for family to connect to crew';
