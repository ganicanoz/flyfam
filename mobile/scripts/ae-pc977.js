/**
 * PC977 — Aviation Edge timetable API ne döndürüyor? (sadece bakıyoruz, değişiklik yok)
 * Run: node scripts/ae-pc977.js
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

const key = process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY;
if (!key) {
  console.log('EXPO_PUBLIC_AVIATION_EDGE_API_KEY yok.');
  process.exit(1);
}

const hubs = ['IST', 'SAW', 'ADB', 'AYT', 'ESB', 'ECN'];
const variants = ['PC977', 'PC0977', 'PGT977', 'PGT0977'];

async function run() {
  console.log('PC977 — Aviation Edge timetable (şu an)\n');
  for (const airport of hubs) {
    for (const flightNum of variants) {
      for (const type of ['departure', 'arrival']) {
        const url = `https://aviation-edge.com/v2/public/timetable?key=${encodeURIComponent(key)}&iataCode=${airport}&type=${type}&flight_iata=${flightNum}`;
        try {
          const res = await fetch(url);
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            console.log(airport, type, flightNum, '→ HTTP', res.status, data?.error || '');
            continue;
          }
          const list = Array.isArray(data) ? data : data?.data ?? [];
          if (list.length === 0) continue;
          console.log('---', airport, type, flightNum, '→', list.length, 'kayıt ---');
          list.slice(0, 5).forEach((f, i) => {
            const dep = f.departure || {};
            const arr = f.arrival || {};
            console.log('  Kayıt', i + 1, '| status:', f.status);
            console.log('    departure:', dep.iataCode || dep.icaoCode, 'scheduled:', dep.scheduledTime, 'actual:', dep.actualTime, 'estimated:', dep.estimatedTime);
            console.log('    arrival:  ', arr.iataCode || arr.icaoCode, 'scheduled:', arr.scheduledTime, 'actual:', arr.actualTime, 'estimated:', arr.estimatedTime);
          });
          if (list.length > 5) console.log('  ... ve', list.length - 5, 'kayıt daha');
          console.log('');
        } catch (e) {
          console.log(airport, type, flightNum, 'Error:', e.message);
        }
      }
    }
  }
  console.log('Bitti.');
}

run();
