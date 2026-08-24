#!/usr/bin/env node
/**
 * Health check for phase refresh.
 * Fails when last_success_at is older than PHASE_HEALTH_MAX_AGE_MIN (default 6).
 */
const fs = require('fs');
const path = require('path');

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
}

loadEnv(path.join(process.cwd(), '.env.local'));
loadEnv(path.join(process.cwd(), '.env'));
loadEnv(path.join(process.cwd(), 'mobile', '.env.local'));
loadEnv(path.join(process.cwd(), 'mobile', '.env'));

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const maxAgeMin = Number(process.env.PHASE_HEALTH_MAX_AGE_MIN || '6');

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing env: SUPABASE_URL/SERVICE_KEY');
    process.exit(1);
  }
  const qs = new URLSearchParams({
    select: 'name,last_run_at,last_success_at,last_error,last_rows_updated,updated_at',
    name: 'eq.phase_refresh',
    limit: '1',
  });
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/system_health_pings?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(json) || json.length === 0) {
    console.error(`[phase-health] FAIL fetch status=${res.status}`);
    process.exit(1);
  }
  const row = json[0] || {};
  const lastSuccess = typeof row.last_success_at === 'string' ? row.last_success_at : '';
  const lastSuccessMs = lastSuccess ? new Date(lastSuccess).getTime() : NaN;
  if (!Number.isFinite(lastSuccessMs)) {
    console.error('[phase-health] FAIL last_success_at missing/invalid');
    process.exit(1);
  }
  const ageMin = (Date.now() - lastSuccessMs) / 60000;
  if (ageMin > maxAgeMin) {
    console.error(
      `[phase-health] FAIL stale age=${ageMin.toFixed(1)}m max=${maxAgeMin}m last_success_at=${lastSuccess} last_error=${row.last_error || '-'}`,
    );
    process.exit(2);
  }
  console.log(
    `[phase-health] OK age=${ageMin.toFixed(1)}m last_success_at=${lastSuccess} rows=${row.last_rows_updated ?? '-'}`,
  );
}

main().catch((e) => {
  console.error('[phase-health] EXCEPTION', e);
  process.exit(1);
});
