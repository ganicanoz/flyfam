#!/usr/bin/env bash
# OurAirports indir + public.airports upsert (tablo silinmez).
# Gerekli env: SUPABASE_URL (veya EXPO_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
# Proje kökünde veya mobile/.env içinde tanımlı olabilir.
#
# cron-job.org kullanıyorsan: makine cron yerine Supabase Edge Function çağır:
#   URL:    https://<PROJECT_REF>.supabase.co/functions/v1/sync-airports-ourairports
#   Method: POST
#   Header: x-cron-secret: <CRON_SECRET>  (Dashboard → Edge Functions → Secrets)
#   Haftalık schedule cron-job.org arayüzünde.
#
# Örnek crontab (her Pazartesi 03:00, yerel saat sunucuya göre):
#   0 3 * * 1 /path/to/FLYFAM/scripts/cron-airports-sync.sh >> /var/log/flyfam-airports.log 2>&1
#
# nvm kullanıyorsan crontab’ta önce nvm’i yükle veya tam yol ile node/npm ver:
#   0 3 * * 1 . "$HOME/.nvm/nvm.sh" && cd /path/to/FLYFAM && ./scripts/cron-airports-sync.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$f"
  set +a
}

load_env_file "$ROOT/.env"
load_env_file "$ROOT/mobile/.env"

if [[ -z "${SUPABASE_URL:-}" && -n "${EXPO_PUBLIC_SUPABASE_URL:-}" ]]; then
  export SUPABASE_URL="$EXPO_PUBLIC_SUPABASE_URL"
fi

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "cron-airports-sync: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (.env veya ortam)." >&2
  exit 1
fi

command -v npm >/dev/null || {
  echo "cron-airports-sync: npm bulunamadı (PATH veya nvm)." >&2
  exit 1
}

exec npm run airports:sync-weekly
