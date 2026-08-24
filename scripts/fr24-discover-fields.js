#!/usr/bin/env node
/**
 * Flightradar24 API — uçuşla ilgili ne dönüyor? (FlyFam ile aynı endpoint’ler)
 *
 *   npm run fr24:discover -- PC437 2026-03-24
 *   TRACKS=1 npm run fr24:discover -- TK1 2026-03-24    → flight-tracks örneği
 *   AIRPORT=SAW npm run fr24:discover -- PC1 2026-03-24 → havalimanı /light
 *
 * Token: EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN veya FR24_API_TOKEN (.env)
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

const TOKEN =
  process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN ||
  process.env.FR24_API_TOKEN ||
  '';

const FR24_BASE = 'https://fr24api.flightradar24.com/api';
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/json',
  'Accept-Version': 'v1',
};

const flightArg = (process.argv[2] || process.env.FLIGHT || 'PC437').trim().toUpperCase().replace(/\s/g, '');
const dateArg = process.argv[3] || process.env.DATE || new Date().toISOString().slice(0, 10);
const wantTracks = process.env.TRACKS === '1' || process.argv.includes('--tracks');
const airportCode = (process.env.AIRPORT || '').trim().toUpperCase();

const IATA_TO_ICAO = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

function flightVariants(raw) {
  const v = [raw];
  const m = raw.match(/^([A-Z]{2})(\d+)$/);
  if (m) {
    const code = m[1];
    const n = m[2];
    if (n.length === 3) v.push(code + '0' + n);
    if (n.length === 4 && n.startsWith('0')) v.push(code + n.slice(1));
    const icao = IATA_TO_ICAO[code];
    if (icao) {
      v.push(icao + n);
      if (n.length === 3) v.push(icao + '0' + n);
    }
  }
  return [...new Set(v)].filter(Boolean);
}

function line(ch, w) {
  return ch.repeat(w);
}

function bannerStart(label) {
  const w = 88;
  console.log('\n╔' + line('═', w) + '╗');
  console.log('║ ' + ('BAŞLANGIÇ: ' + label).slice(0, w - 2).padEnd(w - 2) + ' ║');
  console.log('╚' + line('═', w) + '╝');
}

function bannerEnd(label) {
  const w = 88;
  console.log('┌' + line('─', w) + '┐');
  console.log('│ ' + ('BİTİŞ: ' + label).slice(0, w - 2).padEnd(w - 2) + ' │');
  console.log('└' + line('─', w) + '┘\n');
}

function dash(v) {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 48 ? s.slice(0, 47) + '…' : s;
}

function cell(s, w) {
  const t = dash(s);
  return t.length <= w ? t.padEnd(w) : t.slice(0, w - 1) + '…';
}

/** FlyFam flightApi.ts içinde okunan alanlar (referans) */
const FLYFAM_USES = `
  Uygulamanın flight-summary/light bacak objesinden kullandığı alanlar:
  orig_icao, origin_icao · dest_icao, destination_icao, destination_icao_actual
  scheduled_departure_utc, scheduled_departure · scheduled_arrival_utc, scheduled_arrival
  first_seen, firstSeen · datetime_takeoff, datetimeTakeoff
  datetime_landed, datetimeLanded · last_seen, lastSeen
  flight_ended, flightEnded
  reg · fr24_id, fr24Id, id · hex, icao24
  operating_as, operated_as, painted_as · callsign, callSign

  Not: FR24 “light” özetinde gerçek kalkış/iniş saati ayrı alan olarak yok; canlı durum
  first_seen / takeoff / landed / last_seen ile türetiliyor.
`;

function unionKeys(objects) {
  const s = new Set();
  for (const o of objects) {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const k of Object.keys(o)) s.add(k);
    }
  }
  return [...s].sort();
}

