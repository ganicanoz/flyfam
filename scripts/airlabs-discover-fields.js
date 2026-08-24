#!/usr/bin/env node
/**
 * AirLabs — uçuş bilgisi: `flight` yanıtı alan | değer | Türkçe anlam tablosu + (isteğe bağlı) ham JSON.
 *
 *   npm run airlabs:discover -- PC437
 *   DEP_IATA=IST LIMIT=20 npm run airlabs:discover -- TK24   (IST için açıkça yaz)
 *
 * Anahtar: AIRLABS_API_KEY veya EXPO_PUBLIC_AIRLABS_API_KEY (.env)
 *
 * Ham API gövdesi: varsayılan AÇIK. schedules / flights ham JSON’da yalnızca ARANAN uçuş satırları (tam liste yok).
 * Kapatmak: RAW=0   Uzunluk: RAW_MAX=80000 (0=sınırsız)
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

const API_BASE = 'https://airlabs.co/api/v9';
const KEY =
  process.env.AIRLABS_API_KEY ||
  process.env.EXPO_PUBLIC_AIRLABS_API_KEY ||
  '';

const flightIata = (process.argv[2] || process.env.FLIGHT_IATA || 'TK1').trim().toUpperCase();
/** Varsayılan kalkış havalimanı: SAW (Sabiha). IST için: DEP_IATA=IST */
const depIata = (process.env.DEP_IATA || 'SAW').trim().toUpperCase();
const limit = Math.min(1000, Math.max(1, parseInt(process.env.LIMIT || '18', 10) || 18));
const RAW = process.env.RAW !== '0';
const RAW_MAX = parseInt(process.env.RAW_MAX || '80000', 10);

function unwrap(json) {
  if (json && typeof json === 'object' && !Array.isArray(json) && 'response' in json) {
    return json.response;
  }
  return json;
}

function redactSecrets(obj) {
  if (obj == null) return obj;
  try {
    const walk = (x) => {
      if (Array.isArray(x)) return x.map(walk);
      if (x && typeof x === 'object') {
        const o = {};
        for (const [k, v] of Object.entries(x)) {
          if (k === 'api_key' || k === 'apiKey') o[k] = '***';
          else o[k] = walk(v);
        }
        return o;
      }
      return x;
    };
    return walk(JSON.parse(JSON.stringify(obj)));
  } catch {
    return obj;
  }
}

const normFlight = (s) => String(s ?? '').trim().toUpperCase().replace(/\s/g, '');

/** schedules[] / flights[] satırı, argv ile verilen kodla aynı uçuş mu? */
function rowMatchesSearchFlight(row, search) {
  const q = normFlight(search);
  if (!row || typeof row !== 'object') return false;
  const iata = normFlight(row.flight_iata);
  const icao = normFlight(row.flight_icao);
  if (iata === q || icao === q) return true;
  const al = normFlight(row.airline_iata);
  const fn = String(row.flight_number ?? '').replace(/\s/g, '');
  if (!al || !fn) return false;
  const candidates = [al + fn, al + fn.padStart(3, '0'), al + fn.padStart(4, '0')];
  return candidates.includes(q);
}

/**
 * Ham yanıtta `response` dizi ise yalnızca aranan uçuş satırları kalır (tam gövde yerine).
 * `flight` endpoint tek obje döner — olduğu gibi bırakılır.
 */
function rawOnlySearchedFlight(raw, search) {
  if (raw == null || typeof raw !== 'object') return raw;
  try {
    const o = JSON.parse(JSON.stringify(raw));
    if (Array.isArray(o)) {
      return o.filter((row) => rowMatchesSearchFlight(row, search));
    }
    if (Array.isArray(o.response)) {
      o.response = o.response.filter((row) => rowMatchesSearchFlight(row, search));
      return o;
    }
    return o;
  } catch {
    return raw;
  }
}

function printRawBlock(title, payload) {
  if (!RAW) return;
  if (payload === undefined) return;
  console.log('\n  --- HAM VERİ: ' + title + ' ---');
  let str = JSON.stringify(redactSecrets(payload), null, 2);
  if (RAW_MAX > 0 && str.length > RAW_MAX) {
    str = str.slice(0, RAW_MAX) + '\n  … [RAW_MAX=' + RAW_MAX + ' ile kesildi; RAW_MAX=0 tam metin]';
  }
  console.log(str.split('\n').map((ln) => '  ' + ln).join('\n'));
  console.log('  --- /HAM VERİ: ' + title + ' ---\n');
}

