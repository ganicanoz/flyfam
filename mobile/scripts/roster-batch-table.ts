import dotenv from 'dotenv';
import path from 'path';
import { computeApiRefreshPhase, type ApiRefreshPhase } from '../lib/flightApiRefreshPhase';

type DbStatus =
  | 'scheduled'
  | 'taxi_out'
  | 'departed'
  | 'en_route'
  | 'landed'
  | 'parked'
  | 'cancelled'
  | 'diverted'
  | 'incident'
  | 'redirected'
  | null;

type DbRow = {
  id: string;
  flight_number: string | null;
  flight_date: string | null;
  api_refresh_phase: string | null;
  phase_active_locked: boolean | null;
  flight_status: DbStatus;
  delay_dep_min: number | null;
  delay_arr_min: number | null;
  airlabs_progress_percent: number | null;
  fr24_progress_dep_utc: string | null;
  fr24_progress_eta_utc: string | null;
  fr24_datetime_landed_utc: string | null;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  estimated_departure: string | null;
  actual_arrival: string | null;
  origin_airport: string | null;
  roster_entry_kind: 'flight' | 'sim' | 'duty_off' | null;
  updated_at: string | null;
};

type RowOut = {
  flight: string;
  date: string;
  phase: string;
  status: string;
  delay: string;
  percent: string;
  reasons: string;
};

const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

function loadEnvForScripts(): void {
  const tryLoad = (p: string) => {
    dotenv.config({ path: path.resolve(p) });
  };
  tryLoad(path.join(process.cwd(), '.env.local'));
  tryLoad(path.join(process.cwd(), '.env'));
  tryLoad(path.join(process.cwd(), '..', '.env.local'));
  tryLoad(path.join(process.cwd(), '..', '.env'));
}

function parseUtcMs(s: string | null | undefined): number {
  if (!s) return 0;
  const t = new Date(String(s).trim()).getTime();
  return Number.isFinite(t) ? t : 0;
}

function flightVariants(raw: string): string[] {
  const v = raw.replace(/\s/g, '').toUpperCase();
  const out = [v];
  const m = v.match(/^([A-Z]{2})(\d+)$/);
  if (!m) return out;
  const code = m[1];
  const num = m[2];
  if (num.length === 3) out.push(`${code}0${num}`);
  if (num.length === 4 && num.startsWith('0')) out.push(`${code}${num.slice(1)}`);
  const icao = IATA_TO_ICAO[code];
  if (icao) {
    out.push(`${icao}${num}`);
    if (num.length === 3) out.push(`${icao}0${num}`);
  }
  return [...new Set(out)];
}

function normalizeDisplayStatus(r: DbRow): { value: string; reason: string } {
  const s = (r.flight_status ?? '').toLowerCase();
  if (!s) return { value: 'scheduled', reason: 'status missing -> scheduled fallback' };
  if (s === 'parked') return { value: 'landed', reason: 'parked normalized to landed' };
  if (s === 'landed' && r.flight_date && r.flight_date > new Date().toISOString().slice(0, 10) && !r.actual_arrival) {
    return { value: 'scheduled', reason: 'future date + no actual_arrival blocks landed' };
  }
  return { value: s, reason: 'db status used' };
}

function pickDelay(r: DbRow, status: string): { text: string; reason: string } {
  if (status === 'scheduled') {
    if ((r.delay_dep_min ?? 0) > 0) return { text: `${r.delay_dep_min}m(dep)`, reason: 'scheduled -> departure delay' };
    return { text: '-', reason: 'scheduled but no positive departure delay' };
  }
  if (['taxi_out', 'departed', 'en_route', 'landed'].includes(status)) {
    if ((r.delay_arr_min ?? 0) > 0) return { text: `${r.delay_arr_min}m(arr)`, reason: 'in-flight/landed -> arrival delay' };
    return { text: '-', reason: 'no positive arrival delay' };
  }
  return { text: '-', reason: 'terminal status; delay not shown' };
}

function pickPercent(r: DbRow, nowMs: number): { text: string; reason: string } {
  const landedTs = parseUtcMs(r.fr24_datetime_landed_utc);
  if (landedTs > 0) return { text: '100%(fr24_landed)', reason: 'fr24 landed timestamp exists' };

  const dep = parseUtcMs(r.fr24_progress_dep_utc);
  const eta = parseUtcMs(r.fr24_progress_eta_utc);
  if (dep > 0 && eta > dep) {
    const ratio = nowMs <= dep ? 0 : nowMs >= eta ? 1 : (nowMs - dep) / (eta - dep);
    return { text: `${Math.round(ratio * 100)}%(fr24_bar)`, reason: 'fr24 progress anchors used' };
  }

  if (typeof r.airlabs_progress_percent === 'number' && r.airlabs_progress_percent >= 0) {
    return { text: `${Math.round(r.airlabs_progress_percent)}%(airlabs)`, reason: 'airlabs percent fallback' };
  }
  return { text: '-', reason: 'no fr24/airlabs percentage data' };
}

