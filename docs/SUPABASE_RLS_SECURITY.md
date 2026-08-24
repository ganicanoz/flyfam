# Supabase RLS güvenliği (FlyFam)

## Supabase e-postası: `rls_disabled_in_public`

Bu uyarı, **public** şemasında PostgREST ile erişilebilen bir tabloda **Row Level Security (RLS) kapalı** olduğunda gelir. RLS kapalıyken `anon` anahtarı ile proje URL’si üzerinden veri okunup yazılabilir.

### FlyFam’de yapılanlar

| Tablo | Erişim |
|--------|--------|
| `profiles`, `flights`, `flight_crew`, … | RLS + kullanıcıya özel policy |
| `airports`, `app_subscription_plans`, `hub_airport_board_cache` | RLS + authenticated SELECT |
| `system_health_pings`, `provider_response_cache`, `flight_provider_cooldown`, `flights_archive`, `fr24_usage_*` | RLS açık, **policy yok**, `anon`/`authenticated` **REVOKE** — yalnızca `service_role` (Edge Functions) |

İlgili migration: `supabase/migrations/20260520140000_public_schema_rls_hardening.sql`

Önceki düzeltme: `20260506120000_system_health_pings_enable_rls.sql` (`system_health_pings` için RLS).

### Uzak projede kontrol

```bash
cd /Users/mineoz/gani-apps/FLYFAM
npx supabase db push
npx supabase db query --linked --agent=no -o table "
  select relname, relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and relkind = 'r' and not relrowsecurity;
"
```

Boş sonuç = tüm public tablolarda RLS açık.

Dashboard: **Database → Security Advisor** — `rls_disabled_in_public` kaydı kaybolmalı (birkaç saat gecikebilir).

### Yeni tablo eklerken

- Migration’da mutlaka: `alter table ... enable row level security;`
- Uygun `create policy` veya operatör tablosu ise `revoke` + yalnızca `service_role` grant.
- Event trigger `enable_rls_on_new_public_table` yeni public tablolarda RLS’i otomatik açar (yedek).
