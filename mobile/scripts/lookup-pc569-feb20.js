/**
 * Lookup PC569 on 20 Feb - print raw FR24 response to debug time (22:13 vs 01:05 UTC).
 * Run: cd mobile && node scripts/lookup-pc569-feb20.js
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

const token = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
const date = '2026-02-20';
const flightsParam = 'PC569,PC0569,PGT569,PGT0569';

async function run() {
  if (!token) {
    console.log('No EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN in .env');
    return;
  }
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19).replace('T', ' ');
  const to = toDate.toISOString().slice(0, 19).replace('T', ' ');
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  console.log('=== PC569 on', date, '===');
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Version': 'v1',
    },
  });
  const json = await res.json().catch(() => null);
  console.log('Status:', res.status);
  const list = json?.data || [];
  const onDay = list.filter((x) => {
    const t = x.datetime_takeoff ?? x.first_seen;
    return t && String(t).slice(0, 10) === date;
  });
  console.log('Flights on', date, ':', onDay.length);
  onDay.forEach((f, i) => {
    console.log('\n--- Flight', i + 1, '---');
    ['scheduled_departure', 'scheduled_departure_utc', 'scheduled_arrival', 'scheduled_arrival_utc', 'datetime_takeoff', 'datetime_landed', 'first_seen', 'last_seen', 'origin_icao', 'destination_icao'].forEach((k) => {
      if (f[k] != null) console.log('  ', k, ':', JSON.stringify(f[k]));
    });
    const dep = f.scheduled_departure ?? f.scheduled_departure_utc ?? f.datetime_takeoff ?? f.first_seen;
    const arr = f.scheduled_arrival ?? f.scheduled_arrival_utc ?? f.datetime_landed ?? f.last_seen;
    if (dep) {
      const d = new Date(dep);
      console.log('  Parsed dep (UTC):', d.toISOString(), '->', d.toLocaleTimeString('en-GB', { timeZone: 'UTC' }));
    }
    if (arr) {
      const d = new Date(arr);
      console.log('  Parsed arr (UTC):', d.toISOString(), '->', d.toLocaleTimeString('en-GB', { timeZone: 'UTC' }));
    }
  });
  if (onDay.length === 0 && list.length > 0) {
    console.log('\nSample flight (other day):');
    const f = list[0];
    ['datetime_takeoff', 'first_seen', 'scheduled_departure', 'scheduled_departure_utc'].forEach((k) => {
      if (f[k] != null) console.log('  ', k, ':', JSON.stringify(f[k]));
    });
  }
}

run();
