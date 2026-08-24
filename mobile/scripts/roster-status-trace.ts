/**
 * Roster kartında görünen flight_status ile aynı guard mantığı (Roster.tsx getFlightStatus).
 *
 * Çalışma dizini: tek sefer `cd .../FLYFAM/mobile` (iç içe `cd mobile` yapma).
 *
 *   npm run roster:status -- --flight PC130 --date 2026-03-26
 *
 * .env: önce `mobile/.env`, sonra repo kökü `../.env` yüklenir (kökteki
 * SUPABASE_SERVICE_ROLE_KEY böylece mobile'dan çalıştırınca da okunur).
 *
 * Tarih verilmezse: bu numara için en güncel 5 satır (updated_at desc).
 */
import dotenv from 'dotenv';
import path from 'path';

function loadEnvForScripts(): string[] {
  const loaded: string[] = [];
  const tryLoad = (p: string) => {
    const abs = path.resolve(p);
    const r = dotenv.config({ path: abs });
    if (!r.error) loaded.push(abs);
  };
  // Önce mobile (Expo public), sonra kök — dotenv varsayılanı: process.env'te
  // zaten olan anahtarı ezmez; kök sadece eksikleri (özellikle service role) doldurur.
  tryLoad(path.join(process.cwd(), '.env.local'));
  tryLoad(path.join(process.cwd(), '.env'));
  tryLoad(path.join(process.cwd(), '..', '.env.local'));
  tryLoad(path.join(process.cwd(), '..', '.env'));
  // Boş SUPABASE_SERVICE_ROLE_KEY= satırı kök .env'deki gerçek anahtarın yüklenmesini
  // engelleyebilir; temizleyip kökü bir kez daha dene.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    tryLoad(path.join(process.cwd(), '..', '.env.local'));
    tryLoad(path.join(process.cwd(), '..', '.env'));
  }
  return loaded;
}

const _envLoadedFrom = loadEnvForScripts();

const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

const SUPABASE_URL =
  (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
const AUTH_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  '';

type FlightStatus =
  | 'scheduled'
  | 'taxi_out'
  | 'departed'
  | 'en_route'
  | 'landed'
  | 'parked'
  | 'cancelled'
  | 'diverted'
  | 'incident'
  | 'redirected';

type DbRow = {
  id?: string;
  flight_number?: string | null;
  flight_date?: string | null;
  flight_status?: string | null;
  actual_arrival?: string | null;
  fr24_datetime_landed_utc?: string | null;
  scheduled_departure?: string | null;
  api_refresh_phase?: string | null;
  updated_at?: string | null;
};

function flightNumberVariants(flightNumber: string): string[] {
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw) return [];
  const variants = [raw];
  const m = raw.match(/^([A-Z]{2})(\d+)$/);
  if (!m) return [...new Set(variants)];
  const code = m[1];
  const num = m[2];
  if (num.length === 3) variants.push(`${code}0${num}`);
  if (num.length === 4 && num.startsWith('0')) variants.push(`${code}${num.slice(1)}`);
  const icao = IATA_TO_ICAO[code];
  if (icao) {
    variants.push(`${icao}${num}`);
    if (num.length === 3) variants.push(`${icao}0${num}`);
  }
  return [...new Set(variants)];
}

function getLocalDateStringPlusDays(delta: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseUtcMsStatic(s: string | null | undefined): number {
  if (!s || typeof s !== 'string') return 0;
  const t = new Date(s.trim()).getTime();
  return Number.isFinite(t) ? t : 0;
}

function parseArgs(): { flight: string; date?: string } {
  const argv = process.argv.slice(2);
  let flight = '';
  let date: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--flight' && argv[i + 1]) {
      flight = argv[++i];
      continue;
    }
    if (a === '--date' && argv[i + 1]) {
      date = argv[++i];
      continue;
    }
    if (a.startsWith('--flight=')) flight = a.slice('--flight='.length);
    if (a.startsWith('--date=')) date = a.slice('--date='.length);
  }
  return { flight: flight.replace(/\s/g, '').trim(), date: date?.trim() };
}

/** Roster.tsx getFlightStatus ile aynı sıra ve koşullar. */
function rosterDisplayStatus(f: DbRow, nowMs: number): { status: FlightStatus | 'scheduled'; trace: string[]; reason: string } {
  const trace: string[] = [];
  if (f.api_refresh_phase === 'passive_upcoming') {
    trace.push('1) api_refresh_phase === passive_upcoming → ekranda scheduled');
    return { status: 'scheduled', trace, reason: 'passive_upcoming' };
  }
  const todayLocal = getLocalDateStringPlusDays(0);
  trace.push(`2) todayLocal (script makinesi) = ${todayLocal}, flight_date = ${f.flight_date ?? 'null'}`);
  const fromApi = f.flight_status as FlightStatus | null | undefined;
  const allowed = [
    'cancelled',
    'diverted',
    'incident',
    'redirected',
    'scheduled',
    'taxi_out',
    'departed',
    'en_route',
    'landed',
    'parked',
  ];
  if (!fromApi || !allowed.includes(fromApi)) {
    trace.push(`3) flight_status geçersiz veya boş (${String(fromApi)}) → scheduled`);
    return { status: 'scheduled', trace, reason: 'invalid_or_empty_flight_status' };
  }
  const normalized = fromApi === 'parked' ? 'landed' : fromApi;
  trace.push(`4) DB flight_status=${fromApi} → normalize=${normalized}`);
  if (f.api_refresh_phase === 'semi_active' && normalized === 'taxi_out') {
    trace.push('5) semi_active + taxi_out → scheduled');
    return { status: 'scheduled', trace, reason: 'semi_active_blocks_taxi_out' };
  }
  if (f.flight_date && f.flight_date > todayLocal && !f.actual_arrival && normalized === 'landed') {
    trace.push(
      '6) flight_date > todayLocal && !actual_arrival && landed → scheduled (gelecek gün, varış yazılmamış)',
    );
    return { status: 'scheduled', trace, reason: 'future_date_no_actual_arrival_blocks_landed' };
  }
  if (f.flight_date && f.flight_date > todayLocal && normalized === 'landed') {
    trace.push('7) flight_date > todayLocal && landed → scheduled');
    return { status: 'scheduled', trace, reason: 'future_date_blocks_landed' };
  }
  const depMs = parseUtcMsStatic(f.scheduled_departure);
  if (normalized === 'landed' && depMs > nowMs + 120_000) {
    trace.push(
      `8) landed ama scheduled_departure (${f.scheduled_departure}) > now+2dk → scheduled`,
    );
    return { status: 'scheduled', trace, reason: 'future_departure_blocks_landed' };
  }
  trace.push('9) Tüm guard’lar geçildi → ekranda DB normalize statü kullanılır');
  return { status: normalized, trace, reason: 'use_db_status' };
}

