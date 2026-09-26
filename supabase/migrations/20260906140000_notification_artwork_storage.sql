-- Public bucket for family push rich-notification artwork (takeoff / landing / roster).
-- Objects are world-readable; only service role / authenticated upload via dashboard or script.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notification-artwork',
  'notification-artwork',
  true,
  512000,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read
drop policy if exists "notification_artwork_public_read" on storage.objects;
create policy "notification_artwork_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'notification-artwork');

-- Writes intentionally have no authenticated policy. Operational uploads must use
-- the server-side service role, which bypasses RLS. Public clients remain read-only.
