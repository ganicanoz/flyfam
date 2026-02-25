/**
 * One-off lookup: PC130 for tomorrow. Prints raw API response so we can fix time handling.
 * Run from mobile/: node scripts/lookup-pc130.js
 */

const fs = require('fs');
const path = require('path');

// Load .env (simple parse)
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

const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
})();

const token = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
const aviationKey = process.env.EXPO_PUBLIC_AVIATION_STACK_API_KEY;
const rapidKey = process.env.EXPO_PUBLIC_RAPIDAPI_KEY;

console.log('=== Lookup PC130 ===');
console.log('Tomorrow (YYYY-MM-DD):', tomorrow);
// Also try a date when FR24 had data (from first run)
const sampleDate = '2026-02-18';
console.log('Sample date (FR24 had data):', sampleDate);
console.log('');

async function run() {
  // --- Flightradar24 ---
  if (token) {
    const [y, m, d] = tomorrow.split('-').map(Number);
    const fromDate = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0));
    const toDate = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59));
    const from = fromDate.toISOString().slice(0, 19).replace('T', ' ');
    const to = toDate.toISOString().slice(0, 19).replace('T', ' ');
    const flightsParam = 'PC130,PC0130,PGT130,PGT0130';
    const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
    console.log('--- Flightradar24 (tomorrow', tomorrow, ') ---');
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Accept-Version': 'v1',
        },
      });
      const json = await res.json().catch(() => null);
      console.log('Status:', res.status);
      if (json?.data?.length) {
        const onDay = json.data.filter((x) => {
          const t = x.datetime_takeoff ?? x.first_seen;
          return t && String(t).slice(0, 10) === tomorrow;
        });
        console.log('Flights on', tomorrow, ':', onDay.length);
        onDay.forEach((f, i) => {
          console.log('\nFlight', i + 1, '— all datetime / time fields:');
          Object.keys(f).filter((k) => /time|date|depart|arrival|seen|land|takeoff|scheduled/i.test(k)).forEach((k) => {
            console.log('  ', k, ':', JSON.stringify(f[k]));
          });
          console.log('  origin_icao:', f.origin_icao, '| destination_icao:', f.destination_icao);
        });
        if (onDay.length === 0 && json.data.length) {
          console.log('Sample flight (other day) — datetime fields:');
          const f = json.data[0];
          Object.keys(f).filter((k) => /time|date|depart|arrival|seen|land|takeoff|scheduled/i.test(k)).forEach((k) => {
            console.log('  ', k, ':', JSON.stringify(f[k]));
          });
        }
      } else {
        console.log('Response:', JSON.stringify(json, null, 2).slice(0, 2000));
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
    console.log('');

    // FR24 again for sample date 2026-02-18 (day we had data)
    const from2 = new Date(Date.UTC(2026, 1, 16, 0, 0, 0)).toISOString().slice(0, 19).replace('T', ' ');
    const to2 = new Date(Date.UTC(2026, 1, 20, 23, 59, 59)).toISOString().slice(0, 19).replace('T', ' ');
    const url2 = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from2)}&flight_datetime_to=${encodeURIComponent(to2)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
    console.log('--- Flightradar24 (sample date', sampleDate, ') ---');
    try {
      const res2 = await fetch(url2, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Accept-Version': 'v1',
        },
      });
      const json2 = await res2.json().catch(() => null);
      const onSampleDay = (json2?.data || []).filter((x) => {
        const t = x.datetime_takeoff ?? x.first_seen;
        return t && String(t).slice(0, 10) === sampleDate;
      });
      console.log('Flights on', sampleDate, ':', onSampleDay.length);
      if (onSampleDay.length) {
        const f = onSampleDay[0];
        console.log('Full flight object (datetime fields):');
        Object.keys(f).sort().forEach((k) => {
          if (/time|date|depart|arrival|seen|land|takeoff|scheduled|origin|dest|first|last/i.test(k))
            console.log('  ', k, ':', JSON.stringify(f[k]));
        });
        console.log('\n→ What app would store:');
        const dep = f.scheduled_departure ?? f.scheduled_departure_utc ?? f.datetime_takeoff ?? f.first_seen;
        const arr = f.scheduled_arrival ?? f.scheduled_arrival_utc ?? f.datetime_landed ?? f.last_seen;
        console.log('  scheduled_departure_utc:', dep);
        console.log('  scheduled_arrival_utc:', arr);
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
    console.log('');
  } else {
    console.log('--- Flightradar24: no token ---\n');
  }

  // --- Aviation Stack ---
  if (aviationKey) {
    console.log('--- Aviation Stack ---');
    try {
      const url = `https://api.aviationstack.com/v1/flights?access_key=${aviationKey}&flight_iata=PC130&flight_date=${tomorrow}&limit=5`;
      const res = await fetch(url);
      const data = await res.json();
      console.log('Status:', res.status);
      if (data.data?.length) {
        data.data.forEach((f, i) => {
          console.log('\nFlight', i + 1);
          console.log('  departure:', JSON.stringify(f.departure));
          console.log('  arrival:', JSON.stringify(f.arrival));
        });
      } else {
        console.log('Response:', JSON.stringify(data, null, 2).slice(0, 1500));
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
    console.log('');
  } else {
    console.log('--- Aviation Stack: no key ---\n');
  }

  // --- AeroDataBox ---
  if (rapidKey) {
    console.log('--- AeroDataBox (RapidAPI) ---');
    try {
      const url = `https://aerodatabox.p.rapidapi.com/flights/number/PC130/${tomorrow}`;
      const res = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': rapidKey,
          'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
        },
      });
      const data = await res.json().catch(() => null);
      console.log('Status:', res.status);
      const list = Array.isArray(data) ? data : data?.departure ?? data?.flights ?? (data ? [data] : []);
      if (list.length) {
        list.slice(0, 3).forEach((f, i) => {
          console.log('\nFlight', i + 1);
          console.log('  departure keys:', Object.keys(f.departure || {}));
          console.log('  arrival keys:', Object.keys(f.arrival || {}));
          const dep = f.departure || f.departureAirport || {};
          const arr = f.arrival || f.arrivalAirport || {};
          ['scheduledTime', 'scheduledTimeLocal', 'scheduled', 'time'].forEach((k) => {
            if (dep[k] !== undefined) console.log('  dep.' + k, dep[k]);
            if (arr[k] !== undefined) console.log('  arr.' + k, arr[k]);
          });
        });
      } else {
        console.log('Response:', JSON.stringify(data, null, 2).slice(0, 1500));
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
  } else {
    console.log('--- AeroDataBox: no key ---');
  }
}

run();
