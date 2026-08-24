# Phase Refresh Guardrails

Bu dokuman `refresh-flight-api-phases` akisi icin 5 adimlik koruma setini toplar.

## 1) Post-deploy smoke test

- Komut: `npm run phase:smoke`
- Ne yapar: Edge Function `refresh-flight-api-phases` endpoint'ini `x-cron-secret` ile tetikler.
- Beklenen: `ok=true` ve process exit code `0`.

## 2) Stale health check (alarm-friendly)

- Komut: `npm run phase:health`
- Varsayilan stale limiti: `PHASE_HEALTH_MAX_AGE_MIN=6`
- Ne yapar: `system_health_pings` icindeki `phase_refresh.last_success_at` yasini kontrol eder.
- Beklenen: Son basari 6 dakika icindeyse exit `0`; degilse exit `2`.

## 3) Canary SQL check

- Komut: `npm run phase:canary`
- Ne yapar: `compute_flight_api_phase_state` RPC'sini sentetik bir senaryo ile cagirir.
- Beklenen: Bos olmayan bir phase donmesi ve exit `0`.

## 4) Hotfix / rollback SQL template

- Dosya: `supabase/sql/hotfix_refresh_flights_api_phase.sql`
- Kullanim: SQL Editor'de acip uygulayin, ardindan `npm run phase:smoke` ile dogrulayin.

## 5) Operasyonel uygulama

- Deploy sonrasi sira:
  1. `npm run phase:canary`
  2. `npm run phase:smoke`
  3. `npm run phase:health`
- Alarm:
  - `phase:health` non-zero donerse on-call uyarisi olusturun.
  - Dashboard'da `phase_refresh` kirmiziya duserse ayni proseduru izleyin.
