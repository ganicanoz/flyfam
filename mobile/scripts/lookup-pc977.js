/**
 * One-off: PC977 durumu (FR24 + aynı statü türetimi). Hiçbir şey değiştirilmez.
 * Run: node scripts/lookup-pc977.js
 */
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  });
}

const token = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
if (!token) {
  console.log('EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN yok.');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

function toUtcIsoAssumeUtc(dt) {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) s = s.length <= 16 ? s + ':00.000Z' : s + 'Z';
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function deriveFr24LiveStatus(nowMs, firstSeenUtc, datetimeTakeoffUtc, datetimeLandedUtc, lastSeenUtc) {
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

const STATUS_LABEL = { scheduled: 'Planlandı', taxi_out: 'Taksi', en_route: 'Kalktı', landed: 'İndi' };

const flightsParam = 'PC977,PC0977,PGT977,PGT0977';

async function run() {
  const [y, m, d] = today.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  console.log('PC977 — FR24 sorgusu (tarih penceresi:', today, '+/- 2 gün)\n');
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Version': 'v1' },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.log('HTTP', res.status, json?.error?.message || json?.message || '');
      return;
    }
    const list = json?.data;
    if (!Array.isArray(list) || list.length === 0) {
      console.log('Bu pencerede bacak yok.');
      return;
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    console.log('Şu an (UTC):', nowIso);
    console.log('Bacak sayısı:', list.length);
    list.forEach((f, i) => {
      const first_seen = toUtcIsoAssumeUtc(f.first_seen ?? f.firstSeen);
      const datetime_takeoff = toUtcIsoAssumeUtc(f.datetime_takeoff ?? f.datetimeTakeoff);
      const datetime_landed = toUtcIsoAssumeUtc(f.datetime_landed ?? f.datetimeLanded);
      const last_seen = toUtcIsoAssumeUtc(f.last_seen ?? f.lastSeen);
      const status = deriveFr24LiveStatus(nowMs, first_seen, datetime_takeoff, datetime_landed, last_seen);
      const origin = (f.origin_icao ?? f.orig_icao ?? '').toUpperCase();
      const dest = (f.destination_icao ?? f.dest_icao ?? f.destination_icao_actual ?? '').toUpperCase();
      console.log('\n--- Bacak', i + 1, '---');
      console.log('  Rota:', origin, '→', dest);
      console.log('  first_seen:     ', first_seen || '(yok)');
      console.log('  datetime_takeoff:', datetime_takeoff || '(yok)');
      console.log('  datetime_landed: ', datetime_landed || '(yok)');
      console.log('  last_seen:      ', last_seen || '(yok)');
      console.log('  Türetilen durum:', status, '→', STATUS_LABEL[status] || status);
    });
  } catch (e) {
    console.log('Hata:', e.message);
  }
}

run();
