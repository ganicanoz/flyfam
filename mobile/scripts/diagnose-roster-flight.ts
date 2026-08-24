/**
 * PC1574 (veya herhangi bir uçuş) neden roster’da "Planlı" görünüyor — adım adım tanı.
 *
 * Kullanım:
 *   cd mobile && npx tsx scripts/diagnose-roster-flight.ts 2026-03-29 PC1574
 *   npx tsx scripts/diagnose-roster-flight.ts 2026-03-29 PC1574 --now=2026-03-29T18:00:00.000Z
 *
 * Env (.env):
 *   EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY → RLS; JWT olmadan genelde 0 satır.
 *   SUPABASE_SERVICE_ROLE_KEY (mobile/.env) → tanı için neredeyse zorunlu; yalnızca yerel kullan.
 *   EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN veya FR24_API_TOKEN → FR24 ham JSON (flight-summary/light).
 *
 * Çıktı: (1) DB satırı (2) faz (3) Roster etiketi (4) FR24 ham yanıt + uygulamanın seçtiği bacak
 */
import 'dotenv/config';
import {
  computeApiRefreshPhase,
  explainComputeApiRefreshPhase,
  type ApiRefreshPhase,
} from '../lib/flightApiRefreshPhase';
import { fetchFr24LightDiagnostic } from './fr24LightForDiagnose';

/** Roster dateUtils ile aynı: script’in çalıştığı makinenin yerel takvimi. */
function getLocalDateStringPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + (Number.isFinite(days) ? days : 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
const KEY = SERVICE_KEY || ANON_KEY;

type FlightRow = Record<string, unknown>;

function parseUtcMsStatic(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return 0;
  let s = iso.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return 0;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? `${s}:00.000Z` : `${s}Z`;
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Roster.tsx getFlightStatus ile aynı sıra (özet). */
function explainRosterDisplayStatus(
  f: {
    api_refresh_phase?: string | null;
    flight_status?: string | null;
    flight_date?: string | null;
    actual_arrival?: string | null;
    scheduled_departure?: string | null;
  },
  refreshPhase: ApiRefreshPhase | null,
  nowMs: number,
): { display: string; steps: string[] } {
  const steps: string[] = [];
  const todayLocal = getLocalDateStringPlusDays(0);
  steps.push(`R1) Bugün (script makinesi yerel tarihi): ${todayLocal}`);

  if (refreshPhase === 'passive_future' || refreshPhase === 'passive_upcoming') {
    steps.push(
      `R2) Client fazı passive_future/upcoming → ekranda her zaman "Planlı" (scheduled), DB flight_status ne olursa olsun.`,
    );
    return { display: 'Planlı (scheduled)', steps };
  }

  const fromApi = (f.flight_status ?? '') as string;
  steps.push(`R2) Client fazı "${refreshPhase ?? 'null'}" → passive_future kuralı uygulanmadı.`);

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
    steps.push(`R3) flight_status boş veya tanınmıyor → varsayılan Planlı.`);
    return { display: 'Planlı (scheduled)', steps };
  }

  const normalized = fromApi === 'parked' ? 'landed' : fromApi;
  steps.push(`R3) flight_status=${fromApi} → normalize=${normalized}`);

  if (refreshPhase === 'semi_active' && normalized === 'taxi_out') {
    steps.push(`R4) semi_active + taxi_out → ürün kuralı: Planlı göster.`);
    return { display: 'Planlı (scheduled)', steps };
  }

  if (f.flight_date && f.flight_date > todayLocal && !f.actual_arrival && normalized === 'landed') {
    steps.push(`R4) Gelecek flight_date + landed → Planlı.`);
    return { display: 'Planlı (scheduled)', steps };
  }
  if (f.flight_date && f.flight_date > todayLocal && normalized === 'landed') {
    steps.push(`R4) Gelecek flight_date + landed → Planlı.`);
    return { display: 'Planlı (scheduled)', steps };
  }
  const depMs = parseUtcMsStatic(f.scheduled_departure);
  if (normalized === 'landed' && depMs > nowMs + 120_000) {
    steps.push(`R4) landed ama kalkış 2dk+ ileride → Planlı.`);
    return { display: 'Planlı (scheduled)', steps };
  }

  const labels: Record<string, string> = {
    scheduled: 'Planlı',
    taxi_out: 'Taksi',
    departed: 'Ayrıldı',
    en_route: 'Kalktı',
    landed: 'İndi',
    cancelled: 'İptal',
    diverted: 'Aktarmalı',
    incident: 'Olay',
    redirected: 'Yönlendirildi',
  };
  steps.push(`R5) Gösterilen durum: ${normalized} → "${labels[normalized] ?? normalized}"`);
  return { display: labels[normalized] ?? normalized, steps };
}

const SELECT_COLS = [
  'id',
  'flight_number',
  'flight_date',
  'roster_entry_kind',
  'origin_airport',
  'scheduled_departure',
  'scheduled_arrival',
  'estimated_departure',
  'estimated_arrival',
  'delay_dep_min',
  'delay_arr_min',
  'flight_status',
  'internal_status',
  'actual_arrival',
  'api_refresh_phase',
  'phase_active_locked',
  'fr24_datetime_landed_utc',
  'updated_at',
].join(',');

async function restFlightsQuery(params: Record<string, string>): Promise<FlightRow[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/flights`);
  url.searchParams.set('select', SELECT_COLS);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${res.status}: ${txt.slice(0, 500)}`);
  }
  const data = (await res.json()) as FlightRow[];
  return Array.isArray(data) ? data : [];
}

