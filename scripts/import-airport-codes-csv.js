/**
 * CSV → Supabase public.airports (tam senk: önce tablo temizlenir, sonra upsert).
 *
 * Desteklenen CSV:
 * 1) Yerel format (docs/airport-codes.csv): ident, …, coordinates ("lat, lon")
 * 2) OurAirports (airports.csv): latitude_deg, longitude_deg; timezone kolonu yok.
 *
 * timezone_iana:
 * - CSV'de "timezone" kolonu varsa ve doluysa kullanılır
 * - Yoksa USE_GEO_TZ≠0 iken koordinatlardan geo-tz (IANA) hesaplanır
 *
 * Usage:
 *   npm install   # kökte geo-tz için
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run airports:import-csv
 *   CSV_PATH=scripts/data/airports-ourairports.csv npm run airports:import-csv
 *
 * Dünya listesi tek komut:
 *   npm run airports:import-world
 *
 * Haftalık otomasyon (tablo silmeden upsert):
 *   npm run airports:sync-weekly
 *   → Makine cron: scripts/cron-airports-sync.sh
 *   → cron-job.org: POST …/functions/v1/sync-airports-ourairports + x-cron-secret
 *
 * Opsiyonel:
 *   USE_GEO_TZ=0 — sadece CSV timezone kolonu; geo-tz kullanma
 *   AIRPORTS_IMPORT_NO_DELETE=1 — tabloyu silmeden sadece upsert (mevcut satırlar kalır)
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, 'utf8').split('\n').forEach((line) => {
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

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const csvPath = process.env.CSV_PATH || path.join(projectRoot, 'docs', 'airport-codes.csv');
const useGeoTz = process.env.USE_GEO_TZ !== '0';
const skipDelete = process.env.AIRPORTS_IMPORT_NO_DELETE === '1';

if (!supabaseUrl || !serviceKey) {
  console.error('Eksik: SUPABASE_URL (veya EXPO_PUBLIC_SUPABASE_URL) ve SUPABASE_SERVICE_ROLE_KEY');
  console.error('  - Proje kökünde veya mobile/ içinde .env dosyası oluşturun.');
  console.error('  - .env.example dosyasını kopyalayıp .env yapın; SUPABASE_SERVICE_ROLE_KEY Supabase Dashboard > Settings > API > service_role secret.');
  console.error('  - Veya komut satırında: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run airports:import-csv');
  process.exit(1);
}

function loadCreateClient() {
  const candidates = [
    path.join(projectRoot, 'node_modules', '@supabase', 'supabase-js'),
    path.join(projectRoot, 'mobile', 'node_modules', '@supabase', 'supabase-js'),
  ];
  for (const modPath of candidates) {
    try {
      return require(modPath).createClient;
    } catch (_) {
      /* try next */
    }
  }
  console.error(
    '@supabase/supabase-js bulunamadı. Proje kökünde: npm install\n' +
      ' veya mobile/ içinde npm install'
  );
  process.exit(1);
}
const createClient = loadCreateClient();
const supabase = createClient(supabaseUrl, serviceKey);

let geoFind = null;
function getGeoFind() {
  if (geoFind) return geoFind;
  try {
    geoFind = require('geo-tz').find;
  } catch (_) {
    console.error(
      'geo-tz bulunamadı. Proje kökünde: npm install\n' +
        ' veya sadece CSV’de timezone kolonu kullanacaksanız: USE_GEO_TZ=0'
    );
    process.exit(1);
  }
  return geoFind;
}

/** Parse one CSV line; quoted fields may contain commas. */
function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let end = i + 1;
      while (end < line.length) {
        const next = line.indexOf('"', end);
        if (next === -1) break;
        if (line[next + 1] === '"') {
          end = next + 2;
          continue;
        }
        end = next;
        break;
      }
      out.push(line.slice(i + 1, end).replace(/""/g, '"'));
      i = end + 1;
      if (line[i] === ',') i++;
      continue;
    }
    const comma = line.indexOf(',', i);
    if (comma === -1) {
      out.push(line.slice(i).trim());
      break;
    }
    out.push(line.slice(i, comma).trim());
    i = comma + 1;
  }
  return out;
}

