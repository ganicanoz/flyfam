/**
 * One-off flight lookup (e.g. PC437). Uses FR24 + Aviation Edge.
 * Usage: FLIGHT=PC437 [DATE=2026-03-15] node scripts/lookup-flight.js
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
const flight = (process.env.FLIGHT || 'PC437').trim().toUpperCase();
const date = process.env.DATE || new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const variants = [flight];
const code = flight.match(/^[A-Z]{2,3}/)?.[0] || '';
const num = flight.replace(/^[A-Z]+/, '');
if (num.length === 3) variants.push(code + '0' + num);
if (num.length === 4 && num.startsWith('0')) variants.push(code + num.slice(1));
if (code === 'PC') {
  variants.push('PGT' + num);
  if (num.length === 3) variants.push('PGT0' + num);
}
const flightsParam = variants.slice(0, 15).join(',');

async function main() {
  const [y, m, d] = date.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0)).toISOString().slice(0, 19);
  const to = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59)).toISOString().slice(0, 19);

  console.log('--- Flight lookup:', flight, 'date:', date, '---\n');

  if (FR24_TOKEN) {
    const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${FR24_TOKEN}`, Accept: 'application/json', 'Accept-Version': 'v1' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.log('FR24:', res.status, json?.error || json?.message || '');
      } else {
        const list = json?.data;
        console.log('FR24: found', Array.isArray(list) ? list.length : 0, 'leg(s)');
        if (Array.isArray(list) && list.length > 0) {
          list.forEach((f, i) => {
            console.log('  [' + i + ']', (f.orig_icao || f.origin_icao) + '→' + (f.dest_icao || f.destination_icao),
              '| flight_ended:', f.flight_ended ?? f.flightEnded,
              '| sched_dep:', f.scheduled_departure_utc || f.scheduled_departure,
              '| sched_arr:', f.scheduled_arrival_utc || f.scheduled_arrival,
              '| first_seen:', f.first_seen ?? f.firstSeen,
              '| last_seen:', f.last_seen ?? f.lastSeen,
              '| datetime_landed:', f.datetime_landed ?? f.datetimeLanded);
          });
        }
      }
    } catch (e) {
      console.log('FR24 error:', e.message);
    }
  } else {
    console.log('FR24: no token (EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN)');
  }

  if (AE_KEY) {
    // Live flights (current position)
    for (const fn of [flight, 'PC0437', 'PGT437']) {
      try {
        const url = `https://aviation-edge.com/v2/public/flights?key=${encodeURIComponent(AE_KEY)}&flightIata=${encodeURIComponent(fn)}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => null);
        const list = Array.isArray(data) ? data : (data?.data ?? []);
        if (list.length > 0) {
          console.log('\nAviation Edge (live flights):', list.length, 'result(s)');
          const x = list[0];
          console.log('  route:', (x.departure?.iataCode || x.departure?.icaoCode) + ' →', (x.arrival?.iataCode || x.arrival?.icaoCode));
          console.log('  status:', x.status);
          console.log('  scheduled dep:', x.departure?.scheduledTime || x.departure?.estimatedTime);
          console.log('  scheduled arr:', x.arrival?.scheduledTime || x.arrival?.estimatedTime);
          console.log('  actual dep:', x.departure?.actualTime);
          console.log('  actual arr:', x.arrival?.actualTime);
          if (x.aircraft?.iataCode) console.log('  aircraft:', x.aircraft.iataCode, x.aircraft?.registration || '');
          if (x.geography) console.log('  position: lat', x.geography?.latitude, 'lon', x.geography?.longitude, 'alt(m)', x.geography?.altitude);
          break;
        }
      } catch (e) {}
    }
    // Timetable (by date)
    const hubs = ['IST', 'SAW', 'ADB', 'AYT', 'ESB', 'ECN'];
    for (const airport of hubs) {
      for (const fn of [flight, 'PC0437', 'PGT437']) {
        try {
          const url = `https://aviation-edge.com/v2/public/timetable?key=${encodeURIComponent(AE_KEY)}&iataCode=${airport}&type=departure&flight_iata=${encodeURIComponent(fn)}`;
          const res = await fetch(url);
          const data = await res.json().catch(() => null);
          const list = Array.isArray(data) ? data : (data?.data ?? []);
          const match = list.find((x) => (x.departure?.scheduledTime || '').slice(0, 10) === date);
          if (match) {
            console.log('\nAviation Edge (timetable', date + '):');
            console.log('  origin:', match.departure?.iataCode || match.departure?.icaoCode);
            console.log('  destination:', match.arrival?.iataCode || match.arrival?.icaoCode);
            console.log('  status:', match.status);
            console.log('  scheduled dep:', match.departure?.scheduledTime);
            console.log('  scheduled arr:', match.arrival?.scheduledTime);
            console.log('  actual dep:', match.departure?.actualTime);
            console.log('  actual arr:', match.arrival?.actualTime);
            break;
          }
        } catch (e) {}
      }
    }
  } else {
    console.log('\nAviation Edge: no key (EXPO_PUBLIC_AVIATION_EDGE_API_KEY)');
  }

  console.log('\n--- end ---');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
