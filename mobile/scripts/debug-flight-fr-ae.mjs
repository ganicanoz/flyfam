#!/usr/bin/env node
/**
 * Debug: FR24 flight-summary/light (±1 gün) + AE timetable (tam parametreler).
 *
 * Kullanım:
 *   node scripts/debug-flight-fr-ae.mjs [uçuş] [YYYY-MM-DD]
 *   node scripts/debug-flight-fr-ae.mjs PC2532 2025-03-02
 *
 * .env (mobile): EXPO_PUBLIC_AVIATION_EDGE_API_KEY, EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const mAe = line.match(/^\s*EXPO_PUBLIC_AVIATION_EDGE_API_KEY\s*=\s*(.+)/);
    if (mAe) {
      const v = mAe[1].replace(/^["']|["']$/g, '').trim();
      if (v && v !== 'your-aviation-edge-key') process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY = v;
    }
    const mFr = line.match(/^\s*EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN\s*=\s*(.+)/);
    if (mFr) {
      const v = mFr[1].replace(/^["']|["']$/g, '').trim();
      if (v && v !== 'your-fr24-token') process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN = v;
    }
  }
}

const AE_KEY = process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY;
const FR24_TOKEN = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;

const flightRaw = (process.argv[2] || 'PC2532').replace(/\s/g, '').trim().toUpperCase();
const dateStr = process.argv[3] || '2025-03-02';

const IATA_TO_ICAO = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };
function flightNumberVariants(flightNumber) {
  const raw = String(flightNumber).replace(/\s/g, '').trim().toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const variants = [raw];
  const match = raw.match(/^([A-Z]{2})(\d+)$/);
  if (match) {
    const code = match[1];
    const num = match[2];
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

const AIRLINE_HUBS = {
  PC: ['IST', 'SAW', 'ADB', 'AYT', 'ESB', 'ECN'],
  TK: ['IST', 'SAW', 'ESB', 'ADB', 'ECN'],
  XQ: ['ADB', 'AYT', 'IST', 'SAW', 'ECN'],
  VF: ['ESB', 'SAW', 'AYT', 'IST', 'ADB', 'ECN'],
};
const FALLBACK_HUBS = ['IST', 'SAW', 'ECN', 'LHR', 'FRA', 'AMS', 'CDG', 'MAD', 'BCN'];

function getHubs(flightNumber) {
  const code = String(flightNumber).match(/^[A-Z]{2}/)?.[0] || '';
  return AIRLINE_HUBS[code] || FALLBACK_HUBS;
}

// ---------- FR24: flight-summary/light ±1 gün ----------
async function runFr24Light() {
  if (!FR24_TOKEN) {
    console.log('\n[FR24] Token yok, atlandı.');
    return;
  }
  const variants = flightNumberVariants(flightRaw);
  const flightsParam = variants.slice(0, 15).join(',');
  const [y, m, d] = dateStr.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) - 1, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);

  const params = new URLSearchParams({
    flight_datetime_from: from,
    flight_datetime_to: to,
    flights: flightsParam,
    limit: '20',
  });
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?${params.toString()}`;

  console.log('\n=== FR24 flight-summary/light (±1 gün) ===');
  console.log('Parametreler: flight_datetime_from, flight_datetime_to, flights, limit');
  console.log('  flight_datetime_from:', from);
  console.log('  flight_datetime_to:  ', to);
  console.log('  flights:             ', flightsParam);
  console.log('  limit:              20');
  console.log('URL:', url);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${FR24_TOKEN}`,
      Accept: 'application/json',
      'Accept-Version': 'v1',
    },
  });
  const data = await res.json().catch(() => null);
  console.log('Status:', res.status);
  if (!res.ok) {
    console.log('Body:', JSON.stringify(data, null, 2));
    return;
  }
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  console.log('Bacak sayısı:', list.length);
  if (list.length) console.log('Örnek kayıt:', JSON.stringify(list[0], null, 2));
}

// ---------- AE Timetable: tam parametreler (key, iataCode, type, flight_iata) ----------
async function runAeTimetable() {
  if (!AE_KEY) {
    console.log('\n[AE Timetable] API key yok, atlandı.');
    return;
  }
  const hubs = getHubs(flightRaw);
  const variants = flightNumberVariants(flightRaw).filter((v) => /^[A-Z]{2,3}\d+$/.test(v));

  console.log('\n=== Aviation Edge timetable (tam parametreler) ===');
  console.log('Parametreler: key, iataCode, type, flight_iata (her hub × departure/arrival × variant)');
  console.log('Hubs:', hubs.join(', '));
  console.log('Variants:', variants.join(', '));

  for (const iataCode of hubs) {
    for (const type of ['departure', 'arrival']) {
      for (const flight_iata of variants) {
        const params = new URLSearchParams({
          key: AE_KEY,
          iataCode,
          type,
          flight_iata,
        });
        const url = `https://aviation-edge.com/v2/public/timetable?${params.toString()}`;
        console.log('\n--- AE timetable', iataCode, type, flight_iata, '---');
        console.log('URL:', url);

        const res = await fetch(url);
        const data = await res.json().catch(() => null);
        console.log('Status:', res.status);
        const list = Array.isArray(data) ? data : data?.data ?? [];
        console.log('Kayıt sayısı:', list.length);
        if (list.length) {
          const match = list.find((x) => String(x?.departure?.scheduledTime ?? '').slice(0, 10) === dateStr) ?? list[0];
          console.log('Seçilen tarih eşleşmesi veya ilk:', JSON.stringify(match, null, 2).slice(0, 1500));
        }
      }
    }
  }
}

async function main() {
  console.log('Uçuş:', flightRaw, 'Tarih:', dateStr);
  await runFr24Light();
  await runAeTimetable();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
