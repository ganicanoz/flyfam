# Notification artwork (push)

Source (keep as-is):
- `flyfam-*-v3-formal.png` — design masters (~1254²)

Derived for push delivery (`push/`):
- `flyfam-*-v3-push.jpg` — 512×512 JPEG ~16–18 KB (used in Expo `richContent.image`)
- `flyfam-*-v3-push.png` — same size PNG (optional)

Android status-bar small icons (white silhouette, generated into `android/app/src/main/res/drawable-*`):
- `notification_icon_takeoff`
- `notification_icon_landed`
- `notification_icon_roster`

## Hosting

Public Supabase Storage bucket: `notification-artwork`  
Migration: `supabase/migrations/20260906140000_notification_artwork_storage.sql`  
Upload:

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node mobile/scripts/upload-notification-artwork.js
```

Public URL pattern:
`{SUPABASE_URL}/storage/v1/object/public/notification-artwork/flyfam-takeoff-v3-push.jpg`