/** Filtrelenmiş dizi boşsa ham blok yazma (gereksiz gövde). */
function printRawBlockFiltered(title, raw, search) {
  if (!RAW) return;
  const filtered = rawOnlySearchedFlight(raw, search);
  const resp = filtered && typeof filtered === 'object' ? filtered.response : null;
  if (Array.isArray(resp) && resp.length === 0) {
    console.log('\n  --- HAM VERİ: ' + title + ' ---');
    console.log('  (Bu endpoint’te aranan uçuş yok — ham JSON yazılmadı.)');
    console.log('  --- /HAM VERİ ---\n');
    return;
  }
  printRawBlock(title, filtered);
}

async function get(method, params) {
  const u = new URL(`${API_BASE}/${method}`);
  u.searchParams.set('api_key', KEY);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), { method: 'GET' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      err: text.slice(0, 200),
      raw: { _parseError: true, status: res.status, bodyPreview: text.slice(0, 500) },
    };
  }
  if (json && json.error) {
    return { ok: false, status: res.status, data: null, err: json.error, raw: json };
  }
  return { ok: res.ok, status: res.status, data: unwrap(json), raw: json };
}

function dash(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/** Sabit genişlik, UTF-8 için kabaca kısalt */
function cell(s, w) {
  const t = dash(s);
  if (t.length <= w) return t.padEnd(w);
  return t.slice(0, w - 1) + '…';
}

function line(ch, w) {
  return ch.repeat(w);
}

function bannerStart(label) {
  const w = 88;
  console.log('\n' + '╔' + line('═', w) + '╗');
  console.log('║ ' + cell('BAŞLANGIÇ: ' + label, w - 2).padEnd(w - 2) + ' ║');
  console.log('╚' + line('═', w) + '╝');
}

function bannerEnd(label) {
  const w = 88;
  console.log('┌' + line('─', w) + '┐');
  console.log('│ ' + cell('BİTİŞ: ' + label, w - 2).padEnd(w - 2) + ' │');
  console.log('└' + line('─', w) + '┘\n');
}

/** AirLabs `flight` / benzeri uçuş objesi alanları — Türkçe kısa anlam */
const AIRLABS_FIELD_MEANING_TR = {
  hex: 'ADS-B ICAO24 adresi (uçağın kimliği)',
  reg_number: 'Kuyruk tescili (registration)',
  aircraft_icao: 'Uçak tipi ICAO kodu (örn. B738)',
  airline_iata: 'İşleten havayolu IATA kodu',
  airline_icao: 'İşleten havayolu ICAO kodu',
  airline_name: 'Havayolu ticari adı',
  flight_iata: 'Uçuş IATA kodu (kod + numara, örn. PC130)',
  flight_icao: 'Uçuş ICAO kodu (örn. PGT130)',
  flight_number: 'Uçuş numarası (yalnız rakam kısmı)',
  cs_airline_iata: 'Kod paylaşımlı uçuşta diğer havayolu IATA',
  cs_flight_number: 'Kod paylaşımlı uçuş numarası',
  cs_flight_iata: 'Kod paylaşımlı uçuş IATA kodu',
  dep_iata: 'Kalkış havalimanı IATA',
  dep_icao: 'Kalkış havalimanı ICAO',
  dep_terminal: 'Kalkış terminali (tahmini)',
  dep_gate: 'Kalkış kapısı (tahmini)',
  dep_time: 'Planlı kalkış — havalimanı yerel saat',
  dep_estimated: 'Güncel tahmini kalkış — yerel',
  dep_actual: 'Gerçekleşen kalkış — yerel',
  dep_time_utc: 'Planlı kalkış — UTC',
  dep_estimated_utc: 'Tahmini kalkış — UTC',
  dep_actual_utc: 'Gerçek kalkış — UTC',
  dep_time_ts: 'Planlı kalkış Unix zaman damgası (sn)',
  dep_estimated_ts: 'Tahmini kalkış Unix zaman damgası (sn)',
  dep_actual_ts: 'Gerçek kalkış Unix zaman damgası (sn)',
  dep_name: 'Kalkış havalimanı tam adı',
  dep_city: 'Kalkış şehri',
  dep_country: 'Kalkış ülkesi (ISO-2)',
  arr_iata: 'Varış havalimanı IATA',
  arr_icao: 'Varış havalimanı ICAO',
  arr_terminal: 'Varış terminali (tahmini)',
  arr_gate: 'Varış kapısı (tahmini)',
  arr_baggage: 'Bagaj bandı / karusel',
  arr_time: 'Planlı varış — havalimanı yerel saat',
  arr_estimated: 'Güncel tahmini varış — yerel',
  arr_actual: 'Gerçekleşen varış — yerel',
  arr_time_utc: 'Planlı varış — UTC',
  arr_estimated_utc: 'Tahmini varış — UTC',
  arr_actual_utc: 'Gerçek varış — UTC',
  arr_time_ts: 'Planlı varış Unix zaman damgası (sn)',
  arr_estimated_ts: 'Tahmini varış Unix zaman damgası (sn)',
  arr_actual_ts: 'Gerçek varış Unix zaman damgası (sn)',
  arr_name: 'Varış havalimanı tam adı',
  arr_city: 'Varış şehri',
  arr_country: 'Varış ülkesi (ISO-2)',
  status: 'Uçuş durumu (örn. scheduled, active, landed, en-route, cancelled)',
  duration: 'Blok uçuş süresi (dakika, plana göre)',
  delayed: 'Eski alan: toplam gecikme tahmini (dk) — dokümanda deprecated',
  dep_delayed: 'Kalkış gecikmesi (dakika)',
  arr_delayed: 'Varış gecikmesi (dakika)',
  updated: 'Kaydın son güncellenme zamanı (Unix sn)',
  flag: 'Ülke bayrağı / kayıt ülkesi ISO-2 (veri kapsamına göre)',
  percent: 'Rota üzerinde yaklaşık tamamlanma yüzdesi',
  utc: 'Örnek / referans anı (UTC metin, AirLabs)',
  eta: 'Kalan süre veya varışa kalan (çoğunlukla dakika; AirLabs özel alan)',
  lat: 'Enlem (canlı konum)',
  lng: 'Boylam (canlı konum)',
  alt: 'İrtifa (m, canlı)',
  dir: 'Burun yönü (derece)',
  speed: 'Yatay hız (km/s veya dokümana göre birim)',
  v_speed: 'Dikey hız',
  squawk: 'Transponder squawk kodu',
  model: 'Uçak model adı (tam metin)',
  manufacturer: 'Üretici',
  msn: 'Üretici seri numarası (MSN)',
  type: 'Uçak sınıfı (landplane, helicopter, …)',
  engine: 'Motor tipi (jet, piston, …)',
  engine_count: 'Motor sayısı',
  built: 'Üretim yılı',
  age: 'Uçak yaşı (yıl)',
};

function valueCell(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 28 ? s.slice(0, 27) + '…' : s;
  }
  const s = String(v);
  return s.length > 28 ? s.slice(0, 27) + '…' : s;
}

