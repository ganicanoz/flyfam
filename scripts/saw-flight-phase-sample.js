#!/usr/bin/env node
/**
 * SAW arrivals + departures "phase sample" (10 flights).
 *
 * Goal:
 * - Pull SAW tables
 * - Classify flights into operational buckets
 * - Pick 10 diverse flights for algorithm dry-run
 *
 * Usage:
 *   node scripts/saw-flight-phase-sample.js
 *   SAMPLE_SIZE=10 node scripts/saw-flight-phase-sample.js
 *
 * Env:
 * - FR24: EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN or FR24_API_TOKEN
 * - AirLabs: AIRLABS_API_KEY or EXPO_PUBLIC_AIRLABS_API_KEY
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  });
}
loadEnv(path.join(projectRoot, '.env'));
loadEnv(path.join(projectRoot, 'mobile', '.env'));

const SAW = (process.env.AIRPORT || 'SAW').trim().toUpperCase();
const SAMPLE_SIZE = Math.max(3, Math.min(20, Number(process.env.SAMPLE_SIZE || 10)));

const FR24_TOKEN = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN || process.env.FR24_API_TOKEN || '';
const AIRLABS_KEY = process.env.AIRLABS_API_KEY || process.env.EXPO_PUBLIC_AIRLABS_API_KEY || '';

const FR24_HEADERS = {
  Authorization: `Bearer ${FR24_TOKEN}`,
  Accept: 'application/json',
  'Accept-Version': 'v1',
};

function line(ch, n) { return ch.repeat(n); }
function dash(v) { return v == null || v === '' ? '—' : String(v); }
function cell(v, w) {
  const s = dash(v);
  return s.length <= w ? s.padEnd(w) : s.slice(0, w - 1) + '…';
}

function normalizeIso(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(/\.\d+$/, '') + '.000Z';
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function asMs(iso) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function pickTime(row, keys) {
  for (const k of keys) {
    const iso = normalizeIso(row[k]);
    if (iso) return iso;
  }
  return null;
}

function normalizeFlight(raw, source, table) {
  const flight = String(raw.flight_iata || raw.flight_icao || raw.flight || raw.callsign || raw.number || '').trim().toUpperCase();
  const dep = String(raw.dep_iata || raw.origin_iata || raw.orig_iata || raw.dep_icao || raw.origin_icao || raw.orig_icao || '').toUpperCase();
  const arr = String(raw.arr_iata || raw.destination_iata || raw.dest_iata || raw.arr_icao || raw.destination_icao || raw.dest_icao || '').toUpperCase();

  const std = pickTime(raw, ['scheduled_departure_utc', 'scheduled_departure', 'dep_time_utc', 'dep_time', 'dep_estimated_utc', 'dep_estimated']);
  const sta = pickTime(raw, ['scheduled_arrival_utc', 'scheduled_arrival', 'arr_time_utc', 'arr_time', 'arr_estimated_utc', 'arr_estimated']);
  const etd = pickTime(raw, ['dep_estimated_utc', 'dep_estimated']);
  const eta = pickTime(raw, ['arr_estimated_utc', 'arr_estimated']);
  const atd = pickTime(raw, ['datetime_takeoff', 'datetimeTakeoff', 'dep_actual_utc', 'dep_actual']);
  const ata = pickTime(raw, ['datetime_landed', 'datetimeLanded', 'arr_actual_utc', 'arr_actual']);
  const firstSeen = pickTime(raw, ['first_seen', 'firstSeen']);
  const lastSeen = pickTime(raw, ['last_seen', 'lastSeen']);
  const ended = raw.flight_ended === true || raw.flightEnded === true;
  const status = String(raw.status || '').toLowerCase() || null;

  return {
    id: `${source}:${table}:${flight}:${std || sta || atd || ata || Math.random().toString(36).slice(2, 8)}`,
    source,
    table,
    flight: flight || 'UNKNOWN',
    dep: dep || '—',
    arr: arr || '—',
    std,
    sta,
    etd,
    eta,
    atd,
    ata,
    firstSeen,
    lastSeen,
    ended,
    status,
    raw,
  };
}

function classify(f, nowMs) {
  const std = asMs(f.std);
  const sta = asMs(f.sta);
  const etd = asMs(f.etd) || std;
  const eta = asMs(f.eta) || sta;
  const atd = asMs(f.atd);
  const ata = asMs(f.ata);
  const first = asMs(f.firstSeen);
  const lower = (f.status || '').toLowerCase();

  if ((ata > 0 && nowMs - ata <= 45 * 60_000) || lower === 'landed' || lower === 'arrived') return 'just_landed';
  if (f.ended && (ata > 0 || asMs(f.lastSeen) > 0)) return 'just_landed';
  if ((lower === 'en-route' || lower === 'en_route' || lower === 'active') && eta > nowMs && eta - nowMs <= 30 * 60_000) return 'approaching_landing';
  if ((lower === 'en-route' || lower === 'en_route' || lower === 'active') && (eta > nowMs + 30 * 60_000 || eta === 0)) return 'cruise';
  if (atd > 0 && nowMs >= atd && nowMs - atd <= 20 * 60_000) return 'just_departed';
  if ((first > 0 && atd === 0 && nowMs >= first) || lower === 'taxi_out') return 'taxi_out';
  if (etd > nowMs && etd - nowMs <= 90 * 60_000) return 'departing_soon';

  const depRef = etd || std;
  if (depRef > nowMs) {
    const hour = new Date(depRef).getUTCHours();
    if (hour >= 15 && hour <= 21) return 'evening_departure';
  }
  return 'other';
}

function bestByBucket(list, bucket) {
  const filtered = list.filter((x) => x.bucket === bucket);
  if (filtered.length === 0) return null;
  const score = (x) => {
    const depRef = asMs(x.etd) || asMs(x.std) || 0;
    const arrRef = asMs(x.eta) || asMs(x.sta) || 0;
    if (bucket === 'just_landed') return Math.abs(Date.now() - (asMs(x.ata) || asMs(x.lastSeen) || arrRef || depRef || 0));
    if (bucket === 'approaching_landing') return Math.abs((arrRef || Date.now()) - Date.now());
    if (bucket === 'cruise') return Math.abs((arrRef || Date.now() + 60 * 60_000) - Date.now());
    if (bucket === 'just_departed') return Math.abs(Date.now() - (asMs(x.atd) || depRef || 0));
    if (bucket === 'taxi_out') return Math.abs(Date.now() - (asMs(x.firstSeen) || depRef || 0));
    if (bucket === 'departing_soon') return Math.abs((depRef || Date.now()) - Date.now());
    if (bucket === 'evening_departure') return depRef || Number.MAX_SAFE_INTEGER;
    return depRef || arrRef || Number.MAX_SAFE_INTEGER;
  };
  return [...filtered].sort((a, b) => score(a) - score(b))[0];
}

function uniqueByFlight(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (!x) continue;
    const k = `${x.flight}:${x.dep}:${x.arr}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

async function fetchFr24AirportLight(airport) {
  if (!FR24_TOKEN) return { ok: false, reason: 'FR24 token missing', rows: [] };
  const url = `https://fr24api.flightradar24.com/api/static/airports/${encodeURIComponent(airport)}/light`;
  try {
    const res = await fetch(url, { headers: FR24_HEADERS });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, reason: `FR24 HTTP ${res.status}`, rows: [], meta: json };
    const payload = json?.data ?? json ?? {};
    const departures = Array.isArray(payload.departures) ? payload.departures : [];
    const arrivals = Array.isArray(payload.arrivals) ? payload.arrivals : [];
    const depRows = departures.map((x) => normalizeFlight(x, 'FR24', 'departures'));
    const arrRows = arrivals.map((x) => normalizeFlight(x, 'FR24', 'arrivals'));
    const rows = [...depRows, ...arrRows];
    if (rows.length === 0) {
      return {
        ok: false,
        reason: 'FR24 airport/light did not include arrivals/departures tables for this token/plan',
        rows: [],
        meta: { departures: 0, arrivals: 0 },
      };
    }
    return { ok: true, reason: 'ok', rows, meta: { departures: departures.length, arrivals: arrivals.length } };
  } catch (e) {
    return { ok: false, reason: `FR24 exception: ${String(e)}`, rows: [] };
  }
}

async function fetchAirLabsSchedules(airport) {
  if (!AIRLABS_KEY) return { ok: false, reason: 'AirLabs key missing', rows: [] };
  const base = 'https://airlabs.co/api/v9/schedules';
  const mk = async (params) => {
    const u = new URL(base);
    u.searchParams.set('api_key', AIRLABS_KEY);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    const res = await fetch(u.toString());
    const json = await res.json().catch(() => null);
    const err = json?.error;
    if (!res.ok || err) return { ok: false, status: res.status, err: err || 'http_error', data: [] };
    const data = Array.isArray(json?.response) ? json.response : [];
    return { ok: true, status: res.status, data };
  };
  const dep = await mk({ dep_iata: airport, limit: 80 });
  const arr = await mk({ arr_iata: airport, limit: 80 });
  if (!dep.ok && !arr.ok) {
    const reason = dep.err?.code || arr.err?.code || `AirLabs HTTP dep=${dep.status} arr=${arr.status}`;
    return { ok: false, reason, rows: [] };
  }
  const depRows = (dep.data || []).map((x) => normalizeFlight(x, 'AIRLABS', 'departures'));
  const arrRows = (arr.data || []).map((x) => normalizeFlight(x, 'AIRLABS', 'arrivals'));
  return { ok: true, reason: 'ok', rows: [...depRows, ...arrRows], meta: { departures: depRows.length, arrivals: arrRows.length } };
}

function printSelection(rows, notes) {
  console.log('\n' + line('═', 110));
  console.log(` SAW Phase Sample (${rows.length}/${SAMPLE_SIZE})`);
  console.log(line('═', 110));
  if (notes.length) {
    notes.forEach((n) => console.log(' - ' + n));
    console.log(line('─', 110));
  }
  const cols = [
    { h: '#', w: 2, f: (_, i) => String(i + 1) },
    { h: 'Bucket', w: 18, f: (r) => r.bucket },
    { h: 'Flight', w: 10, f: (r) => r.flight },
    { h: 'Table', w: 10, f: (r) => r.table },
    { h: 'Route', w: 13, f: (r) => `${r.dep}→${r.arr}` },
    { h: 'Status', w: 12, f: (r) => r.status || '—' },
    { h: 'STD(UTC)', w: 16, f: (r) => (r.std || '').replace('T', ' ').slice(0, 16) || '—' },
    { h: 'ETA/STA(UTC)', w: 16, f: (r) => ((r.eta || r.sta || '').replace('T', ' ').slice(0, 16)) || '—' },
    { h: 'Source', w: 8, f: (r) => r.source },
  ];
  let header = '│';
  let bar = '├';
  for (const c of cols) {
    header += ' ' + cell(c.h, c.w) + ' │';
    bar += '─'.repeat(c.w + 2) + '┼';
  }
  console.log(header);
  console.log(bar.slice(0, -1) + '┤');
  rows.forEach((r, i) => {
    let row = '│';
    for (const c of cols) row += ' ' + cell(c.f(r, i), c.w) + ' │';
    console.log(row);
  });
  console.log(line('─', 110));
}

async function main() {
  const notes = [];
  const nowMs = Date.now();

  let all = [];
  const fr = await fetchFr24AirportLight(SAW);
  if (fr.ok && fr.rows.length > 0) {
    notes.push(`FR24 SAW light ok (dep=${fr.meta.departures}, arr=${fr.meta.arrivals})`);
    all = fr.rows;
  } else {
    notes.push(`FR24 unavailable: ${fr.reason}`);
  }

  if (all.length < 20) {
    const al = await fetchAirLabsSchedules(SAW);
    if (al.ok && al.rows.length > 0) {
      notes.push(`AirLabs schedules ok (dep=${al.meta.departures}, arr=${al.meta.arrivals})`);
      all = [...all, ...al.rows];
    } else {
      notes.push(`AirLabs unavailable: ${al.reason}`);
    }
  }

  if (all.length === 0) {
    console.log('\nNo flight data available from FR24/AirLabs.');
    notes.forEach((n) => console.log(' - ' + n));
    process.exit(1);
  }

  const withBuckets = uniqueByFlight(all).map((x) => ({ ...x, bucket: classify(x, nowMs) }));
  const desired = [
    'just_landed',
    'approaching_landing',
    'cruise',
    'just_departed',
    'taxi_out',
    'departing_soon',
    'evening_departure',
  ];
  const picked = [];
  for (const b of desired) {
    const one = bestByBucket(withBuckets, b);
    if (one) picked.push(one);
  }

  const already = new Set(picked.map((x) => `${x.flight}:${x.dep}:${x.arr}`));
  const rest = withBuckets
    .filter((x) => !already.has(`${x.flight}:${x.dep}:${x.arr}`))
    .sort((a, b) => {
      const ta = asMs(a.etd) || asMs(a.std) || asMs(a.eta) || asMs(a.sta) || Number.MAX_SAFE_INTEGER;
      const tb = asMs(b.etd) || asMs(b.std) || asMs(b.eta) || asMs(b.sta) || Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });

  while (picked.length < SAMPLE_SIZE && rest.length > 0) picked.push(rest.shift());
  printSelection(picked.slice(0, SAMPLE_SIZE), notes);

  const bucketCount = {};
  withBuckets.forEach((x) => { bucketCount[x.bucket] = (bucketCount[x.bucket] || 0) + 1; });
  console.log('Bucket dağılımı:', JSON.stringify(bucketCount));
  console.log('Toplam aday uçuş:', withBuckets.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