function computePhase(r: DbRow, nowMs: number): { text: string; reason: string } {
  const calc = computeApiRefreshPhase({
    roster_entry_kind: r.roster_entry_kind ?? 'flight',
    scheduled_departure: r.scheduled_departure,
    scheduled_arrival: r.scheduled_arrival,
    estimated_departure: r.estimated_departure,
    nowMs,
    roster_flight_date: r.flight_date,
    origin_airport: r.origin_airport,
    delay_dep_min: r.delay_dep_min,
    flight_status: r.flight_status,
    actual_arrival: r.actual_arrival,
    fr24_datetime_landed_utc: r.fr24_datetime_landed_utc,
    phase_active_locked: r.phase_active_locked,
  });
  const db = r.api_refresh_phase ?? '-';
  const c = calc ?? '-';
  const lock = r.phase_active_locked ? 'locked' : 'unlocked';
  return { text: `${db}/${c}`, reason: `phase db/calc + ${lock}` };
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

function printTable(rows: RowOut[]): void {
  const headers = ['Flight', 'Date', 'Phase(db/calc)', 'Status', 'Delay', 'Percent', 'Reasons'];
  const widths = [
    Math.max(headers[0].length, ...rows.map((r) => r.flight.length)),
    Math.max(headers[1].length, ...rows.map((r) => r.date.length)),
    Math.max(headers[2].length, ...rows.map((r) => r.phase.length)),
    Math.max(headers[3].length, ...rows.map((r) => r.status.length)),
    Math.max(headers[4].length, ...rows.map((r) => r.delay.length)),
    Math.max(headers[5].length, ...rows.map((r) => r.percent.length)),
    Math.max(headers[6].length, ...rows.map((r) => r.reasons.length)),
  ];

  const line = `| ${pad(headers[0], widths[0])} | ${pad(headers[1], widths[1])} | ${pad(headers[2], widths[2])} | ${pad(headers[3], widths[3])} | ${pad(headers[4], widths[4])} | ${pad(headers[5], widths[5])} | ${pad(headers[6], widths[6])} |`;
  const sep = `|-${'-'.repeat(widths[0])}-|-${'-'.repeat(widths[1])}-|-${'-'.repeat(widths[2])}-|-${'-'.repeat(widths[3])}-|-${'-'.repeat(widths[4])}-|-${'-'.repeat(widths[5])}-|-${'-'.repeat(widths[6])}-|`;
  console.log(line);
  console.log(sep);
  for (const r of rows) {
    console.log(
      `| ${pad(r.flight, widths[0])} | ${pad(r.date, widths[1])} | ${pad(r.phase, widths[2])} | ${pad(r.status, widths[3])} | ${pad(r.delay, widths[4])} | ${pad(r.percent, widths[5])} | ${pad(r.reasons, widths[6])} |`,
    );
  }
}

async function fetchLatestByVariants(baseUrl: string, auth: string, variants: string[]): Promise<DbRow | null> {
  const select =
    'id,flight_number,flight_date,api_refresh_phase,phase_active_locked,flight_status,delay_dep_min,delay_arr_min,airlabs_progress_percent,fr24_progress_dep_utc,fr24_progress_eta_utc,fr24_datetime_landed_utc,scheduled_departure,scheduled_arrival,estimated_departure,actual_arrival,origin_airport,roster_entry_kind,updated_at';
  const params = new URLSearchParams({
    select,
    flight_number: `in.(${variants.join(',')})`,
    order: 'updated_at.desc',
    limit: '1',
  });
  const url = `${baseUrl.replace(/\/$/, '')}/rest/v1/flights?${params.toString()}`;
  const res = await fetch(url, { headers: { apikey: auth, Authorization: `Bearer ${auth}` } });
  const json = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(json) || json.length === 0) return null;
  return json[0] as DbRow;
}

async function main(): Promise<void> {
  loadEnvForScripts();
  const baseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
  const auth = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!baseUrl || !auth) {
    console.error('Missing SUPABASE url/key in env.');
    process.exit(1);
  }

  const raw = process.argv.slice(2).map((x) => x.trim()).filter(Boolean);
  const flights: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]!;
    const next = raw[i + 1];
    if (/^[A-Za-z]{2,3}$/.test(cur) && next && /^\d{2,5}$/.test(next)) {
      flights.push(`${cur} ${next}`);
      i += 1;
      continue;
    }
    flights.push(cur);
  }
  if (flights.length === 0) {
    console.error('Usage: tsx scripts/roster-batch-table.ts "PC2282" "PC1234" ...');
    process.exit(1);
  }

  const nowMs = Date.now();
  const out: RowOut[] = [];
  for (const f of flights) {
    const variants = flightVariants(f);
    const row = await fetchLatestByVariants(baseUrl, auth, variants);
    if (!row) {
      out.push({
        flight: f,
        date: '-',
        phase: '-',
        status: '-',
        delay: '-',
        percent: '-',
        reasons: 'no row found in flights table',
      });
      continue;
    }

    const status = normalizeDisplayStatus(row);
    const phase = computePhase(row, nowMs);
    const delay = pickDelay(row, status.value);
    const pct = pickPercent(row, nowMs);
    out.push({
      flight: f,
      date: row.flight_date ?? '-',
      phase: phase.text,
      status: status.value,
      delay: delay.text,
      percent: pct.text,
      reasons: `${phase.reason}; ${status.reason}; ${delay.reason}; ${pct.reason}`,
    });
  }

  printTable(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
