#!/usr/bin/env node
/**
 * Aviation Edge flight_track_history API'ye göre karar mekanizması:
 * https://aviation-edge.com/v2/public/flight_track_history
 *
 * Zorunluluklar (API validation):
 * 1. depIata parametresi zorunlu.
 * 2. En az biri zorunlu: flightIata | aircraftIcao24 | regNum
 * 3. En az biri zorunlu: depDate | arrDate | dep_schTime | arr_schTime
 *
 * Kullanım: node scripts/fetch-track-pc2532.mjs
 * .env'de EXPO_PUBLIC_AVIATION_EDGE_API_KEY tanımlı olmalı.
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
    const m = line.match(/^\s*EXPO_PUBLIC_AVIATION_EDGE_API_KEY\s*=\s*(.+)/);
    if (m) {
      const val = m[1].replace(/^["']|["']$/g, '').trim();
      if (val && val !== 'your-aviation-edge-key') process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY = val;
      break;
    }
  }
}

const key = process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY;
if (!key || key === 'your-aviation-edge-key') {
  console.error('Hata: .env içinde EXPO_PUBLIC_AVIATION_EDGE_API_KEY tanımlı değil veya placeholder.');
  process.exit(1);
}

const BASE_URL = 'https://aviation-edge.com/v2/public/flight_track_history';

/**
 * API parametrelerini validation kurallarına göre oluşturur.
 * @returns {URLSearchParams} Geçerli params veya null (eksik zorunlu alan varsa)
 */
function buildParams(options) {
  const {
    depIata,
    flightIata = null,
    aircraftIcao24 = null,
    regNum = null,
    depDate = null,
    arrDate = null,
    dep_schTime = null,
    arr_schTime = null,
  } = options;

  // Kural 1: depIata zorunlu
  if (!depIata || typeof depIata !== 'string' || !depIata.trim()) {
    return null;
  }

  // Kural 2: En az biri gerekli: flightIata | aircraftIcao24 | regNum
  const hasIdentifier = [flightIata, aircraftIcao24, regNum].some(
    (v) => v != null && String(v).trim() !== ''
  );
  if (!hasIdentifier) {
    return null;
  }

  // Kural 3: En az biri gerekli: depDate | arrDate | dep_schTime | arr_schTime
  const hasTime = [depDate, arrDate, dep_schTime, arr_schTime].some(
    (v) => v != null && String(v).trim() !== ''
  );
  if (!hasTime) {
    return null;
  }

  const params = new URLSearchParams({ key, depIata: depIata.trim().toUpperCase() });

  if (flightIata?.trim()) params.set('flightIata', flightIata.trim().toUpperCase());
  if (aircraftIcao24?.trim()) params.set('aircraftIcao24', aircraftIcao24.trim().toUpperCase());
  if (regNum?.trim()) params.set('regNum', regNum.trim());

  if (depDate?.trim()) params.set('depDate', depDate.trim().slice(0, 10));
  if (arrDate?.trim()) params.set('arrDate', arrDate.trim().slice(0, 10));
  if (dep_schTime?.trim()) params.set('dep_schTime', dep_schTime.trim());
  if (arr_schTime?.trim()) params.set('arr_schTime', arr_schTime.trim());

  return params;
}

/**
 * Tek bir istek atar; başarılı ve dolu liste dönerse track listesini, yoksa null.
 */
async function fetchTrackHistory(params) {
  const url = `${BASE_URL}?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return { ok: false, status: res.status, data };
  }
  if (data?.success === false || data?.code === 404) {
    return { ok: true, data: [], raw: data };
  }

  const list = Array.isArray(data) ? data : data?.data ?? data?.response ?? [];
  return { ok: true, data: list, raw: data };
}

// —— Script: PC2532, 2 Mart ———
const flightIata = 'PC2532';
const depDate = '2025-03-02';
const depIataCandidates = ['SAW', 'IST', 'ADB', 'AYT', 'ESB'];

for (const depIata of depIataCandidates) {
  const params = buildParams({ depIata, flightIata, depDate });
  if (!params) {
    console.log('depIata=%s atlandı: parametre kuralları sağlanmadı.', depIata);
    continue;
  }

  const result = await fetchTrackHistory(params);
  console.log('depIata=%s status=%s', depIata, result.ok ? '200' : result.status);

  if (!result.ok) {
    if (result.data?.error) console.log('  error:', result.data.error);
    continue;
  }

  if (result.data.length > 0) {
    console.log('Toplam', result.data.length, 'nokta bulundu.');
    console.log(JSON.stringify(result.data, null, 2));
    process.exit(0);
  }
}

console.log('Hiçbir depIata için track history dönmedi.');
process.exit(0);
