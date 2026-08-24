#!/usr/bin/env node
/**
 * Strict test script (app-like): FR24 + AirLabs only.
 * Rule: departure date must EXACTLY equal selected date.
 * Usage: node scripts/test-flight-api.js PC130 [YYYY-MM-DD|tomorrow]
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const flightNumberRaw = process.argv[2];
const dateArg = process.argv[3];
if (!flightNumberRaw) {
  console.error('Usage: node scripts/test-flight-api.js PC130 [date]');
  process.exit(1);
}

const flightNumber = flightNumberRaw.replace(/\s/g, '').trim().toUpperCase();
const fr24Token = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
const airlabsKey = process.env.EXPO_PUBLIC_AIRLABS_API_KEY || process.env.AIRLABS_API_KEY;

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDateArg(arg) {
  if (!arg) return localDate();
  const s = String(arg).trim().toLowerCase();
  if (s === 'tomorrow' || s === 'yarin' || s === 'yarın') {
    const d = new Date(); d.setDate(d.getDate() + 1); return localDate(d);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : localDate();
}
const date = parseDateArg(dateArg);

function toUtcIsoAssumeUtc(dt) {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) s = s.replace(/\.\d+$/, '') + (s.includes('.') ? 'Z' : '.000Z');
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

const IATA_TO_ICAO = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };
function flightNumberVariants(flightNumber) {
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const variants = [raw];
  const m = raw.match(/^([A-Z]{2})(\d+)$/);
  if (m) {
    const [, code, num] = m;
    if (num.length === 3) variants.push(`${code}0${num}`);
    if (num.length === 4 && num.startsWith('0')) variants.push(`${code}${num.slice(1)}`);
    const icao = IATA_TO_ICAO[code];
    if (icao) {
      variants.push(`${icao}${num}`);
      if (num.length === 3) variants.push(`${icao}0${num}`);
    }
  }
  return [...new Set(variants)];
}

function depDateFromFr24(f) {
  const t = f?.scheduled_departure_utc ?? f?.scheduled_departure ?? f?.first_seen ?? f?.datetime_takeoff ?? '';
  const iso = toUtcIsoAssumeUtc(String(t));
  return iso ? iso.slice(0, 10) : '';
}

async function fetchFr24Strict(flightNumber, date) {
  if (!fr24Token) return { normalized: null, raw: [], reason: 'no token' };
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(',');
  const [y, m, d] = date.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0)).toISOString().slice(0, 19);
  const to = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59)).toISOString().slice(0, 19);
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${fr24Token}`, Accept: 'application/json', 'Accept-Version': 'v1' } });
  const json = await res.json().catch(() => null);
  const list = Array.isArray(json?.data) ? json.data : [];
  const sameDay = list.filter((x) => depDateFromFr24(x) === date);
  if (!sameDay.length) return { normalized: null, raw: list, reason: 'no same-day leg' };
  const live = sameDay.find((x) => x?.flight_ended === false || x?.flightEnded === false);
  const f = live || sameDay.sort((a,b)=>{
    const ta = new Date(toUtcIsoAssumeUtc(a?.first_seen ?? a?.scheduled_departure_utc ?? '') || 0).getTime();
    const tb = new Date(toUtcIsoAssumeUtc(b?.first_seen ?? b?.scheduled_departure_utc ?? '') || 0).getTime();
    return tb-ta;
  })[0];
  const out = {
    origin: (f.origin_icao ?? f.orig_icao ?? '').toString(),
    destination: (f.destination_icao_actual ?? f.destination_icao ?? f.dest_icao ?? '').toString(),
    actual_departure_utc: toUtcIsoAssumeUtc(f.datetime_takeoff ?? f.first_seen),
    actual_arrival_utc: toUtcIsoAssumeUtc(f.datetime_landed ?? f.last_seen),
    flight_ended: f.flight_ended ?? f.flightEnded,
    first_seen_utc: toUtcIsoAssumeUtc(f.first_seen ?? f.firstSeen),
    datetime_takeoff_utc: toUtcIsoAssumeUtc(f.datetime_takeoff ?? f.datetimeTakeoff),
    datetime_landed_utc: toUtcIsoAssumeUtc(f.datetime_landed ?? f.datetimeLanded),
    last_seen_utc: toUtcIsoAssumeUtc(f.last_seen ?? f.lastSeen),
    raw: f,
  };
  return { normalized: out, raw: list, reason: 'ok' };
}

async function fetchAirLabsStrict(flightNumber, date) {
  if (!airlabsKey) return { data: null, reason: 'no key' };
  const vars = flightNumberVariants(flightNumber);
  const urls = [];
  for (const v of vars) {
    if (/^[A-Z]{3}\d+$/.test(v)) urls.push(`https://airlabs.co/api/v9/flight?flight_icao=${encodeURIComponent(v)}&api_key=${encodeURIComponent(airlabsKey)}`);
    else urls.push(`https://airlabs.co/api/v9/flight?flight_iata=${encodeURIComponent(v)}&api_key=${encodeURIComponent(airlabsKey)}`);
  }
  for (const url of urls.slice(0, 6)) {
    const res = await fetch(url).catch(() => null);
    if (!res) continue;
    const j = await res.json().catch(() => null);
    if (!res.ok || j?.error) continue;
    const r = j?.response ?? j;
    if (!r || typeof r !== 'object') continue;
    const dep = toUtcIsoAssumeUtc(r.dep_estimated_utc ?? r.dep_time_utc ?? r.dep_estimated ?? r.dep_time);
    if (!dep || dep.slice(0, 10) !== date) continue;
    const arr = toUtcIsoAssumeUtc(r.arr_estimated_utc ?? r.arr_time_utc ?? r.arr_estimated ?? r.arr_time);
    return { data: { source: 'AirLabs', dep, arr, status: r.status ?? null, raw: r }, reason: 'ok' };
  }
  return { data: null, reason: 'no same-day leg' };
}

function deriveFr24Status(nowMs, firstSeenUtc, datetimeTakeoffUtc, datetimeLandedUtc, lastSeenUtc) {
  const first = firstSeenUtc ? new Date(firstSeenUtc).getTime() : 0;
  const takeoff = datetimeTakeoffUtc ? new Date(datetimeTakeoffUtc).getTime() : 0;
  const landed = datetimeLandedUtc ? new Date(datetimeLandedUtc).getTime() : 0;
  const last = lastSeenUtc ? new Date(lastSeenUtc).getTime() : 0;
  if (first > 0 && nowMs < first) return 'scheduled';
  if (first > 0 && (takeoff === 0 || nowMs < takeoff)) return 'taxi_out';
  if (takeoff > 0 && (landed === 0 || nowMs < landed)) return 'en_route';
  if (last > 0 && nowMs >= last) return 'landed';
  if (landed > 0 && nowMs >= landed) return 'landed';
  if (first > 0 && nowMs >= first) return 'taxi_out';
  return 'scheduled';
}

(async function main(){
  console.log('\n========== FLIGHT API TEST (STRICT DATE) ==========' );
  console.log('Flight:', flightNumber, '| Date:', date, dateArg && /tomorrow|yarin|yarın/i.test(dateArg) ? '(tomorrow)' : '');
  console.log('===================================================\n');

  const fr = await fetchFr24Strict(flightNumber, date);
  const al = await fetchAirLabsStrict(flightNumber, date);

  console.log('--- 1) FR24 raw list ---');
  console.log(JSON.stringify({ count: fr.raw.length, reason: fr.reason, flights: fr.raw }, null, 2));

  console.log('\n--- 2) FR24 selected leg (strict) ---');
  console.log(fr.normalized ? JSON.stringify(fr.normalized, null, 2) : '(none)');

  console.log('\n--- 3) AirLabs /flight (strict dep date) ---');
  console.log(al.data ? JSON.stringify(al.data, null, 2) : `(none: ${al.reason})`);

  console.log('\n========== DETERMINED RESULT ==========' );
  let out = null;
  if (fr.normalized) {
    const status = deriveFr24Status(Date.now(), fr.normalized.first_seen_utc, fr.normalized.datetime_takeoff_utc, fr.normalized.datetime_landed_utc, fr.normalized.last_seen_utc);
    out = {
      source: 'FR24_STRICT',
      origin: fr.normalized.origin || null,
      destination: fr.normalized.destination || null,
      scheduled_departure_utc: al.data?.dep || null,
      scheduled_arrival_utc: al.data?.arr || null,
      actual_departure_utc: fr.normalized.actual_departure_utc || null,
      actual_arrival_utc: fr.normalized.actual_arrival_utc || null,
      status,
    };
  } else if (al.data) {
    out = {
      source: 'AIRLABS_STRICT',
      origin: al.data.raw?.dep_icao ?? al.data.raw?.dep_iata ?? null,
      destination: al.data.raw?.arr_icao ?? al.data.raw?.arr_iata ?? null,
      scheduled_departure_utc: al.data.dep || null,
      scheduled_arrival_utc: al.data.arr || null,
      actual_departure_utc: null,
      actual_arrival_utc: null,
      status: String(al.data.status || '').toLowerCase() === 'landed' ? 'landed' : 'scheduled',
    };
  }
  console.log(out ? JSON.stringify(out, null, 2) : '(no same-day leg in FR24/AirLabs)');
  console.log('\n========== END ==========' );
})();