async function fetchFlightSummaryLight(flightNumber, date) {
  const variants = flightVariants(flightNumber).slice(0, 15);
  const flightsParam = variants.join(',');
  const [y, m, d] = date.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0)).toISOString().slice(0, 19);
  const to = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59)).toISOString().slice(0, 19);
  const url = `${FR24_BASE}/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  const res = await fetch(url, { headers: HEADERS });
  const json = await res.json().catch(() => null);
  return { res, json, url: url.replace(TOKEN, '***'), from, to, flightsParam };
}

function printLegsTable(list) {
  if (!Array.isArray(list) || list.length === 0) {
    console.log('  (data boş)');
    return;
  }
  const cols = [
    { h: '#', w: 2, f: (_, i) => String(i + 1) },
    { h: 'Rota', w: 11, f: (f) => `${dash(f.orig_icao ?? f.origin_icao)}→${dash(f.dest_icao ?? f.destination_icao)}` },
    { h: 'Bitti?', w: 6, f: (f) => dash(f.flight_ended ?? f.flightEnded) },
    { h: 'Sched kalk', w: 16, f: (f) => dash(f.scheduled_departure_utc ?? f.scheduled_departure) },
    { h: 'Sched var', w: 16, f: (f) => dash(f.scheduled_arrival_utc ?? f.scheduled_arrival) },
    { h: 'first_seen', w: 16, f: (f) => dash(f.first_seen ?? f.firstSeen) },
    { h: 'takeoff', w: 16, f: (f) => dash(f.datetime_takeoff ?? f.datetimeTakeoff) },
    { h: 'landed', w: 16, f: (f) => dash(f.datetime_landed ?? f.datetimeLanded) },
    { h: 'last_seen', w: 16, f: (f) => dash(f.last_seen ?? f.lastSeen) },
    { h: 'fr24_id', w: 12, f: (f) => dash(f.fr24_id ?? f.fr24Id ?? f.id) },
  ];
  let header = '  │';
  let bar = '  ├';
  for (const c of cols) {
    header += ' ' + cell(c.h, c.w) + ' │';
    bar += '─'.repeat(c.w + 2) + '┼';
  }
  console.log(header);
  console.log(bar.slice(0, -1) + '┤');
  list.forEach((f, i) => {
    let out = '  │';
    for (const c of cols) {
      out += ' ' + cell(c.f(f, i), c.w) + ' │';
    }
    console.log(out);
  });
}

function printAllKeysFirstLeg(list) {
  if (!Array.isArray(list) || !list[0]) return;
  const f = list[0];
  console.log('\n  İlk bacak — tüm alanlar (alfabetik):');
  console.log('  ' + line('─', 84));
  for (const k of Object.keys(f).sort()) {
    console.log('  ' + cell(k, 28) + ' │ ' + dash(f[k]));
  }
  console.log('  ' + line('─', 84));
}

async function fetchFlightTracks(flightId) {
  const url = `${FR24_BASE}/flight-tracks?flight_id=${encodeURIComponent(flightId)}`;
  const res = await fetch(url, { headers: HEADERS });
  const json = await res.json().catch(() => null);
  return { res, json, url: url.replace(TOKEN, '***') };
}

async function fetchAirportLight(code) {
  const url = `${FR24_BASE}/static/airports/${encodeURIComponent(code)}/light`;
  const res = await fetch(url, { headers: HEADERS });
  const json = await res.json().catch(() => null);
  return { res, json, url };
}

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error('Tarih YYYY-MM-DD olmalı:', dateArg);
    process.exit(1);
  }
  if (!TOKEN) {
    console.error('EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN veya FR24_API_TOKEN yok.');
    process.exit(1);
  }

  console.log(line('═', 90));
  console.log('  FR24 keşif  │  uçuş=' + flightArg + '  │  tarih=' + dateArg);
  console.log(line('═', 90));
  console.log(FLYFAM_USES);

  bannerStart('flight-summary/light (FlyFam ile aynı sorgu)');
  console.log('  İstek parametreleri:');
  console.log('    flight_datetime_from, flight_datetime_to  (UTC, …T… ilk 19 karakter)');
  console.log('    flights  (virgüllü, en fazla 15 kod: PGT437,PC437,…)');
  console.log('    limit    (örn. 20)');
  console.log('  Header: Authorization: Bearer …, Accept-Version: v1\n');

  const { res, json, url, from, to, flightsParam } = await fetchFlightSummaryLight(flightArg, dateArg);
  console.log('  URL özeti: flight_datetime_from=' + from + ' … to=' + to);
  console.log('  flights=' + flightsParam);
  console.log('  HTTP:', res.status, res.ok ? 'OK' : 'FAIL');

  if (!res.ok) {
    console.log('  Yanıt:', JSON.stringify(json, null, 2).slice(0, 1500));
    bannerEnd('flight-summary/light (hata)');
    process.exit(res.status === 402 ? 0 : 1);
  }

  const list = Array.isArray(json?.data) ? json.data : [];
  console.log('  data[] uzunluğu:', list.length);
  if (json && json.meta != null) console.log('  meta:', JSON.stringify(json.meta).slice(0, 200));

  printLegsTable(list);
  printAllKeysFirstLeg(list);

  const u = unionKeys(list);
  console.log('\n  Tüm bacaklarda görülen alan adları (' + u.length + '):');
  console.log('  ' + u.join(', '));

  bannerEnd('flight-summary/light');

  const firstId = list[0] && (list[0].fr24_id || list[0].fr24Id || list[0].id);
  if (wantTracks && firstId) {
    bannerStart('flight-tracks?flight_id=… (son nokta örneği)');
    const tr = await fetchFlightTracks(String(firstId));
    console.log('  HTTP:', tr.res.status);
    console.log('  Önizleme:', JSON.stringify(tr.json, null, 2).slice(0, 8000));
    if (JSON.stringify(tr.json || {}).length > 8000) console.log('\n  … (kısaltıldı)');
    bannerEnd('flight-tracks');
  } else if (wantTracks) {
    console.log('\n  TRACKS=1 ama fr24_id yok; atlandı.');
  }

  if (airportCode) {
    bannerStart('static/airports/' + airportCode + '/light');
    const ap = await fetchAirportLight(airportCode);
    console.log('  HTTP:', ap.res.status);
    const payload = ap.json?.data ?? ap.json;
    if (payload && typeof payload === 'object') {
      console.log('  Alanlar:', Object.keys(payload).sort().join(', '));
      console.log('  JSON:', JSON.stringify(payload, null, 2).slice(0, 4000));
    } else {
      console.log('  ', JSON.stringify(ap.json, null, 2).slice(0, 2000));
    }
    bannerEnd('airports/light');
  }

  console.log(line('═', 90));
  console.log('  İpucu: TRACKS=1 AIRPORT=SAW npm run fr24:discover -- PC437 ' + dateArg);
  console.log(line('═', 90));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
