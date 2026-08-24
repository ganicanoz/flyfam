#!/usr/bin/env node
/**
 * AeroDataBox — tek pencere: şu andan itibaren 12 saat kalkış (Departure) listesi.
 * Kök JSON’daki tüm üst alanları ve her kalkış satırının bütün yaprak alanlarını (iç içe → nokta yolu)
 * iki sütunlu tabloda listeler.
 *
 * Kullanım:
 *   node scripts/adb-dep-board-now-plus-12h.js [IATA] [IANA_TIMEZONE]
 *
 * Örnek:
 *   node scripts/adb-dep-board-now-plus-12h.js SAW
 *   node scripts/adb-dep-board-now-plus-12h.js VKO Europe/Moscow
 *
 * Pencere uçlarını hangi TZ’de yazacağımız API davranışına bağlı; pratikte meydanın yerel saati.
 * TZ verilmezse: ADB_BOARD_TZ env veya varsayılan Europe/Istanbul.
 *
 * Anahtar: kök `.env` veya `mobile/.env` içinde
 *   AERODATABOX_RAPIDAPI_KEY | EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY | EXPO_PUBLIC_RAPIDAPI_KEY | RAPIDAPI_KEY
 *
 * Uzun hücreler: `ADB_TABLE_MAX_CELL=2000` (varsayılan 600) ile değer sütunu kırpma limiti.
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
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  });
}

loadEnv(path.join(projectRoot, '.env'));
loadEnv(path.join(projectRoot, 'mobile', '.env'));

const KEY =
  process.env.AERODATABOX_RAPIDAPI_KEY ||
  process.env.EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY ||
  process.env.EXPO_PUBLIC_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY;

const BASE = 'https://aerodatabox.p.rapidapi.com';
const COMMON =
  'withLeg=true&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false';

/** Pencere uçlarını IANA TZ’de YYYY-MM-DDTHH:mm string yap (API örnekleriyle uyumlu). */
function toLocalWindowPart(date, timeZone) {
  const s = date.toLocaleString('sv-SE', { timeZone, hour12: false });
  return s.replace(' ', 'T').slice(0, 16);
}

function stringifyTimeField(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const u = v.utc;
    const l = v.local;
    if (typeof u === 'string' && typeof l === 'string' && u !== l) return `${u} | loc:${l}`;
    if (typeof u === 'string') return u;
    if (typeof l === 'string') return l;
    return JSON.stringify(v);
  }
  return String(v);
}

function airportCode(leg) {
  if (!leg || typeof leg !== 'object') return '';
  const ap = leg.airport;
  if (ap && typeof ap === 'object') {
    const i = ap.iata;
    const c = ap.icao;
    if (typeof i === 'string' && i.trim()) return i.trim().toUpperCase();
    if (typeof c === 'string' && c.trim()) return c.trim().toUpperCase();
  }
  return '';
}

function pad(s, w) {
  const t = String(s ?? '');
  return t.length >= w ? t.slice(0, w) : t + ' '.repeat(w - t.length);
}

const MAX_CELL = Number(process.env.ADB_TABLE_MAX_CELL || 600);

/** İç içe objeyi yaprak satırlarına indirger: [ "a.b.c", "değer" ] */
function flattenLeaves(obj, prefix = '') {
  /** @type {Array<[string, string]>} */
  const out = [];
  if (obj === null || obj === undefined) {
    out.push([prefix || '(root)', String(obj)]);
    return out;
  }
  if (typeof obj !== 'object') {
    out.push([prefix || 'value', String(obj)]);
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      out.push([prefix, '[]']);
      return out;
    }
    const allObj = obj.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x));
    if (allObj) {
      obj.forEach((item, i) => {
        const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
        out.push(...flattenLeaves(item, p));
      });
    } else {
      out.push([prefix, JSON.stringify(obj)]);
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenLeaves(v, p));
    } else if (Array.isArray(v)) {
      out.push(...flattenLeaves(v, p));
    } else {
      out.push([p, v === undefined ? '' : String(v)]);
    }
  }
  return out;
}

function clipCell(s) {
  const t = String(s);
  if (t.length <= MAX_CELL) return t;
  return `${t.slice(0, MAX_CELL)} … (+${t.length - MAX_CELL} karakter)`;
}

/** [path, value] satırlarını yazdır */
function printKeyValueTable(title, pairs) {
  console.log('');
  console.log(title);
  console.log('='.repeat(Math.min(100, title.length + 5)));
  if (pairs.length === 0) {
    console.log('(boş)');
    return;
  }
  const kw = Math.min(80, Math.max(24, ...pairs.map(([k]) => k.length)));
  console.log(pad('Alan', kw) + ' | Değer');
  console.log('-'.repeat(kw + 3 + Math.min(120, MAX_CELL)));
  for (const [k, v] of pairs) {
    console.log(pad(k, kw) + ' | ' + clipCell(v));
  }
}

/** Kök yanıt: büyük dizileri özetle, geri kalanı düz */
function rootLevelPairs(json) {
  /** @type {Array<[string, string]>} */
  const rows = [];
  if (!json || typeof json !== 'object') {
    rows.push(['(root)', JSON.stringify(json)]);
    return rows;
  }
  for (const [k, v] of Object.entries(json)) {
    if (Array.isArray(v)) {
      rows.push([k, `array[${v.length}] — her öğe aşağıda (kalkış satırları bölümü)`]);
    } else if (v !== null && typeof v === 'object') {
      rows.push([k, JSON.stringify(v)]);
    } else {
      rows.push([k, String(v)]);
    }
  }
  return rows;
}