/** Tarih + numara (dar filtre). */
async function fetchFlights(flightDate: string, flightNumber: string): Promise<FlightRow[]> {
  if (!SUPABASE_URL || !KEY) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL ve ANON veya SUPABASE_SERVICE_ROLE_KEY gerekli.');
  }
  return restFlightsQuery({
    flight_number: `eq.${flightNumber.toUpperCase()}`,
    flight_date: `eq.${flightDate}`,
    order: 'updated_at.desc',
    limit: '5',
  });
}

/** Sadece numara — RLS altında en azından “görebildiğin” son bacakları listeler. */
async function fetchRecentByFlightNumber(flightNumber: string, limit = 12): Promise<FlightRow[]> {
  return restFlightsQuery({
    flight_number: `eq.${flightNumber.toUpperCase()}`,
    order: 'flight_date.desc',
    limit: String(limit),
  });
}

function section(title: string) {
  process.stdout.write(`\n${'═'.repeat(72)}\n  ${title}\n${'═'.repeat(72)}\n`);
}

const FR24_TOKEN = (
  process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN ?? process.env.FR24_API_TOKEN ?? ''
).trim();

async function sectionFr24Dump(flightDate: string, flightNumber: string) {
  section('FR24) flight-summary/light — ham yanıt');
  if (!FR24_TOKEN) {
    process.stdout.write(
      'Token yok. mobile/.env içine EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN (veya FR24_API_TOKEN) ekleyin.\n',
    );
    return;
  }
  try {
    const d = await fetchFr24LightDiagnostic(flightNumber, flightDate, FR24_TOKEN);
    process.stdout.write(`İstek URL:\n  ${d.requestUrl}\n`);
    process.stdout.write(`HTTP: ${d.httpStatus}\n`);
    process.stdout.write(`data[] bacak sayısı: ${d.dataLegs.length}\n`);
    process.stdout.write(
      `Roster günü (${flightDate}) ile eşleşen bacak: ${d.legsMatchingRosterDate.length}\n`,
    );
    if (d.selectedLeg) {
      process.stdout.write('\nUygulamanın seçtiği bacak (mobil poll ile aynı kural) — önemli alanlar:\n');
      const pick = [
        'fr24_id',
        'fr24Id',
        'id',
        'flight_ended',
        'flightEnded',
        'orig_icao',
        'origin_icao',
        'dest_icao',
        'destination_icao',
        'scheduled_departure_utc',
        'scheduled_departure',
        'scheduled_arrival_utc',
        'scheduled_arrival',
        'estimated_departure_utc',
        'estimated_departure',
        'estimated_arrival_utc',
        'estimated_arrival',
        'first_seen',
        'firstSeen',
        'datetime_takeoff',
        'datetimeTakeoff',
        'datetime_landed',
        'datetimeLanded',
        'last_seen',
        'lastSeen',
      ];
      for (const k of pick) {
        const v = d.selectedLeg[k];
        if (v !== undefined && v !== null && v !== '') {
          process.stdout.write(`  ${k}: ${JSON.stringify(v)}\n`);
        }
      }
    } else {
      process.stdout.write(
        '\nSeçilen bacak yok (tarih eşleşmesi yok veya data boş). Aşağıdaki tam JSON’da tüm bacaklar var.\n',
      );
    }
    process.stdout.write('\n--- Tam API JSON ---\n');
    process.stdout.write(`${JSON.stringify(d.rawJson, null, 2)}\n`);
  } catch (e) {
    process.stdout.write(`FR24 isteği hata: ${String((e as Error)?.message ?? e)}\n`);
  }
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const nowArg = process.argv.find((a) => a.startsWith('--now='));

  if (args.length < 2) {
    process.stderr.write(`
Kullanım:
  npx tsx scripts/diagnose-roster-flight.ts YYYY-MM-DD PC1574
  npx tsx scripts/diagnose-roster-flight.ts YYYY-MM-DD PC1574 --now=2026-03-29T15:00:00.000Z

ANON ile çoğu zaman 0 satır (RLS). Tanı için mobile/.env → SUPABASE_SERVICE_ROLE_KEY ekleyin.
FR24 çıktısı için: EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN veya FR24_API_TOKEN.
`);
    process.exit(1);
  }

  const flightDate = args[0]!.trim();
  const flightNumber = args[1]!.trim().toUpperCase();
  const nowMs = nowArg ? new Date(nowArg.replace('--now=', '')).getTime() : Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error('Geçersiz --now=');
  }

  const keyLabel = SERVICE_KEY ? 'SERVICE_ROLE' : 'ANON (RLS aktif)';
  section(`0) Bağlantı ve zaman`);
  process.stdout.write(`Supabase URL: ${SUPABASE_URL ? 'OK' : 'EKSİK'}\n`);
  process.stdout.write(`Anahtar: ${keyLabel}\n`);
  process.stdout.write(`Şimdi (nowMs): ${nowMs} = ${new Date(nowMs).toISOString()} UTC\n`);
  process.stdout.write(`Sorgu: flight_date=${flightDate} flight_number=${flightNumber}\n`);

  fetchFlights(flightDate, flightNumber)
    .then(async (rows) => {
      section('1) DB’den gelen satır(lar)');
      if (rows.length === 0) {
        process.stdout.write(
          'Bu tarih + numara ile 0 satır.\n\n',
        );
        process.stdout.write(
          '• ANON anahtar: `flights` tablosunda RLS genelde sadece oturum açmış crew’ün satırlarını döner; script’te JWT yok → çoğu zaman BOŞ liste.\n',
        );
        process.stdout.write(
          '• Çözüm: `mobile/.env` içine Dashboard → Settings → API → `service_role` gizli anahtarını ekle:\n',
        );
        process.stdout.write(
          '    SUPABASE_SERVICE_ROLE_KEY=eyJ...\n',
        );
        process.stdout.write(
          '  (Bu anahtarı asla uygulamaya gömme; sadece yerel tanı script’i için.)\n\n',
        );

        const recent = await fetchRecentByFlightNumber(flightNumber);
        if (recent.length > 0) {
          process.stdout.write(
            `Aynı numara (${flightNumber}) ile RLS’in döndürdüğü son kayıtlar (tarihi kontrol et, komutu o günle tekrarla):\n`,
          );
          for (const r of recent) {
            process.stdout.write(
              `  id=${r.id} flight_date=${r.flight_date} updated_at=${r.updated_at ?? '—'}\n`,
            );
          }
        } else {
          process.stdout.write(
            `Sadece numara ile de 0 satır → büyük ihtimalle RLS (anon) hiç satır göstermiyor. SERVICE_ROLE ekle veya tarih/numara yanlış.\n`,
          );
        }
        await sectionFr24Dump(flightDate, flightNumber);
        process.exit(2);
      }
      if (rows.length > 1) {
        process.stdout.write(`Uyarı: ${rows.length} satır; ilki kullanılıyor (updated_at desc).\n\n`);
      }
      const row = rows[0]!;
      for (const k of Object.keys(row).sort()) {
        process.stdout.write(`  ${k}: ${JSON.stringify(row[k])}\n`);
      }

      const phaseArgs = {
        roster_entry_kind: (row.roster_entry_kind as string) ?? 'flight',
        scheduled_departure: row.scheduled_departure as string | null,
        scheduled_arrival: row.scheduled_arrival as string | null,
        estimated_departure: row.estimated_departure as string | null | undefined,
        nowMs,
        roster_flight_date: row.flight_date as string,
        origin_airport: row.origin_airport as string | null,
        delay_dep_min: row.delay_dep_min as number | null,
        flight_status: row.flight_status as string | null,
        internal_status: row.internal_status as string | null,
        actual_arrival: row.actual_arrival as string | null,
        fr24_datetime_landed_utc: row.fr24_datetime_landed_utc as string | null,
        phase_active_locked: row.phase_active_locked as boolean | null,
      };

      section('2) Faz hesabı (mobil ile aynı: computeApiRefreshPhase)');
      const explained = explainComputeApiRefreshPhase(phaseArgs);
      explained.steps.forEach((s, i) => process.stdout.write(`  ${s}\n`));
      const computed = computeApiRefreshPhase(phaseArgs);
      process.stdout.write(`\n  → Sonuç faz: ${explained.phase} (doğrulama compute=${computed})\n`);

      section('3) DB’de kayıtlı api_refresh_phase (cron/tetikleyici)');
      process.stdout.write(`  api_refresh_phase: ${JSON.stringify(row.api_refresh_phase)}\n`);
      process.stdout.write(`  phase_active_locked: ${JSON.stringify(row.phase_active_locked)}\n`);
      if (row.api_refresh_phase !== explained.phase) {
        process.stdout.write(
          `\n  ⚠️  DB fazı ile client hesabı FARKLI. Liste yenilenince / cron sonrası senkron olur.\n`,
        );
      }

      section('4) Roster sağ kutu — neden "Planlı"? (getFlightStatus özeti)');
      const ui = explainRosterDisplayStatus(
        {
          api_refresh_phase: row.api_refresh_phase as string,
          flight_status: row.flight_status as string,
          flight_date: row.flight_date as string,
          actual_arrival: row.actual_arrival as string | null,
          scheduled_departure: row.scheduled_departure as string | null,
        },
        explained.phase,
        nowMs,
      );
      ui.steps.forEach((s) => process.stdout.write(`  ${s}\n`));
      process.stdout.write(`\n  → Beklenen etiket: ${ui.display}\n`);

      section('5) Özet');
      process.stdout.write(`  flight_status (DB): ${row.flight_status ?? 'null'}\n`);
      process.stdout.write(`  internal_status (DB): ${row.internal_status ?? 'null'}\n`);
      process.stdout.write(`  Client faz: ${explained.phase}\n`);
      process.stdout.write(`  DB faz: ${row.api_refresh_phase ?? 'null'}\n`);
      process.stdout.write(`  Ekran: ${ui.display}\n`);
      process.stdout.write(`
  Sonraki adımlar:
  - "Planlı" ve client faz passive_future ise: kalkış saati / now / TZ ile STD−3h penceresini kontrol et.
  - Uçak havadayken hâlâ Planlı: flight_status ve internal_status hâlâ scheduled mi? Cron / swipe sync.
  - DB faz ≠ client faz: supabase db push + refresh_flights_api_refresh_phase veya cron bekle.
`);

      await sectionFr24Dump(flightDate, flightNumber);
    })
    .catch((e) => {
      process.stderr.write(String(e?.message ?? e) + '\n');
      process.exit(1);
    });
}

main();
