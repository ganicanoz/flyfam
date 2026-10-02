-- Roster PDF hata raporları: kullanıcı onayıyla paylaşılan PDF'ler (yalnız parser hata analizi).
-- Yazma/okuma yalnız service role (Edge `roster-pdf-report`); istemci tabloya ve bucket'a doğrudan erişemez.
-- Saklama: expires_at (30 gün); süresi dolanlar Edge tarafından Storage API ile silinir.

alter table public.user_activity_events
  drop constraint if exists user_activity_events_event_type_check;

alter table public.user_activity_events
  add constraint user_activity_events_event_type_check
  check (event_type in (
    'app_open',
    'roster_import',
    'family_push',
    'screen_view',
    'admin_push',
    'roster_import_issue'
  ));

create table if not exists public.roster_pdf_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  reason text not null check (reason in ('suspect', 'failed', 'manual')),
  airline_icao text check (airline_icao is null or char_length(airline_icao) <= 8),
  parse_source text check (parse_source is null or char_length(parse_source) <= 40),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  platform text check (platform is null or char_length(platform) <= 16),
  size_bytes integer not null check (size_bytes > 0),
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'reviewed', 'fixed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists roster_pdf_reports_created_idx on public.roster_pdf_reports (created_at desc);
create index if not exists roster_pdf_reports_user_idx on public.roster_pdf_reports (user_id, created_at desc);
create index if not exists roster_pdf_reports_expires_idx on public.roster_pdf_reports (expires_at);

alter table public.roster_pdf_reports enable row level security;
revoke all on public.roster_pdf_reports from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('roster-pdf-reports', 'roster-pdf-reports', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Bilinçli olarak storage.objects politikası yok: private bucket'a yalnız service role erişir.