function printRowBlock(row: DbRow, nowMs: number): void {
  const fields: Record<string, string | null | boolean | undefined> = {
    flight_status: row.flight_status ?? null,
    actual_arrival: row.actual_arrival ?? null,
    fr24_datetime_landed_utc: row.fr24_datetime_landed_utc ?? null,
    scheduled_departure: row.scheduled_departure ?? null,
    flight_date: row.flight_date ?? null,
  };
  console.log('\n── Ham alanlar (DB) ──');
  for (const [k, v] of Object.entries(fields)) {
    console.log(`  ${k}: ${v === null || v === undefined ? '(null)' : String(v)}`);
  }
  console.log('  (ek) api_refresh_phase:', row.api_refresh_phase ?? '(null)');
  console.log('  (ek) id:', row.id ?? '(null)');
  console.log('  (ek) flight_number:', row.flight_number ?? '(null)');
  console.log('  (ek) updated_at:', row.updated_at ?? '(null)');

  const dec = rosterDisplayStatus(row, nowMs);
  console.log('\n── Karar (Roster.tsx getFlightStatus ile aynı) ──');
  dec.trace.forEach((line) => console.log(`  ${line}`));
  console.log(`\n  → reason: ${dec.reason}`);
  console.log(`  → roster’da gösterilen statü: ${dec.status}`);
  if (dec.status === 'landed') {
    console.log(
      '  → “İndi” etiketi: flight_status (veya parked→landed) guard’lardan sonra hâlä landed.',
    );
  }
}

async function fetchRows(flight: string, date?: string): Promise<DbRow[]> {
  const variants = flightNumberVariants(flight);
  if (variants.length === 0 || !SUPABASE_URL || !AUTH_KEY) return [];

  const select =
    'id,flight_number,flight_date,flight_status,actual_arrival,fr24_datetime_landed_utc,scheduled_departure,api_refresh_phase,updated_at';
  const params = new URLSearchParams({
    select,
    flight_number: `in.(${variants.join(',')})`,
    order: 'updated_at.desc',
    limit: '5',
  });
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    params.set('flight_date', `eq.${date}`);
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/flights?${params.toString()}`, {
    headers: {
      apikey: AUTH_KEY,
      Authorization: `Bearer ${AUTH_KEY}`,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('REST error:', res.status, data);
    return [];
  }
  return Array.isArray(data) ? (data as DbRow[]) : [];
}

async function main(): Promise<void> {
  const { flight, date } = parseArgs();
  if (!flight) {
    console.log(
      'Kullanım: npx tsx scripts/roster-status-trace.ts --flight PC130 [--date 2026-03-26]\n',
    );
    process.exit(1);
  }
  if (!SUPABASE_URL || !AUTH_KEY) {
    console.error('Eksik: EXPO_PUBLIC_SUPABASE_URL ve auth key (anon veya SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }
  const usingService = !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  console.log('roster-status-trace');
  console.log('  cwd:', process.cwd(), '(burada olmalı: .../FLYFAM/mobile)');
  console.log('  dotenv okunan dosyalar:', _envLoadedFrom.length ? _envLoadedFrom.join(', ') : '(hiçbiri bulunamadı)');
  console.log('  supabase:', SUPABASE_URL);
  console.log('  auth:', usingService ? 'SUPABASE_SERVICE_ROLE_KEY' : 'EXPO_PUBLIC_SUPABASE_ANON_KEY (RLS uygulanır)');
  console.log('  flight:', flight, date ? `date=${date}` : '(tarih filtresi yok, son 5 güncelleme)');

  const nowMs = Date.now();
  const rows = await fetchRows(flight, date);
  if (rows.length === 0) {
    console.log('\nSatır yok. Olası nedenler:');
    console.log('  • Bu tarihte/numarada gerçekten flights satırı yok.');
    console.log('  • Anon key ile RLS: sadece policy’nin izin verdiği satırlar gelir.');
    console.log('  Çözüm: repo kökündeki .env içinde SUPABASE_SERVICE_ROLE_KEY tanımlı olsun;');
    console.log('    script zaten ../.env dosyasını da yükler (mobile içinden çalıştırınca).');
    console.log('  Alternatif: mobile/.env içine aynı anahtarı ekle (asla commit etme).');
    if (!usingService) {
      console.log('\n  Şu an service role yüklü görünmüyor; kök .env yolunu kontrol et.');
    }
    process.exit(0);
  }
  rows.forEach((row, i) => {
    console.log(`\n######## Satır ${i + 1}/${rows.length} ########`);
    printRowBlock(row, nowMs);
  });
  console.log('\nBitti.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
