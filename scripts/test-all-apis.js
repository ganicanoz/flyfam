#!/usr/bin/env node
/**
 * Tüm uçuş API'lerinden gelen veriyi tek ekranda toplar: FR24, Aviation Edge (live + timetable).
 * Terminalde: node scripts/test-all-apis.js PC437 [YYYY-MM-DD]
 *   veya:     FLIGHT=PC437 [DATE=2026-03-15] node scripts/test-all-apis.js
 *   veya:     npm run test-all-apis -- PC437 2026-03-15
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  });
}
loadEnv(path.join(projectRoot, '.env'));
loadEnv(path.join(projectRoot, 'mobile', '.env'));

const FR24_TOKEN = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN || process.env.FR24_API_TOKEN;
const AE_KEY = process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY || process.env.AVIATION_EDGE_API_KEY;

const flightArg = process.argv[2] || process.env.FLIGHT;
const dateArg = process.argv[3] || process.env.DATE;
const flight = (flightArg || 'PC437').trim().toUpperCase().replace(/\s/g, '');
const today = () => new Date().toISOString().slice(0, 10);
const date = (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(String(dateArg).trim())) ? String(dateArg).trim() : today();

// --- helpers ---
const IATA_TO_ICAO = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };
function variants(num) {
  const raw = (num || '').replace(/\s/g, '').toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const v = [raw];
  const m = raw.match(/^([A-Z]{2})(\d+)$/);
  if (m) {
    const code = m[1], n = m[2];
    if (n.length === 3) v.push(code + '0' + n);
    if (n.length === 4 && n.startsWith('0')) v.push(code + n.slice(1));
    const icao = IATA_TO_ICAO[code];
    if (icao) { v.push(icao + n); if (n.length === 3) v.push(icao + '0' + n); }
  }
  return [...new Set(v)];
}

function box(title, lines) {
  const width = 72;
  const border = '═'.repeat(width);
  const pad = (s) => String(s).padEnd(width - 2).slice(0, width - 2);
  const out = ['\n╔' + border + '╗', '║ ' + pad(title) + ' ║', '╠' + border + '╣'];
  for (const block of lines) {
    for (const line of String(block).split('\n').filter(Boolean)) out.push('║ ' + pad(line) + ' ║');
  }
  out.push('╚' + border + '╝');
  return out.join('\n');
}

function kv(key, value) {
  const v = value == null || value === '' ? '—' : String(value);
  return (key + ':').padEnd(22) + v;
}

async function fetchFr24() {
  if (!FR24_TOKEN) return { ok: false, error: 'No FR24 token', data: null, raw: [] };
  const flightsParam = variants(flight).slice(0, 15).join(',');
  const [y, m, d] = date.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0)).toISOString().slice(0, 19);
  const to = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59)).toISOString().slice(0, 19);
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${FR24_TOKEN}`, Accept: 'application/json', 'Accept-Version': 'v1' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `${res.status} ${json?.error || json?.message || ''}`, data: null, raw: json?.data || [] };
    const list = json?.data || [];
    const live = list.find((x) => x?.flight_ended === false || x?.flightEnded === false);
    const f = live || list[0] || null;
    const data = f ? {
      origin: (f.orig_icao ?? f.origin_icao ?? '').toString(),
      destination: (f.dest_icao ?? f.destination_icao ?? '').toString(),
      flight_ended: f.flight_ended ?? f.flightEnded,
      scheduled_departure_utc: f.scheduled_departure_utc ?? f.scheduled_departure,
      scheduled_arrival_utc: f.scheduled_arrival_utc ?? f.scheduled_arrival,
      first_seen: f.first_seen ?? f.firstSeen,
      last_seen: f.last_seen ?? f.lastSeen,
      datetime_takeoff: f.datetime_takeoff ?? f.datetimeTakeoff,
      datetime_landed: f.datetime_landed ?? f.datetimeLanded,
      ground_speed: f.ground_speed,
      altitude: f.altitude,
    } : null;
    return { ok: true, data, raw: list };
  } catch (e) {
    return { ok: false, error: e.message, data: null, raw: [] };
  }
}

async function fetchAeLive() {
  if (!AE_KEY) return { ok: false, error: 'No AE key', data: null };
  for (const fn of variants(flight).filter((v) => /^[A-Z]{2,3}\d+$/.test(v))) {
    try {
      const url = `https://aviation-edge.com/v2/public/flights?key=${encodeURIComponent(AE_KEY)}&flightIata=${encodeURIComponent(fn)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      const list = Array.isArray(data) ? data : (data?.data ?? []);
      if (list.length === 0) continue;
      const x = list[0];
      return {
        ok: true,
        data: {
          origin: (x.departure?.iataCode ?? x.departure?.icaoCode ?? '').toString(),
          destination: (x.arrival?.iataCode ?? x.arrival?.icaoCode ?? '').toString(),
          status: x.status,
          scheduled_dep: x.departure?.scheduledTime ?? x.departure?.estimatedTime,
          scheduled_arr: x.arrival?.scheduledTime ?? x.arrival?.estimatedTime,
          actual_dep: x.departure?.actualTime,
          actual_arr: x.arrival?.actualTime,
          lat: x.geography?.latitude,
          lon: x.geography?.longitude,
          alt_m: x.geography?.altitude ?? x.altitude,
          aircraft: x.aircraft?.iataCode ?? x.aircraft?.registration,
        },
      };
    } catch (e) { continue; }
  }
  return { ok: true, data: null };
}

async function fetchAeTimetable() {
  if (!AE_KEY) return { ok: false, error: 'No AE key', data: null };
  const hubs = ['IST', 'SAW', 'ADB', 'AYT', 'ESB', 'ECN'];
  for (const airport of hubs) {
    for (const fn of variants(flight).filter((v) => /^[A-Z]{2,3}\d+$/.test(v))) {
      try {
        const url = `https://aviation-edge.com/v2/public/timetable?key=${encodeURIComponent(AE_KEY)}&iataCode=${airport}&type=departure&flight_iata=${encodeURIComponent(fn)}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => null);
        const list = Array.isArray(data) ? data : (data?.data ?? []);
        const match = list.find((x) => (x.departure?.scheduledTime || '').slice(0, 10) === date);
        if (!match || !match.departure || !match.arrival) continue;
        const dep = match.departure, arr = match.arrival;
        return {
          ok: true,
          data: {
            origin: (dep.icaoCode ?? dep.iataCode ?? '').toString(),
            destination: (arr.icaoCode ?? arr.iataCode ?? '').toString(),
            status: match.status,
            scheduled_dep: dep.scheduledTime ?? dep.estimatedTime,
            scheduled_arr: arr.scheduledTime ?? arr.estimatedTime,
            actual_dep: dep.actualTime,
            actual_arr: arr.actualTime,
            delay_dep: dep.delay,
            delay_arr: arr.delay,
          },
        };
      } catch (e) { continue; }
    }
  }
  return { ok: true, data: null };
}

async function main() {
  console.log(box(`UÇUŞ: ${flight}  |  TARİH: ${date}`, [
    'Tüm API yanıtları aşağıda bir arada.',
  ]));

  const [fr24, aeLive, aeTimetable] = await Promise.all([
    fetchFr24(),
    fetchAeLive(),
    fetchAeTimetable(),
  ]);

  const lines = [];
  lines.push(kv('Token/Key', FR24_TOKEN ? 'FR24 ✓' : 'FR24 —') + '  ' + (AE_KEY ? 'AE ✓' : 'AE —'));
  console.log(box('1) FR24 (flight-summary/light)', [
    kv('Durum', fr24.ok ? (fr24.raw?.length ? `${fr24.raw.length} bacak` : '0 bacak') : fr24.error),
    fr24.data ? [
      kv('Origin', fr24.data.origin),
      kv('Destination', fr24.data.destination),
      kv('flight_ended', fr24.data.flight_ended),
      kv('scheduled_departure_utc', fr24.data.scheduled_departure_utc),
      kv('scheduled_arrival_utc', fr24.data.scheduled_arrival_utc),
      kv('first_seen', fr24.data.first_seen),
      kv('last_seen', fr24.data.last_seen),
      kv('datetime_takeoff', fr24.data.datetime_takeoff),
      kv('datetime_landed', fr24.data.datetime_landed),
      kv('ground_speed', fr24.data.ground_speed),
      kv('altitude', fr24.data.altitude),
    ].join('\n') : '',
  ].filter(Boolean).flat().slice(0, 20)));

  console.log(box('2) Aviation Edge – Live (flights)', [
    kv('Durum', aeLive.ok ? (aeLive.data ? 'Bulundu' : 'Bulunamadı') : aeLive.error),
    aeLive.data ? [
      kv('Origin', aeLive.data.origin),
      kv('Destination', aeLive.data.destination),
      kv('status', aeLive.data.status),
      kv('scheduled_dep', aeLive.data.scheduled_dep),
      kv('scheduled_arr', aeLive.data.scheduled_arr),
      kv('actual_dep', aeLive.data.actual_dep),
      kv('actual_arr', aeLive.data.actual_arr),
      kv('position', [aeLive.data.lat, aeLive.data.lon].filter(Boolean).length ? `${aeLive.data.lat}, ${aeLive.data.lon}` : '—'),
      kv('alt(m)', aeLive.data.alt_m),
      kv('aircraft', aeLive.data.aircraft),
    ].join('\n') : '',
  ].filter(Boolean).flat().slice(0, 18)));

  console.log(box(`3) Aviation Edge – Timetable (${date})`, [
    kv('Durum', aeTimetable.ok ? (aeTimetable.data ? 'Bulundu' : 'Bu tarihte yok') : aeTimetable.error),
    aeTimetable.data ? [
      kv('Origin', aeTimetable.data.origin),
      kv('Destination', aeTimetable.data.destination),
      kv('status', aeTimetable.data.status),
      kv('scheduled_dep', aeTimetable.data.scheduled_dep),
      kv('scheduled_arr', aeTimetable.data.scheduled_arr),
      kv('actual_dep', aeTimetable.data.actual_dep),
      kv('actual_arr', aeTimetable.data.actual_arr),
      kv('delay_dep', aeTimetable.data.delay_dep),
      kv('delay_arr', aeTimetable.data.delay_arr),
    ].join('\n') : '',
  ].filter(Boolean).flat().slice(0, 16)));

  const summary = [];
  const origin = fr24.data?.origin || aeLive.data?.origin || aeTimetable.data?.origin || '—';
  const dest = fr24.data?.destination || aeLive.data?.destination || aeTimetable.data?.destination || '—';
  summary.push(kv('Rota', `${origin} → ${dest}`));
  summary.push(kv('FR24', fr24.data ? (fr24.data.flight_ended === false ? 'canlı' : fr24.data.flight_ended === true ? 'bitmiş' : '—') : '—'));
  summary.push(kv('AE Live status', aeLive.data?.status ?? '—'));
  summary.push(kv('AE Timetable status', aeTimetable.data?.status ?? '—'));
  console.log(box('ÖZET (tüm kaynaklar bir arada)', summary));

  console.log('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
