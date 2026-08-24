/**
 * Fetch airports from FR24 Airports Light API and upsert into Supabase `airports` table.
 *
 * FR24 endpoint: GET /api/static/airports/{code}/light (per airport).
 * Optional: try bulk endpoints first (if FR24 adds a list endpoint).
 *
 * Usage:
 *   FR24_API_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-fr24-airports.js
 *   Or set CODES_FILE=path/to/codes.txt (one ICAO or IATA per line). Default: scripts/data/airport-codes.txt
 *
 * FR24 storage rule: do not keep data longer than 30 days; re-run this script at least every 30 days.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
for (const envPath of [
  path.join(projectRoot, '.env'),
  path.join(projectRoot, 'mobile', '.env'),
]) {
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    });
    break;
  }
}

const token =
  process.env.FR24_API_TOKEN ||
  process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const codesFile = process.env.CODES_FILE || path.join(__dirname, 'data', 'airport-codes.txt');

const FR24_BASE = 'https://fr24api.flightradar24.com/api';
const HEADERS = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  'Accept-Version': 'v1',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalize FR24 light response to row. Light returns: name, ICAO, IATA (doc). */
function toRow(raw, code) {
  const icao = raw?.icao ?? raw?.ICAO ?? (code && code.length === 4 ? code : null);
  const iata = raw?.iata ?? raw?.IATA ?? (code && code.length === 3 ? code : null);
  const name = raw?.name ?? raw?.airport_name ?? null;
  const city = raw?.city ?? raw?.city_name ?? null;
  const country = raw?.country_iso ?? raw?.country ?? raw?.country_code ?? null;
  const tz = raw?.timezone_iana ?? raw?.timezone ?? raw?.time_zone ?? null;
  const pk = (icao || iata || code || '').toString().trim().toUpperCase();
  if (!pk) return null;
  return {
    icao: pk,
    iata: (iata || (pk.length === 3 ? pk : null)).toString().trim().toUpperCase() || null,
    name: (name || '').toString().trim() || null,
    city: (city || '').toString().trim() || null,
    country_iso: (country || '').toString().trim().toUpperCase() || null,
    timezone_iana: (tz || '').toString().trim() || null,
    raw_light: raw,
    fetched_at: new Date().toISOString(),
  };
}

/** Fetch one airport by code (IATA or ICAO). */
async function fetchOne(code) {
  const url = `${FR24_BASE}/static/airports/${encodeURIComponent(code)}/light`;
  const res = await fetch(url, { headers: HEADERS });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${res.status} ${JSON.stringify(data?.error ?? data?.message ?? data)}`);
  }
  const row = toRow(data?.data ?? data, code);
  if (!row) return null;
  if (!row.icao) row.icao = code.length === 4 ? code.toUpperCase() : (data?.data?.icao ?? data?.icao);
  return row;
}

/** Try bulk list endpoint (optional). Returns array of rows or null. */
async function tryBulk() {
  const urls = [
    `${FR24_BASE}/static/airports/light`,
    `${FR24_BASE}/airports/light`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      const data = await res.json().catch(() => null);
      if (!res.ok) continue;
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : null;
      if (!list?.length) continue;
      const rows = list.map((item) => toRow(item)).filter(Boolean);
      const byIcao = new Map();
      for (const r of rows) {
        const key = r.icao || r.iata;
        if (key && !byIcao.has(key)) byIcao.set(key, r);
      }
      return [...byIcao.values()];
    } catch (_) {
      continue;
    }
  }
  return null;
}

function loadCodesFromFile() {
  if (!fs.existsSync(codesFile)) {
    console.warn('Codes file not found:', codesFile);
    return [];
  }
  return fs
    .readFileSync(codesFile, 'utf8')
    .split(/\n/)
    .map((s) => s.replace(/#.*/, '').trim().toUpperCase())
    .filter((s) => s.length >= 3 && s.length <= 4);
}

async function main() {
  if (!token) {
    console.error('Missing FR24_API_TOKEN or EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN');
    process.exit(1);
  }
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  let createClient;
  try {
    createClient = require('@supabase/supabase-js').createClient;
  } catch (_) {
    const mobilePath = path.join(projectRoot, 'mobile', 'node_modules', '@supabase', 'supabase-js');
    createClient = require(mobilePath).createClient;
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let rows = await tryBulk();
  if (rows?.length) {
    console.log('Bulk endpoint returned', rows.length, 'airports');
  } else {
    const codes = loadCodesFromFile();
    if (!codes.length) {
      console.error('No bulk endpoint and no codes in', codesFile);
      console.error('Add one ICAO or IATA code per line to', codesFile);
      process.exit(1);
    }
    console.log('Fetching', codes.length, 'airports by code...');
    rows = [];
    const CONCURRENCY = 3;
    const DELAY_MS = 350;
    for (let i = 0; i < codes.length; i += CONCURRENCY) {
      const chunk = codes.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((code) =>
          fetchOne(code).catch((err) => {
            console.warn(code, err.message);
            return null;
          })
        )
      );
      const valid = results.filter(Boolean);
      rows.push(...valid);
      if ((i + CONCURRENCY) % 30 === 0 || i + CONCURRENCY >= codes.length) {
        console.log('Progress:', Math.min(i + CONCURRENCY, codes.length), '/', codes.length);
      }
      await sleep(DELAY_MS);
    }
  }

  if (!rows.length) {
    console.log('No rows to upsert');
    return;
  }

  const byIcao = new Map();
  for (const r of rows) {
    const key = (r.icao || r.iata || '').toUpperCase();
    if (!key) continue;
    if (!byIcao.has(key)) byIcao.set(key, r);
  }
  const unique = [...byIcao.values()];

  console.log('Upserting', unique.length, 'rows into public.airports...');
  const BATCH = 100;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH).map((r) => ({
      icao: r.icao,
      iata: r.iata || null,
      name: r.name || null,
      city: r.city || null,
      country_iso: r.country_iso || null,
      timezone_iana: r.timezone_iana || null,
      raw_light: r.raw_light || null,
      fetched_at: r.fetched_at,
    }));
    const { error } = await supabase.from('airports').upsert(batch, {
      onConflict: 'icao',
      ignoreDuplicates: false,
    });
    if (error) {
      console.error('Upsert error:', error.message);
      process.exit(1);
    }
  }
  console.log('Done. Total rows in DB: run a SELECT count(*) to verify.');
  console.log('Remember: FR24 data must not be stored longer than 30 days. Re-run this script regularly.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
