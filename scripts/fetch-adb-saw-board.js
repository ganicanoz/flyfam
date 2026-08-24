#!/usr/bin/env node
/**
 * AeroDataBox RapidAPI — SAW havalimanı kalkış/varış listesi (örnek).
 *
 *   node scripts/fetch-adb-saw-board.js [YYYY-MM-DD]
 *
 * Anahtar: kök `.env` veya `mobile/.env` içinde
 *   AERODATABOX_APIMARKET_KEY (birincil, x-magicapi-key)
 *   AERODATABOX_RAPIDAPI_KEY | EXPO_PUBLIC_RAPIDAPI_KEY | RAPIDAPI_KEY (yedek)
 *
 * Not: API penceresi ~12 saatten uzun olamaz (400). Günü ikiye böleriz.
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
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  });
}

loadEnv(path.join(projectRoot, '.env'));
loadEnv(path.join(projectRoot, 'mobile', '.env'));

const APIMARKET_KEY = process.env.AERODATABOX_APIMARKET_KEY || '';
const APIMARKET_BASE = (
  process.env.AERODATABOX_APIMARKET_BASE || 'https://prod.api.market/api/v1/aedbx/aerodatabox'
).replace(/\/$/, '');
const RAPID_KEY =
  process.env.AERODATABOX_RAPIDAPI_KEY ||
  process.env.EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY ||
  process.env.EXPO_PUBLIC_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  '';
const SKIP_RAPID =
  process.env.AERODATABOX_SKIP_RAPIDAPI === '1' || process.env.AERODATABOX_SKIP_RAPIDAPI === 'true';

const BASE = 'https://aerodatabox.p.rapidapi.com';
const COMMON =
  'withLeg=true&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false';

function normFlightNo(s) {
  return String(s || '')
    .replace(/\s/g, '')
    .toUpperCase();
}

async function fetchBoard(label, url) {
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
      'x-rapidapi-key': KEY,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _parseError: true, preview: text.slice(0, 400) };
  }
  const arrivals = json?.arrivals;
  const departures = json?.departures;
  const list = Array.isArray(arrivals) ? arrivals : Array.isArray(departures) ? departures : [];
  console.log(`\n--- ${label} ---`);
  console.log('HTTP', res.status, '| kayıt:', list.length);
  if (!res.ok) {
    console.log(typeof json === 'object' ? JSON.stringify(json).slice(0, 500) : text.slice(0, 500));
    return { label, status: res.status, count: 0, sample: null };
  }
  const want = process.argv.slice(3).filter((x) => /^[A-Z]{2}\d+$/i.test(x.replace(/\s/g, '')));
  for (const w of want) {
    const hit = list.find((x) => normFlightNo(x.number) === normFlightNo(w));
    if (hit) {
      console.log('Eşleşme', normFlightNo(w), '→', hit.status, '|', hit.number);
      console.log(
        JSON.stringify(
          {
            departure: hit.departure?.scheduledTime,
            arrival: hit.arrival?.scheduledTime,
            predicted: hit.arrival?.predictedTime ?? hit.departure?.predictedTime,
          },
          null,
          2,
        ),
      );
    } else {
      console.log('Eşleşme yok:', normFlightNo(w));
    }
  }
  if (list.length && want.length === 0) {
    console.log('İlk 5 numara:', list.slice(0, 5).map((x) => x.number));
  }
  return { label, status: res.status, count: list.length, sample: list[0] ?? null };
}

async function main() {
  const day = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log('Tarih (yerel SAW pencereleri):', day);
  console.log('İsteğe bağlı: uçuş numaraları argüman olarak, örn. node scripts/fetch-adb-saw-board.js', day, 'PC2009 PC2008');

  const next = nextCalendarDay(day);
  const jobs = [
    [
      `SAW Arr ${day} 00:00–12:00`,
      `${BASE}/flights/airports/iata/SAW/${day}T00:00/${day}T12:00?direction=Arrival&${COMMON}`,
    ],
    [
      `SAW Arr ${day} 12:00–${next} 00:00`,
      `${BASE}/flights/airports/iata/SAW/${day}T12:00/${next}T00:00?direction=Arrival&${COMMON}`,
    ],
    [
      `SAW Dep ${day} 00:00–12:00`,
      `${BASE}/flights/airports/iata/SAW/${day}T00:00/${day}T12:00?direction=Departure&${COMMON}`,
    ],
    [
      `SAW Dep ${day} 12:00–${next} 00:00`,
      `${BASE}/flights/airports/iata/SAW/${day}T12:00/${next}T00:00?direction=Departure&${COMMON}`,
    ],
  ];

  for (const [label, url] of jobs) {
    await fetchBoard(label, url);
    await new Promise((r) => setTimeout(r, 2600));
  }
}

function nextCalendarDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