/** Ham uçuş objesini: alan | API değeri | Türkçe anlam */
function printFlightFieldsGlossary(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    console.log('  (Tablo için tek uçuş objesi yok)');
    return;
  }
  const kw = 22;
  const vw = 28;
  const mw = 34;
  console.log('  ■ Alan (API) │ Değer │ Anlam');
  let header = '  │';
  let bar = '  ├';
  for (const [h, w] of [
    ['Alan', kw],
    ['Değer', vw],
    ['Anlam', mw],
  ]) {
    header += ' ' + cell(h, w) + ' │';
    bar += '─'.repeat(w + 2) + '┼';
  }
  console.log(header);
  console.log(bar.slice(0, -1) + '┤');
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    const mean = AIRLABS_FIELD_MEANING_TR[k] || '(AirLabs alanı — dokümantasyonda ara)';
    const lineOut =
      '  │ ' +
      cell(k, kw) +
      ' │ ' +
      cell(valueCell(obj[k]), vw) +
      ' │ ' +
      cell(mean, mw) +
      ' │';
    console.log(lineOut);
  }
  console.log('  ' + line('─', kw + vw + mw + 8));
}

/** Tabloda sığsın diye saat kısmı (YYYY-MM-DD HH:mm → HH:mm) */
function timeOnly(s) {
  if (s === null || s === undefined || s === '') return '—';
  const m = String(s).match(/\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2})/);
  if (m) return m[1];
  const m2 = String(s).match(/(\d{2}:\d{2})/);
  return m2 ? m2[1] : String(s).slice(0, 8);
}

/** plan → tahmini → gerçek (saat) */
function triplet(plan, est, act) {
  const p = timeOnly(plan);
  const e = timeOnly(est);
  const a = timeOnly(act);
  return `${p}→${e}→${a}`;
}

function printScheduleTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('  (Kayıt yok)');
    return;
  }
  // Tek satırda sığsın: ~86 sütun
  const cols = [
    { h: 'Uçuş', w: 9, f: (r) => dash(r.flight_iata) },
    { h: 'Rota', w: 7, f: (r) => `${dash(r.dep_iata)}→${dash(r.arr_iata)}` },
    {
      h: 'Kalkış (plan→tahm→gerç)',
      w: 26,
      f: (r) => triplet(r.dep_time, r.dep_estimated, r.dep_actual),
    },
    {
      h: 'İniş (plan→tahm→gerç)',
      w: 26,
      f: (r) => triplet(r.arr_time, r.arr_estimated, r.arr_actual),
    },
    { h: 'Durum', w: 11, f: (r) => dash(r.status) },
  ];
  let header = '  │';
  let bar = '  ├';
  for (const c of cols) {
    header += ' ' + cell(c.h, c.w) + ' │';
    bar += '─'.repeat(c.w + 2) + '┼';
  }
  console.log(header);
  console.log(bar.slice(0, -1) + '┤');
  for (const r of rows) {
    let lineOut = '  │';
    for (const c of cols) {
      lineOut += ' ' + cell(c.f(r), c.w) + ' │';
    }
    console.log(lineOut);
  }
  console.log('  ' + line('─', 84));
  console.log('  Toplam: ' + rows.length + ' uçuş');
}

function printLiveFlightsTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('  (Şu an bu filtreye uyan canlı uçuş yok — normal.)');
    return;
  }
  const cols = [
    { h: 'Uçuş', w: 10, f: (r) => dash(r.flight_iata) },
    { h: 'Rota', w: 10, f: (r) => `${dash(r.dep_iata)}→${dash(r.arr_iata)}` },
    { h: 'Durum', w: 10, f: (r) => dash(r.status) },
    { h: 'Alt m', w: 7, f: (r) => dash(r.alt) },
    { h: 'Hız', w: 6, f: (r) => dash(r.speed) },
    { h: 'Reg', w: 10, f: (r) => dash(r.reg_number) },
  ];
  let header = '  │';
  let bar = '  ├';
  for (const c of cols) {
    header += ' ' + cell(c.h, c.w) + ' │';
    bar += '─'.repeat(c.w + 2) + '┼';
  }
  console.log(header);
  console.log(bar.slice(0, -1) + '┤');
  for (const r of rows.slice(0, 25)) {
    let lineOut = '  │';
    for (const c of cols) {
      lineOut += ' ' + cell(c.f(r), c.w) + ' │';
    }
    console.log(lineOut);
  }
  if (rows.length > 25) console.log('  … ve +' + (rows.length - 25) + ' uçuş');
}

async function main() {
  if (!KEY) {
    console.error('AIRLABS_API_KEY tanımlı değil (.env).');
    process.exit(1);
  }

  console.log(line('═', 90));
  console.log('  AirLabs uçuş özeti  │  flight_iata=' + flightIata + '  │  schedules dep_iata=' + depIata + '  │  limit=' + limit);
  console.log(line('═', 90));

  // 1) Tek uçuş detayı
  bannerStart('Tek uçuş bilgisi (endpoint: flight)');
  const f = await get('flight', { flight_iata: flightIata });
  if (!f.ok || f.data == null) {
    console.log('  Hata:', f.err ? JSON.stringify(f.err) : f.status);
  } else if (Array.isArray(f.data)) {
    console.log('  Beklenmeyen dizi yanıtı — ilk eleman tabloda:');
    printFlightFieldsGlossary(f.data[0]);
  } else {
    printFlightFieldsGlossary(f.data);
  }
  printRawBlock('flight — aranan: ' + flightIata + ' (tam API gövdesi)', f.raw);
  bannerEnd('Tek uçuş bilgisi');

  // 2) Havalimanı kalkış tarifesi (yakın saatler)
  bannerStart('Kalkış tarifesi — ' + depIata + ' (endpoint: schedules)');
  const s = await get('schedules', { dep_iata: depIata, limit });
  if (!s.ok || s.data == null) {
    console.log('  Hata:', s.err ? JSON.stringify(s.err) : s.status);
  } else if (!Array.isArray(s.data)) {
    console.log('  Beklenmeyen yanıt tipi');
  } else {
    printScheduleTable(s.data);
  }
  printRawBlockFiltered(
    'schedules — yalnızca ' + flightIata,
    s.raw,
    flightIata
  );
  bannerEnd('Kalkış tarifesi');

  // 3) Canlı filtre (aynı flight_iata)
  bannerStart('Canlı uçuşlar — flight_iata=' + flightIata + ' (endpoint: flights)');
  const live = await get('flights', { flight_iata: flightIata });
  if (!live.ok || live.data == null) {
    console.log('  Hata:', live.err ? JSON.stringify(live.err) : live.status);
  } else if (!Array.isArray(live.data)) {
    console.log('  Beklenmeyen yanıt (tek obje olabilir):');
    printLiveFlightsTable(Array.isArray(live.data) ? live.data : [live.data]);
  } else {
    printLiveFlightsTable(live.data);
  }
  printRawBlockFiltered('flights — yalnızca ' + flightIata, live.raw, flightIata);
  bannerEnd('Canlı uçuşlar');

  console.log(line('═', 90));
  console.log('  İpucu: DEP_IATA=IST tarife; SAW varsayılan. Ham JSON: schedules/flights içinde sadece ' + flightIata + ' satırları. RAW=0 kapat.');
  console.log(line('═', 90));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
