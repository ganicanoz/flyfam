#!/usr/bin/env node
/**
 * Post-deploy smoke test:
 * - Calls /functions/v1/refresh-flight-api-phases with x-cron-secret
 * - Exits non-zero if function is unhealthy
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
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) {
    console.error('Missing env: SUPABASE_URL/SERVICE_KEY/CRON_SECRET');
    process.exit(1);
  }

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/refresh-flight-api-phases`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'x-cron-secret': CRON_SECRET,
    },
    body: '{}',
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }

  if (!res.ok || !json?.ok) {
    console.error(`[phase-smoke] FAIL status=${res.status} body=${text.slice(0, 500)}`);
    process.exit(1);
  }

  const rowsUpdated = Number(json.rowsUpdated ?? 0);
  console.log(`[phase-smoke] OK status=${res.status} rowsUpdated=${rowsUpdated}`);
}

main().catch((e) => {
  console.error('[phase-smoke] EXCEPTION', e);
  process.exit(1);
});
