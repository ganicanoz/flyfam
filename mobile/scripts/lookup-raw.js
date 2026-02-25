/**
 * Fetch a flight from Flightradar24 and print ALL time-related fields (raw).
 * Usage: node scripts/lookup-raw.js <FLIGHT_NUMBER> <YYYY-MM-DD>
 * Example: node scripts/lookup-raw.js PC1178 2026-02-20
 *
 * This shows exactly what FR24 returns so we can verify departure/arrival times.
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

const flightNumber = (process.argv[2] || 'PC1178').toUpperCase().replace(/\s/g, '');
const date = process.argv[3] || new Date().toISOString().slice(0, 10);

const token = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
if (!token) {
  console.log('Missing EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN in .env');
  process.exit(1);
}

const variants = [flightNumber];
const match = flightNumber.match(/^([A-Z]{2})(\d+)$/);
if (match) {
  const [, code, num] = match;
  if (num.length === 3) variants.push(`${code}0${num}`);
  const icao = { PC: 'PGT', TK: 'THY', XQ: 'SXS' }[code];
  if (icao) variants.push(`${icao}${num}`, num.length === 3 ? `${icao}0${num}` : null);
}
const flightsParam = variants.filter(Boolean).join(',');

async function run() {
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19).replace('T', ' ');
  const to = toDate.toISOString().slice(0, 19).replace('T', ' ');
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  console.log('=== Flightradar24 raw response ===');
  console.log('Flight:', flightNumber, '| Date:', date);
  console.log('URL (truncated):', url.slice(0, 100) + '...');
  console.log('');
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Version': 'v1',
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.log('Status:', res.status, json?.error || json?.message);
    return;
  }
  const list = json?.data || [];
  const onDay = list.filter((x) => {
    const t = x.datetime_takeoff ?? x.first_seen;
    return t && String(t).slice(0, 10) === date;
  });
  console.log('Flights on', date, ':', onDay.length);
  console.log('Total in window:', list.length);
  console.log('');
  const show = onDay.length ? onDay : list.slice(0, 2);
  show.forEach((f, i) => {
    console.log('--- Flight', i + 1, '---');
    const timeFields = [
      'scheduled_departure',
      'scheduled_departure_utc',
      'scheduled_arrival',
      'scheduled_arrival_utc',
      'datetime_takeoff',
      'datetime_landed',
      'first_seen',
      'last_seen',
    ];
    timeFields.forEach((k) => {
      const v = f[k];
      if (v != null) {
        console.log('  ', k + ':', JSON.stringify(v));
        const date = new Date(v);
        if (!Number.isNaN(date.getTime())) {
          console.log('      → UTC:', date.toISOString(), '| Local (Turkey):', date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }));
        }
      }
    });
    console.log('  origin_icao:', f.origin_icao, '| destination_icao:', f.destination_icao);
    console.log('');
  });
  console.log('App uses: departure = datetime_takeoff (or first_seen); arrival = datetime_landed (or last_seen)');
}

run();
