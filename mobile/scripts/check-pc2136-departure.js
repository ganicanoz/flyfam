/**
 * Print raw departure time the APIs return for PC2136 (or any flight).
 * Usage: cd mobile && node scripts/check-pc2136-departure.js [FLIGHT] [YYYY-MM-DD]
 * Example: node scripts/check-pc2136-departure.js PC2136 2026-02-15
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
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
}

const flightNumber = (process.argv[2] || 'PC2136').toUpperCase().replace(/\s/g, '');
const date = process.argv[3] || new Date().toISOString().slice(0, 10);

const AVIATION_EDGE_KEY = process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY;
const FR24_TOKEN = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;

async function aviationEdgeTimetable() {
  if (!AVIATION_EDGE_KEY) {
    console.log('Aviation Edge: no EXPO_PUBLIC_AVIATION_EDGE_API_KEY in .env\n');
    return;
  }
  const hubs = ['IST', 'SAW', 'ADB', 'AYT', 'ESB'];
  const variants = [flightNumber];
  const match = flightNumber.match(/^([A-Z]{2})(\d+)$/);
  if (match) {
    const [, code, num] = match;
    if (num.length === 3) variants.push(`${code}0${num}`);
  }
  console.log('=== Aviation Edge Timetable (raw) ===');
  console.log('Flight:', flightNumber, '| Date:', date);
  for (const airport of hubs) {
    for (const fn of variants.filter((v) => /^[A-Z]{2}\d+$/.test(v))) {
      const url = `https://aviation-edge.com/v2/public/timetable?key=${encodeURIComponent(AVIATION_EDGE_KEY)}&iataCode=${airport}&type=departure&flight_iata=${fn}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      const list = Array.isArray(data) ? data : data?.data ?? [];
      const f = list.find((x) => (x.departure?.scheduledTime ?? '').slice(0, 10) === date) ?? list[0];
      if (f?.departure?.scheduledTime != null || f?.departure?.estimatedTime != null) {
        const dep = f.departure;
        const arr = f.arrival;
        console.log('  Airport:', airport, '| Match:', fn);
        console.log('  departure.scheduledTime:', JSON.stringify(dep.scheduledTime));
        console.log('  departure.estimatedTime:', JSON.stringify(dep.estimatedTime));
        console.log('  departure.actualTime:', JSON.stringify(dep.actualTime));
        console.log('  arrival.scheduledTime:', JSON.stringify(arr?.scheduledTime));
        console.log('  (No Z/offset = API is likely local time at airport)');
        console.log('');
        return;
      }
    }
  }
  console.log('  No flight found on', date);
  console.log('');
}

async function fr24() {
  if (!FR24_TOKEN) {
    console.log('Flightradar24: no EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN in .env\n');
    return;
  }
  const variants = [flightNumber];
  const match = flightNumber.match(/^([A-Z]{2})(\d+)$/);
  if (match) {
    const [, code, num] = match;
    if (num.length === 3) variants.push(`${code}0${num}`);
    const icao = { PC: 'PGT', TK: 'THY', XQ: 'SXS' }[code];
    if (icao) variants.push(`${icao}${num}`, num.length === 3 ? `${icao}0${num}` : null);
  }
  const flightsParam = variants.filter(Boolean).slice(0, 15).join(',');
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19).replace('T', ' ');
  const to = toDate.toISOString().slice(0, 19).replace('T', ' ');
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  console.log('=== Flightradar24 (raw) ===');
  console.log('Flight:', flightNumber, '| Date:', date);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${FR24_TOKEN}`,
      Accept: 'application/json',
      'Accept-Version': 'v1',
    },
  });
  const json = await res.json().catch(() => null);
  const list = json?.data || [];
  const onDay = list.filter((x) => {
    const t = x.scheduled_departure_utc ?? x.scheduled_departure ?? x.datetime_takeoff ?? x.first_seen;
    return t && String(t).slice(0, 10) === date;
  });
  const show = onDay.length ? onDay : list.slice(0, 2);
  show.forEach((f, i) => {
    console.log('  --- Flight', i + 1, '---');
    console.log('  scheduled_departure:', JSON.stringify(f.scheduled_departure));
    console.log('  scheduled_departure_utc:', JSON.stringify(f.scheduled_departure_utc));
    console.log('  scheduled_arrival:', JSON.stringify(f.scheduled_arrival));
    console.log('  scheduled_arrival_utc:', JSON.stringify(f.scheduled_arrival_utc));
    console.log('  datetime_takeoff:', JSON.stringify(f.datetime_takeoff));
    console.log('  (FR24 documents times as UTC)');
  });
  if (show.length === 0) console.log('  No flight found on', date);
  console.log('');
}

async function run() {
  await aviationEdgeTimetable();
  await fr24();
}

run();
