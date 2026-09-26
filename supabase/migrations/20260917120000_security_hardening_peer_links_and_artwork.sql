-- Security hardening for production data created by earlier migrations.
--
-- 1. The crew peer feature was deployed on 2026-08-26 with two demo links already
--    marked approved. The normal consent workflows were introduced afterwards.
--    Revoke only links created during the original deployment window; do not delete
--    rows and do not touch later user-created requests/approvals.
update public.crew_peer_links
set status = 'revoked'
where status = 'approved'
  and created_at < timestamptz '2026-08-27 00:00:00+00';

-- 2. Public notification artwork stays readable, but clients must never be able to
--    upload or replace it. Server-side service_role operations bypass RLS and remain
--    available for trusted deployment/ops scripts.
drop policy if exists "notification_artwork_authenticated_write" on storage.objects;
drop policy if exists "notification_artwork_authenticated_update" on storage.objects;

comment on table public.crew_peer_links is
  'Crew following another crew; only explicit pending/accept or invite workflows may grant approved roster access.';