function parseLatLonString(s) {
  if (!s || s === '\\N') return null;
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function timezoneFromCoords(lat, lon) {
  const find = getGeoFind();
  const zones = find(lat, lon);
  if (!zones || !zones.length) return null;
  return zones[0];
}

async function main() {
  let trNames = {};
  const trNamesPath = path.join(__dirname, 'data', 'airports-tr-names.json');
  if (fs.existsSync(trNamesPath)) {
    trNames = JSON.parse(fs.readFileSync(trNamesPath, 'utf8'));
    console.log('Loaded Turkish names for', Object.keys(trNames).length, 'airports (TR).');
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);
  const identIdx = header.indexOf('ident');
  const typeIdx = header.indexOf('type');
  const nameIdx = header.indexOf('name');
  const isoCountryIdx = header.indexOf('iso_country');
  const municipalityIdx = header.indexOf('municipality');
  const icaoCodeIdx = header.indexOf('icao_code');
  const iataCodeIdx = header.indexOf('iata_code');
  const coordinatesIdx = header.indexOf('coordinates');
  const timezoneIdx = header.indexOf('timezone');
  const latIdx = header.indexOf('latitude_deg');
  const lonIdx = header.indexOf('longitude_deg');

  if (identIdx < 0) {
    console.error('CSV’de "ident" kolonu yok:', csvPath);
    process.exit(1);
  }

  const rows = [];
  let stats = { fromCsvTz: 0, fromGeo: 0, missingTz: 0 };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length <= identIdx) continue;
    const ident = (cols[identIdx] || '').trim().toUpperCase();
    if (!ident || ident === '\\N') continue;
    const icaoCode = icaoCodeIdx >= 0 ? (cols[icaoCodeIdx] || '').trim().toUpperCase() : '';
    const icao = icaoCode || ident;
    const iata =
      iataCodeIdx >= 0 ? (cols[iataCodeIdx] || '').trim().toUpperCase() || null : null;
    const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() || null : null;
    const city = municipalityIdx >= 0 ? (cols[municipalityIdx] || '').trim() || null : null;
    const country_iso =
      isoCountryIdx >= 0 ? (cols[isoCountryIdx] || '').trim().toUpperCase() || null : null;
    const type = typeIdx >= 0 ? (cols[typeIdx] || '').trim() || null : null;
    if (type && type.toLowerCase() === 'closed') continue;

    let lat = null;
    let lon = null;
    if (latIdx >= 0 && lonIdx >= 0 && cols[latIdx] !== undefined && cols[lonIdx] !== undefined) {
      lat = parseFloat(cols[latIdx]);
      lon = parseFloat(cols[lonIdx]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        lat = lon = null;
      }
    }
    const coordinates =
      coordinatesIdx >= 0 ? (cols[coordinatesIdx] || '').trim() || null : null;
    if (lat == null && coordinates) {
      const parsed = parseLatLonString(coordinates);
      if (parsed) {
        lat = parsed.lat;
        lon = parsed.lon;
      }
    }

    let tz =
      timezoneIdx >= 0 ? (cols[timezoneIdx] || '').trim() : '';
    if (tz === '\\N') tz = '';
    let timezone_source = null;
    if (tz) {
      timezone_source = 'csv';
      stats.fromCsvTz++;
    } else if (useGeoTz && lat != null && lon != null) {
      const found = timezoneFromCoords(lat, lon);
      if (found) {
        tz = found;
        timezone_source = 'geo_tz';
        stats.fromGeo++;
      } else {
        stats.missingTz++;
      }
    } else {
      stats.missingTz++;
    }

    const timezone_iana = tz || null;

    const tr = country_iso === 'TR' && trNames[icao] ? trNames[icao] : null;
    const raw_light = {
      type,
      coordinates: coordinates || null,
      latitude_deg: lat != null ? lat : null,
      longitude_deg: lon != null ? lon : null,
      timezone_source,
    };

    rows.push({
      icao,
      iata,
      name,
      city,
      name_tr: tr ? tr.name_tr : null,
      city_tr: tr ? tr.city_tr : null,
      country_iso,
      timezone_iana,
      raw_light,
      fetched_at: new Date().toISOString(),
    });
  }

  const byIcao = new Map();
  for (const r of rows) byIcao.set(r.icao, r);
  const unique = [...byIcao.values()];

  if (skipDelete) {
    console.log('AIRPORTS_IMPORT_NO_DELETE=1 — mevcut airports satırları silinmiyor, sadece upsert.');
  } else {
    console.log('Full sync from CSV: clearing existing airports...');
    const { error: deleteError } = await supabase.from('airports').delete().or('icao.eq.,icao.neq.');
    if (deleteError) {
      console.error('Delete all failed:', deleteError.message);
      process.exit(1);
    }
  }

  console.log('Loaded', unique.length, 'airports from', csvPath);
  console.log(
    'timezone_iana: csv kolonu=',
    stats.fromCsvTz,
    'geo-tz=',
    stats.fromGeo,
    'eksik=',
    stats.missingTz,
    '| USE_GEO_TZ=',
    useGeoTz ? 'on' : 'off'
  );
  console.log('Upserting...');

  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH).map((r) => ({
      ...r,
      name_tr: r.name_tr || null,
      city_tr: r.city_tr || null,
    }));
    const { error } = await supabase.from('airports').upsert(batch, {
      onConflict: 'icao',
      ignoreDuplicates: false,
    });
    if (error) {
      console.error('Upsert error:', error.message);
      process.exit(1);
    }
    done += batch.length;
    if (done % 5000 === 0 || done === unique.length) console.log('  ', done, '/', unique.length);
  }
  console.log('Done.', skipDelete ? 'Upsert tamam.' : 'public.airports kaynak:', csvPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
