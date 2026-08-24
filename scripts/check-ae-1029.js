#!/usr/bin/env node
/**
 * AE'den PC1029 (veya 1029) için gelen ham yanıtı gösterir.
 * Anahtar: .env veya mobile/.env içinde AVIATION_EDGE_API_KEY / EXPO_PUBLIC_AVIATION_EDGE_API_KEY
 * Kullanım: node scripts/check-ae-1029.js [YYYY-MM-DD]
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\"/g, '"');
      }
      env[m[1]] = val;
    }
    return env;
  } catch (_) {
    return {};
  }
}

const rootEnv = loadEnvFile(path.join(__dirname, '..', '.env'));
const mobileEnv = loadEnvFile(path.join(__dirname, '..', 'mobile', '.env'));
const env = { ...process.env, ...rootEnv, ...mobileEnv };

const KEY = env.AVIATION_EDGE_API_KEY || env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY || '';
if (!KEY || KEY === 'your-aviation-edge-key') {
  console.error('AVIATION_EDGE_API_KEY veya EXPO_PUBLIC_AVIATION_EDGE_API_KEY .env veya mobile/.env içinde tanımlı olmalı.');
  process.exit(1);
}

const HUBS = ['IST', 'SAW', 'ADB', 'AYT', 'ESB', 'ECN'];
const FLIGHT_VARIANTS = ['PC1029', 'PGT1029'];
const TYPES = ['departure', 'arrival'];

async function fetchUrl(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const dateArg = process.argv[2];
  const today = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : new Date().toISOString().slice(0, 10);
  console.log('Tarih (eşleşme için):', today);
  console.log('---\n');

  for (const airport of HUBS) {
    for (const flightIata of FLIGHT_VARIANTS) {
      for (const type of TYPES) {
        const url = `https://aviation-edge.com/v2/public/timetable?key=${KEY}&iataCode=${airport}&type=${type}&flight_iata=${flightIata}`;
        const { ok, status, data } = await fetchUrl(url);

        if (!ok || !Array.isArray(data)) {
          if (data && !Array.isArray(data)) console.log(airport, type, flightIata, '->', JSON.stringify(data).slice(0, 200));
          continue;
        }

        const forDate = data.find((x) => {
          const t = x?.departure?.scheduledTime ?? x?.departure?.actualTime ?? x?.departure?.estimatedTime ?? '';
          return String(t).slice(0, 10) === today;
        });

        const row = forDate || data[0];
        if (!row) continue;

        const dep = row.departure ?? {};
        const arr = row.arrival ?? {};
        console.log(`--- ${airport} / ${type} / ${flightIata} (${data.length} kayıt, eşleşen: ${forDate ? 'evet' : 'ilk kayıt'}) ---`);
        console.log('departure:', JSON.stringify({ scheduledTime: dep.scheduledTime, actualTime: dep.actualTime, estimatedTime: dep.estimatedTime }, null, 2));
        console.log('arrival:  ', JSON.stringify({ scheduledTime: arr.scheduledTime, actualTime: arr.actualTime, estimatedTime: arr.estimatedTime }, null, 2));
        console.log('f.status: ', row.status ?? null);
        console.log('');
      }
    }
  }

  console.log('Bitti. Yukarıda actualTime/estimatedTime dolu olan arrival = gerçek varış; sadece scheduledTime = planlanan (biz "indi" saymıyoruz).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