async function main() {
  const iata = (process.argv[2] || 'SAW').replace(/\s/g, '').toUpperCase();
  const tz =
    process.argv[3] ||
    process.env.ADB_BOARD_TZ ||
    (['SAW', 'IST', 'AYT', 'ADB', 'ESB', 'BJV', 'DLM', 'GZP'].includes(iata)
      ? 'Europe/Istanbul'
      : iata === 'VKO' || iata === 'SVO' || iata === 'DME'
        ? 'Europe/Moscow'
        : 'UTC');

  if (!KEY) {
    console.error('RapidAPI anahtarı yok (.env / mobile/.env).');
    process.exit(1);
  }

  const start = new Date();
  const end = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  const from = toLocalWindowPart(start, tz);
  const to = toLocalWindowPart(end, tz);

  const url = `${BASE}/flights/airports/iata/${iata}/${from}/${to}?direction=Departure&${COMMON}`;

  console.log('Meydan:', iata, '| TZ:', tz);
  console.log('Pencere (yerel):', from, '→', to, '(~12 saat)');
  console.log('URL:', url);
  console.log('');

  const res = await fetch(url, {
    headers: {
      'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
      'x-rapidapi-key': KEY,
      accept: 'application/json',
    },
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    console.error('HTTP', res.status, '| JSON parse hatası, ilk 600 karakter:');
    console.error(text.slice(0, 600));
    process.exit(1);
  }

  if (!res.ok) {
    console.error('HTTP', res.status);
    console.error(typeof json === 'object' ? JSON.stringify(json, null, 2).slice(0, 2000) : text.slice(0, 800));
    process.exit(1);
  }

  const list = Array.isArray(json?.departures) ? json.departures : [];

  console.log('Toplam kalkış satırı:', list.length);

  printKeyValueTable('Kök API yanıtı (üst seviye alanlar)', rootLevelPairs(json));

  if (list.length === 0) {
    printKeyValueTable('Kök gövde — tam JSON (dizi yoksa debug)', flattenLeaves(json));
    process.exit(0);
  }

  const summary = list.map((x, i) => {
    const dep = x.departure || {};
    const arr = x.arrival || {};
    return {
      idx: i + 1,
      flight: String(x.number ?? '').replace(/\s/g, '') || '—',
      status: String(x.status ?? '—').slice(0, 14),
      depAp: airportCode(dep) || iata,
      arrAp: airportCode(arr) || '—',
      depSched: stringifyTimeField(dep.scheduledTime ?? dep.scheduledTimeUtc ?? dep.scheduledTimeLocal),
      depPred: stringifyTimeField(
        dep.predictedTime ?? dep.estimatedTime ?? dep.expectedTime ?? dep.predictedTimeUtc,
      ),
      arrSched: stringifyTimeField(arr.scheduledTime ?? arr.scheduledTimeUtc ?? arr.scheduledTimeLocal),
      arrPred: stringifyTimeField(
        arr.predictedTime ?? arr.estimatedTime ?? arr.expectedTime ?? arr.predictedTimeUtc,
      ),
    };
  });

  summary.sort((a, b) => String(a.depSched).localeCompare(String(b.depSched)));

  const wN = 6;
  const wF = 10;
  const wS = 14;
  const wAp = 5;
  const wT = 28;
  const header =
    pad('#', wN) +
    pad('Uçuş', wF) +
    pad('Durum', wS) +
    pad('From', wAp) +
    pad('To', wAp) +
    pad('DEP plan', wT) +
    pad('DEP tahm.', wT) +
    pad('ARR plan', wT) +
    pad('ARR tahm.', wT);

  console.log('');
  console.log('Özet tablo (sıralı):');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of summary) {
    console.log(
      pad(String(r.idx), wN) +
        pad(r.flight, wF) +
        pad(r.status, wS) +
        pad(r.depAp, wAp) +
        pad(r.arrAp, wAp) +
        pad(r.depSched, wT) +
        pad(r.depPred, wT) +
        pad(r.arrSched, wT) +
        pad(r.arrPred, wT),
    );
  }

  console.log('');
  console.log('-'.repeat(100));
  console.log('Her kalkış satırı — ADB’nin döndürdüğü TÜM yaprak alanlar (düz liste)');
  console.log('-'.repeat(100));

  const byFlight = [...list.entries()].sort(([, a], [, b]) => {
    const da = a?.departure || {};
    const db = b?.departure || {};
    return stringifyTimeField(da.scheduledTime ?? da.scheduledTimeUtc).localeCompare(
      stringifyTimeField(db.scheduledTime ?? db.scheduledTimeUtc),
    );
  });

  let idx = 0;
  for (const [, row] of byFlight) {
    idx += 1;
    const num = String(row?.number ?? idx).replace(/\s/g, '') || String(idx);
    const pairs = flattenLeaves(row).sort((a, b) => a[0].localeCompare(b[0]));
    printKeyValueTable(`Kalkış satırı ${idx}/${list.length}: ${num}`, pairs);
  }

  console.log('');
  console.log('=== Ham JSON (ilk kayıt, kırpılmamış) ===');
  console.log(JSON.stringify(list[0], null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
