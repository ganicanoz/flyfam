import 'dotenv/config';
import { computeApiRefreshPhase, type ApiRefreshPhase } from '../lib/flightApiRefreshPhase';

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

type RosterEntryKind = 'flight' | 'duty_off' | 'sim' | null | undefined;

type FlightCardInput = {
  id?: string;
  flight_number: string;
  flight_date: string;
  roster_entry_kind?: RosterEntryKind;
  origin_airport?: string | null;
  origin_city?: string | null;
  destination_airport?: string | null;
  destination_city?: string | null;
  scheduled_departure?: string | null;
  scheduled_arrival?: string | null;
  fr24_progress_dep_utc?: string | null;
  fr24_progress_eta_utc?: string | null;
  fr24_datetime_landed_utc?: string | null;
  flight_status?: FlightStatus | null;
  airlabs_progress_percent?: number | null;
  delay_dep_min?: number | null;
  delay_arr_min?: number | null;
  delay_cache_dep_min?: number | null;
  delay_cache_arr_min?: number | null;
  diverted_to?: string | null;
  lookup_source?: string | null;
  fr24_debug?: Record<string, unknown>;
  estimated_departure?: string | null;
  actual_arrival?: string | null;
  phase_active_locked?: boolean | null;
};

const FR24_TOKEN = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN ?? '';
const AIRLABS_KEY = process.env.EXPO_PUBLIC_AIRLABS_API_KEY ?? process.env.AIRLABS_API_KEY ?? '';
const AEROAPI_KEY =
  process.env.AEROAPI_API_KEY ??
  process.env.FLIGHTAWARE_AEROAPI_KEY ??
  process.env.EXPO_PUBLIC_AEROAPI_API_KEY ??
  '';
const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_API_KEY ?? process.env.EXPO_PUBLIC_AVIATIONSTACK_API_KEY ?? '';
const AVIATIONSTACK_BASE = 'https://api.aviationstack.com/v1';
const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';
const AERODATABOX_RAPIDAPI_KEY =
  (process.env.AERODATABOX_RAPIDAPI_KEY ?? process.env.EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY ?? '').trim() ||
  AERODATABOX_RAPIDAPI_FALLBACK;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

type DecisionOptions = {
  nowIso?: string;
  language?: 'tr' | 'en';
  debug?: string;
};

type FlightCardDecision = {
  kind: 'flight' | 'duty_off' | 'sim';
  status: Exclude<FlightStatus, 'parked'>;
  statusLabel: string;
  statusIsError: boolean;
  phase: ApiRefreshPhase | null;
  phaseDebug?: PhaseDebug;
  progress: {
    ratio: number | null;
    percentText: string | null;
    source: 'fr24_estimated' | 'scheduled' | 'airlabs_percent' | null;
  };
  delayMinutes: number | null;
  delaySource: 'dep' | 'arr' | null;
  route: {
    depLabel: string;
    arrLabel: string;
  };
  times: {
    depIstanbul: string;
    depKarachi: string;
    depUtc: string;
    arrIstanbul: string;
    arrKarachi: string;
    arrUtc: string;
  };
  flightNumberText: string;
  divertedTo: string | null;
};

type PhaseDebug = {
  nowIso: string;
  scheduledDepUsed: string | null;
  scheduledArrUsed: string | null;
  depMs: number;
  arrMs: number;
  endMs: number;
  phase: ApiRefreshPhase | null;
};

function padRight(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

function printCardTable(input: FlightCardInput, decision: FlightCardDecision, options?: DecisionOptions): void {
  const title = (input.id ?? 'Algoritma Simulatoru').trim();
  const line1 = `✈️  ${decision.flightNumberText}   ${decision.statusLabel}`;
  const line2 = `📅  ${input.flight_date}   •   ${title}`;
  const dep = `🛫 DEP  ${decision.route.depLabel}  —  ${decision.times.depIstanbul} (${decision.times.depKarachi}) / ${decision.times.depUtc}Z`;
  const arr = `🛬 ARR  ${decision.route.arrLabel}  —  ${decision.times.arrIstanbul} (${decision.times.arrKarachi}) / ${decision.times.arrUtc}Z`;
  const phase = `⏱ Faz: ${decision.phase ?? '—'}`;
  const delay = `⌛ Gecikme: ${decision.delayMinutes != null ? `${decision.delayMinutes} dk (${decision.delaySource ?? '-'})` : '—'}`;
  const pct = `📊 Yuzde: ${decision.progress.percentText ? `${decision.progress.percentText} [${decision.progress.source ?? '-'}]` : '—'}`;
  const src = `🛰 Kaynak: ${input.lookup_source ?? 'bulunamadi'}`;

  const content = [line1, line2, '', dep, arr, '', phase, delay, pct, src];
  const width = Math.max(...content.map((x) => x.length), 40);
  const top = `╔${'═'.repeat(width + 2)}╗`;
  const mid = `╟${'─'.repeat(width + 2)}╢`;
  const bottom = `╚${'═'.repeat(width + 2)}╝`;

  process.stdout.write(`${top}\n`);
  process.stdout.write(`║ ${padRight(line1, width)} ║\n`);
  process.stdout.write(`║ ${padRight(line2, width)} ║\n`);
  process.stdout.write(`${mid}\n`);
  process.stdout.write(`║ ${padRight(dep, width)} ║\n`);
  process.stdout.write(`║ ${padRight(arr, width)} ║\n`);
  process.stdout.write(`${mid}\n`);
  process.stdout.write(`║ ${padRight(phase, width)} ║\n`);
  process.stdout.write(`║ ${padRight(delay, width)} ║\n`);
  process.stdout.write(`║ ${padRight(pct, width)} ║\n`);
  process.stdout.write(`║ ${padRight(src, width)} ║\n`);
  process.stdout.write(`${bottom}\n`);

  const dbg = (options?.debug ?? '').trim().toLowerCase();
  if (dbg.includes('phase') && decision.phaseDebug) {
    const pd = decision.phaseDebug;
    process.stdout.write(
      `\n🧮 PhaseCalc (uses schedule times only): now=${pd.nowIso} depUsed=${pd.scheduledDepUsed ?? '—'} arrUsed=${pd.scheduledArrUsed ?? '—'} endMs=${pd.endMs} depMs=${pd.depMs} arrMs=${pd.arrMs} => ${pd.phase ?? '—'}\n`,
    );
  }
  if (dbg.includes('fr') && input.fr24_debug) {
    const fr = input.fr24_debug;
    process.stdout.write('\n🧾 FR24 selected-leg raw (flight-summary/light):\n');
    const keys = [
      'flight_ended',
      'flightEnded',
      'fr24_id',
      'fr24Id',
      'id',
      'scheduled_departure_utc',
      'scheduled_departure',
      'scheduled_arrival_utc',
      'scheduled_arrival',
      'estimated_departure_utc',
      'estimated_departure',
      'estimated_arrival_utc',
      'estimated_arrival',
      'estimated_landing_utc',
      'estimated_landing',
      'datetime_takeoff',
      'datetimeTakeoff',
      'first_seen',
      'firstSeen',
      'datetime_landed',
      'datetimeLanded',
      'last_seen',
      'lastSeen',
    ] as const;
    for (const k of keys) {
      const v = (fr as any)[k];
      if (v == null) continue;
      process.stdout.write(`- ${k}: ${String(v)}\n`);
    }
  }
}

function parseArgs(): { input: FlightCardInput; options: DecisionOptions } {
  const args = process.argv.slice(2);
  const plainArgs = args.filter((a) => !a.startsWith('--'));
  const idArg = args.find((a) => a.startsWith('--id='));
  const titleArg = args.find((a) => a.startsWith('--title='));
  const dateArg = args.find((a) => a.startsWith('--date='));
  const codeArg = args.find((a) => a.startsWith('--code='));
  const inputArg = args.find((a) => a.startsWith('--input='));
  const nowArg = args.find((a) => a.startsWith('--now='));
  const langArg = args.find((a) => a.startsWith('--lang='));

  let input: FlightCardInput;
  if (inputArg) {
    input = JSON.parse(inputArg.replace('--input=', '')) as FlightCardInput;
  } else if (idArg) {
    input = {
      id: idArg.replace('--id=', '').trim(),
      flight_number: '',
      flight_date: '',
      roster_entry_kind: 'flight',
    };
  } else if (plainArgs.length >= 2) {
    // Short mode: npm run card -- 2026-03-25 PC925
    input = {
      id: titleArg ? titleArg.replace('--title=', '') : 'Algoritma Simulatoru',
      flight_number: plainArgs[1]!.trim().toUpperCase(),
      flight_date: plainArgs[0]!.trim(),
      roster_entry_kind: 'flight',
      origin_airport: null,
      origin_city: null,
      destination_airport: null,
      destination_city: null,
      scheduled_departure: null,
      scheduled_arrival: null,
      flight_status: 'scheduled',
    };
  } else if (dateArg && codeArg) {
    input = {
      id: titleArg ? titleArg.replace('--title=', '') : 'Algoritma Simulatoru',
      flight_number: codeArg.replace('--code=', '').trim().toUpperCase(),
      flight_date: dateArg.replace('--date=', '').trim(),
      roster_entry_kind: 'flight',
      origin_airport: null,
      origin_city: null,
      destination_airport: null,
      destination_city: null,
      scheduled_departure: null,
      scheduled_arrival: null,
      flight_status: 'scheduled',
    };
  } else {
    throw new Error('Use: npm run card -- YYYY-MM-DD PC1234');
  }

  const options: DecisionOptions = {
    nowIso: nowArg ? nowArg.replace('--now=', '') : undefined,
    language: (langArg ? langArg.replace('--lang=', '') : 'tr') as 'tr' | 'en',
    debug: args.find((a) => a.startsWith('--debug='))?.replace('--debug=', '') ?? undefined,
  };
  return { input, options };
}

function parseUtcMs(iso: string | null | undefined): number {
  const d = parseFlightTimeAsUtcLocal(iso);
  return d ? d.getTime() : 0;
}

const MS_4H = 4 * 60 * 60 * 1000;

function parseFlightTimeAsUtcLocal(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  let s = iso.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) s = s.length <= 16 ? `${s}:00.000Z` : `${s}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatFlightTimeLocalLocal(iso: string | null | undefined): string {
  const d = parseFlightTimeAsUtcLocal(iso);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

function formatFlightTimeUtcLocal(iso: string | null | undefined): string {
  const d = parseFlightTimeAsUtcLocal(iso);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—';
}

const TZ_ISTANBUL = 'Europe/Istanbul';
const TZ_KARACHI = 'Asia/Karachi';

function formatFlightTimeInTimeZone(iso: string | null | undefined, timeZone: string): string {
  const d = parseFlightTimeAsUtcLocal(iso);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone, hour12: false }) : '—';
}

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

function plusIsoDay(isoDay: string, delta: number): string {
  const [yy, mm, dd] = isoDay.split('-').map(Number);
  const dt = new Date(Date.UTC(yy, (mm ?? 1) - 1, dd ?? 1, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function isDateNearby(iso: string | null, flightDate: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  if (d === flightDate) return true;
  return d === plusIsoDay(flightDate, -1) || d === plusIsoDay(flightDate, 1);
}

function fr24DepDateMatch(f: any): string {
  const dep =
    (f?.scheduled_departure_utc ??
      f?.scheduled_departure ??
      f?.first_seen ??
      f?.firstSeen ??
      f?.datetime_takeoff ??
      f?.datetimeTakeoff ??
      '') as string;
  const iso = toUtcIsoAssumeUtc(dep);
  return iso ? iso.slice(0, 10) : '';
}

function fr24ScheduledDepDate(f: any): string {
  const dep = (f?.scheduled_departure_utc ?? f?.scheduled_departure ?? '') as string;
  const iso = toUtcIsoAssumeUtc(dep);
  return iso ? iso.slice(0, 10) : '';
}

function fr24AnyDepDate(f: any): string {
  const dep =
    (f?.scheduled_departure_utc ??
      f?.scheduled_departure ??
      f?.first_seen ??
      f?.firstSeen ??
      f?.datetime_takeoff ??
      f?.datetimeTakeoff ??
      '') as string;
  const iso = toUtcIsoAssumeUtc(dep);
  return iso ? iso.slice(0, 10) : '';
}

function toUtcIsoAssumeUtc(dt: string | null | undefined): string | null {
  if (!dt || typeof dt !== 'string') return null;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) s = s.length <= 16 ? `${s}:00.000Z` : `${s}Z`;
  const ms = new Date(s).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function deriveFr24LiveStatus(
  nowMs: number,
  firstSeenUtc?: string | null,
  takeoffUtc?: string | null,
  landedUtc?: string | null,
): FlightStatus {
  const first = parseUtcMs(firstSeenUtc);
  const takeoff = parseUtcMs(takeoffUtc);
  const landed = parseUtcMs(landedUtc);
  if (first > 0 && nowMs < first) return 'scheduled';
  if (first > 0 && (takeoff === 0 || nowMs < takeoff)) return 'taxi_out';
  if (landed > 0 && nowMs >= landed) return 'landed';
  if (takeoff > 0 && (landed === 0 || nowMs < landed)) return 'en_route';
  if (first > 0 && nowMs >= first) return 'taxi_out';
  return 'scheduled';
}

function aeroCoerceScript(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.utc === 'string' && o.utc.trim()) return o.utc.trim();
    if (typeof o.local === 'string' && o.local.trim()) return o.local.trim();
  }
  return null;
}

function aeroRootLegsScript(root: Record<string, unknown>): { dep: Record<string, unknown>; arr: Record<string, unknown> } {
  const depDirect = root.departure;
  const arrDirect = root.arrival;
  if (depDirect && typeof depDirect === 'object' && !Array.isArray(depDirect) && arrDirect && typeof arrDirect === 'object' && !Array.isArray(arrDirect)) {
    return { dep: depDirect as Record<string, unknown>, arr: arrDirect as Record<string, unknown> };
  }
  const departures = Array.isArray(root.departures) ? (root.departures as Record<string, unknown>[]) : [];
  const arrivals = Array.isArray(root.arrivals) ? (root.arrivals as Record<string, unknown>[]) : [];
  const depWrap = departures[0] ?? {};
  const arrWrap = arrivals[0] ?? {};
  const dep = (typeof depWrap === 'object' && depWrap && 'departure' in depWrap
    ? (depWrap as { departure?: Record<string, unknown> }).departure
    : depWrap) as Record<string, unknown> | undefined;
  const arrv = (typeof arrWrap === 'object' && arrWrap && 'arrival' in arrWrap
    ? (arrWrap as { arrival?: Record<string, unknown> }).arrival
    : arrWrap) as Record<string, unknown> | undefined;
  return {
    dep: (dep && typeof dep === 'object' ? dep : root) as Record<string, unknown>,
    arr: (arrv && typeof arrv === 'object' ? arrv : root) as Record<string, unknown>,
  };
}

function normalizeOvernightArrScript(depIso: string | null, arrIso: string | null): string | null {
  if (!depIso || !arrIso) return arrIso;
  const depMs = new Date(depIso).getTime();
  const arrMs = new Date(arrIso).getTime();
  if (!Number.isFinite(depMs) || !Number.isFinite(arrMs)) return arrIso;
  if (arrMs < depMs) return new Date(arrMs + 24 * 60 * 60 * 1000).toISOString();
  return arrIso;
}

function timetableNeedsAeroBackupScript(o: Partial<FlightCardInput>): boolean {
  if (!o.scheduled_departure || !o.scheduled_arrival) return true;
  if (!o.origin_airport || !o.destination_airport) return true;
  if (!o.origin_city || !o.destination_city) return true;
  return false;
}

async function lookupFlightFromApis(flightNumber: string, flightDate: string, nowMs: number): Promise<Partial<FlightCardInput>> {
  const out: Partial<FlightCardInput> = {};
  const variants = flightNumberVariants(flightNumber);
  const code = variants[0] ?? flightNumber.replace(/\s+/g, '').toUpperCase();

  if (FR24_TOKEN) {
    try {
      const [y, m, d] = flightDate.split('-').map(Number);
      const from = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) - 2, 0, 0, 0)).toISOString().slice(0, 19);
      const to = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 2, 23, 59, 59)).toISOString().slice(0, 19);
      const flightsParam = variants.slice(0, 15).join(',');
      const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${FR24_TOKEN}`, Accept: 'application/json', 'Accept-Version': 'v1' } });
      const json = await res.json().catch(() => null);
      const list = Array.isArray(json?.data) ? json.data : [];
      const candidates = list.filter((x: any) => {
        // Strict rule: select only the leg whose scheduled departure date equals the selected date.
        const d = fr24ScheduledDepDate(x);
        return d === flightDate;
      });
      const anyDepCandidates =
        candidates.length > 0
          ? candidates
          : list.filter((x: any) => fr24AnyDepDate(x) === flightDate);
      if (anyDepCandidates.length === 0) return out;
      const pool = anyDepCandidates;
      const fr =
        pool.find((x: any) => x?.flight_ended === false || x?.flightEnded === false) ??
        pool.sort((a: any, b: any) => {
          const ta = parseUtcMs(toUtcIsoAssumeUtc(a?.datetime_landed ?? a?.datetimeLanded ?? a?.last_seen ?? a?.lastSeen ?? a?.scheduled_departure_utc) ?? null);
          const tb = parseUtcMs(toUtcIsoAssumeUtc(b?.datetime_landed ?? b?.datetimeLanded ?? b?.last_seen ?? b?.lastSeen ?? b?.scheduled_departure_utc) ?? null);
          return tb - ta;
        })[0];
      if (fr) {
        out.lookup_source = 'fr24';
        out.fr24_debug = {
          flight_ended: fr.flight_ended ?? fr.flightEnded,
          fr24_id: fr.fr24_id ?? fr.fr24Id,
          id: fr.id ?? undefined,
          scheduled_departure_utc: fr.scheduled_departure_utc ?? undefined,
          scheduled_departure: fr.scheduled_departure ?? undefined,
          scheduled_arrival_utc: fr.scheduled_arrival_utc ?? undefined,
          scheduled_arrival: fr.scheduled_arrival ?? undefined,
          estimated_departure_utc: fr.estimated_departure_utc ?? undefined,
          estimated_departure: fr.estimated_departure ?? undefined,
          estimated_arrival_utc: fr.estimated_arrival_utc ?? undefined,
          estimated_arrival: fr.estimated_arrival ?? undefined,
          estimated_landing_utc: fr.estimated_landing_utc ?? undefined,
          estimated_landing: fr.estimated_landing ?? undefined,
          datetime_takeoff: fr.datetime_takeoff ?? fr.datetimeTakeoff ?? undefined,
          first_seen: fr.first_seen ?? fr.firstSeen ?? undefined,
          datetime_landed: fr.datetime_landed ?? fr.datetimeLanded ?? undefined,
          last_seen: fr.last_seen ?? fr.lastSeen ?? undefined,
        };
        // Some FR responses (especially for older legs / summary endpoints) may miss scheduled_* fields.
        // To avoid falling back to "dash => semi_active" blindly, we use a best-effort schedule chain.
        out.scheduled_departure = toUtcIsoAssumeUtc(
          fr.scheduled_departure_utc ??
            fr.scheduled_departure ??
            fr.estimated_departure_utc ??
            fr.estimated_departure ??
            fr.datetime_takeoff ??
            fr.first_seen,
        );
        out.scheduled_arrival = toUtcIsoAssumeUtc(
          fr.scheduled_arrival_utc ??
            fr.scheduled_arrival ??
            fr.estimated_arrival_utc ??
            fr.estimated_arrival ??
            fr.estimated_landing_utc ??
            fr.estimated_landing ??
            fr.datetime_landed ??
            fr.last_seen,
        );
        out.fr24_progress_dep_utc = toUtcIsoAssumeUtc(fr.estimated_departure_utc ?? fr.estimated_departure);
        out.fr24_progress_eta_utc = toUtcIsoAssumeUtc(fr.estimated_arrival_utc ?? fr.estimated_arrival ?? fr.estimated_landing_utc ?? fr.estimated_landing);
        const landedIso = toUtcIsoAssumeUtc(fr.datetime_landed ?? fr.datetimeLanded);
        out.fr24_datetime_landed_utc = landedIso;
        const firstIso = toUtcIsoAssumeUtc(fr.first_seen ?? fr.firstSeen);
        const takeoffIso = toUtcIsoAssumeUtc(fr.datetime_takeoff ?? fr.datetimeTakeoff);
        const ended = fr.flight_ended === true || fr.flightEnded === true;
        if (firstIso || takeoffIso || landedIso) {
          out.flight_status = deriveFr24LiveStatus(nowMs, firstIso, takeoffIso, landedIso);
        } else if (ended) {
          out.flight_status = 'scheduled';
        }
      }
    } catch {}
  }

  if (AIRLABS_KEY) {
    for (const v of variants) {
      try {
        const isIcao = /^[A-Z]{3}\d+/.test(v);
        const alUrl = isIcao
          ? `https://airlabs.co/api/v9/flight?flight_icao=${encodeURIComponent(v)}&api_key=${encodeURIComponent(AIRLABS_KEY)}`
          : `https://airlabs.co/api/v9/flight?flight_iata=${encodeURIComponent(v)}&api_key=${encodeURIComponent(AIRLABS_KEY)}`;
        const alRes = await fetch(alUrl);
        const alJson = await alRes.json().catch(() => null);
        const f = alJson?.response;
        if (f && typeof f === 'object') {
          out.lookup_source = out.lookup_source ?? 'airlabs';
          out.origin_airport = (f.dep_iata ?? f.dep_icao ?? out.origin_airport ?? null) as string | null;
          out.destination_airport = (f.arr_iata ?? f.arr_icao ?? out.destination_airport ?? null) as string | null;
          out.origin_city = (f.dep_city ?? out.origin_city ?? null) as string | null;
          out.destination_city = (f.arr_city ?? out.destination_city ?? null) as string | null;
          out.scheduled_departure = out.scheduled_departure ?? toUtcIsoAssumeUtc(f.dep_time_utc ?? f.dep_time);
          out.scheduled_arrival = out.scheduled_arrival ?? toUtcIsoAssumeUtc(f.arr_time_utc ?? f.arr_time);
          out.delay_dep_min = Number.isFinite(Number(f.dep_delayed)) ? Number(f.dep_delayed) : null;
          out.delay_arr_min = Number.isFinite(Number(f.arr_delayed)) ? Number(f.arr_delayed) : null;
          out.airlabs_progress_percent = Number.isFinite(Number(f.percent)) ? Number(f.percent) : null;
          const st = String(f.status ?? '').toLowerCase();
          const mappedStatus =
            st === 'scheduled' ? 'scheduled'
            : (st === 'active' || st === 'en-route') ? 'en_route'
            : st === 'landed' ? 'landed'
            : (st === 'cancelled' || st === 'canceled') ? 'cancelled'
            : st === 'diverted' ? 'diverted'
            : null;
          if (mappedStatus) {
            if (!out.flight_status || (out.flight_status === 'landed' && mappedStatus === 'en_route')) {
              out.flight_status = mappedStatus;
            }
          }
          if (out.scheduled_departure || out.scheduled_arrival) break;
        }
      } catch {}
    }

    if (timetableNeedsAeroBackupScript(out)) {
      for (const v of variants.slice(0, 6)) {
        try {
          const urls = [
            `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(flightDate)}?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
            `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(flightDate)}T00:00?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
          ];
          let merged = false;
          for (const adbUrl of urls) {
            const adbRes = await fetch(adbUrl, {
              headers: {
                'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
                'x-rapidapi-key': AERODATABOX_RAPIDAPI_KEY,
              },
            });
            if (!adbRes.ok) continue;
            const adbJson = await adbRes.json().catch(() => null);
            const root = (Array.isArray(adbJson) ? adbJson[0] : adbJson) as Record<string, unknown> | null;
            if (!root || typeof root !== 'object') continue;
            const { dep, arr } = aeroRootLegsScript(root);
            const depSched = toUtcIsoAssumeUtc(
              aeroCoerceScript(dep.scheduledTimeUtc) ?? aeroCoerceScript(dep.scheduledTime) ?? aeroCoerceScript(dep.scheduledTimeLocal),
            );
            const arrSched = toUtcIsoAssumeUtc(
              aeroCoerceScript(arr.scheduledTimeUtc) ?? aeroCoerceScript(arr.scheduledTime) ?? aeroCoerceScript(arr.scheduledTimeLocal),
            );
            const depExp = toUtcIsoAssumeUtc(
              aeroCoerceScript(dep.predictedTimeUtc) ??
                aeroCoerceScript(dep.predictedTime) ??
                aeroCoerceScript(dep.estimatedTimeUtc) ??
                aeroCoerceScript(dep.estimatedTime),
            );
            const arrExp = toUtcIsoAssumeUtc(
              aeroCoerceScript(arr.predictedTimeUtc) ??
                aeroCoerceScript(arr.predictedTime) ??
                aeroCoerceScript(arr.estimatedTimeUtc) ??
                aeroCoerceScript(arr.estimatedTime),
            );
            const depIso = depSched ?? depExp;
            const arrIsoRaw = arrSched ?? arrExp;
            const arrIso = normalizeOvernightArrScript(depIso, arrIsoRaw);
            const depAp = dep.airport && typeof dep.airport === 'object' ? (dep.airport as Record<string, unknown>) : null;
            const arrAp = arr.airport && typeof arr.airport === 'object' ? (arr.airport as Record<string, unknown>) : null;
            const originAp =
              (typeof depAp?.iata === 'string' ? depAp.iata : typeof depAp?.icao === 'string' ? depAp.icao : null) ??
              (typeof dep.iata === 'string' ? dep.iata : typeof dep.icao === 'string' ? dep.icao : null);
            const destAp =
              (typeof arrAp?.iata === 'string' ? arrAp.iata : typeof arrAp?.icao === 'string' ? arrAp.icao : null) ??
              (typeof arr.iata === 'string' ? arr.iata : typeof arr.icao === 'string' ? arr.icao : null);
            const originCity =
              typeof depAp?.municipalityName === 'string' ? depAp.municipalityName : typeof depAp?.name === 'string' ? depAp.name : null;
            const destCity =
              typeof arrAp?.municipalityName === 'string' ? arrAp.municipalityName : typeof arrAp?.name === 'string' ? arrAp.name : null;
            if (!depIso && !arrIso && !originAp && !destAp) continue;
            out.lookup_source = out.lookup_source ? `${out.lookup_source}+aerodatabox` : 'aerodatabox';
            out.scheduled_departure = out.scheduled_departure ?? depIso;
            out.scheduled_arrival = out.scheduled_arrival ?? arrIso;
            out.origin_airport =
              out.origin_airport ?? (originAp ? String(originAp).trim().toUpperCase().slice(0, 4) : null);
            out.destination_airport =
              out.destination_airport ?? (destAp ? String(destAp).trim().toUpperCase().slice(0, 4) : null);
            out.origin_city = out.origin_city ?? originCity;
            out.destination_city = out.destination_city ?? destCity;
            merged = true;
            break;
          }
          if (merged) break;
        } catch {}
      }
    }
  }

  const depIsoParsed = toUtcIsoAssumeUtc(out.scheduled_departure ?? null);
  const arrIsoParsed = toUtcIsoAssumeUtc(out.scheduled_arrival ?? null);
  const hasValidSchedule = !!depIsoParsed && !!arrIsoParsed;
  const uncertain =
    !hasValidSchedule ||
    (String(out.flight_status ?? '').toLowerCase() === 'scheduled' &&
      Number.isFinite(new Date(depIsoParsed ?? '').getTime()) &&
      nowMs > new Date(depIsoParsed ?? '').getTime() + 15 * 60 * 1000);
  if (uncertain && AEROAPI_KEY) {
    for (const ident of variants.slice(0, 6)) {
      try {
        const start = new Date(`${flightDate}T00:00:00Z`).toISOString();
        const end = new Date(`${flightDate}T23:59:59Z`).toISOString();
        const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max_pages=1`;
        const res = await fetch(url, {
          headers: { 'x-apikey': AEROAPI_KEY, Accept: 'application/json' },
        });
        if (!res.ok) continue;
        const json = await res.json().catch(() => null) as Record<string, unknown> | null;
        if (!json || !Array.isArray(json.flights) || json.flights.length === 0) continue;
        const r = json.flights[0] as Record<string, unknown>;
        const scheduledOut = toUtcIsoAssumeUtc((r.scheduled_out as string | undefined) ?? null) ?? null;
        const estimatedOut = toUtcIsoAssumeUtc((r.estimated_out as string | undefined) ?? null) ?? null;
        const actualOut = toUtcIsoAssumeUtc((r.actual_out as string | undefined) ?? null) ?? null;
        const scheduledIn = toUtcIsoAssumeUtc((r.scheduled_in as string | undefined) ?? null) ?? null;
        const estimatedIn = toUtcIsoAssumeUtc((r.estimated_in as string | undefined) ?? null) ?? null;
        const actualIn = toUtcIsoAssumeUtc((r.actual_in as string | undefined) ?? null) ?? null;
        const dep = estimatedOut ?? scheduledOut;
        const arrRaw = estimatedIn ?? scheduledIn;
        const arr = normalizeOvernightArrScript(dep, arrRaw);
        if (!isDateNearby(dep ?? actualOut ?? scheduledOut, flightDate)) continue;
        out.lookup_source = out.lookup_source ? `${out.lookup_source}+aeroapi` : 'aeroapi';
        out.scheduled_departure = dep ?? out.scheduled_departure ?? null;
        out.scheduled_arrival = arr ?? out.scheduled_arrival ?? null;
        if (actualIn) out.flight_status = 'landed';
        else if (actualOut && String(out.flight_status ?? '').toLowerCase() === 'scheduled') out.flight_status = 'en_route';
        else {
          const st = String(r.status ?? '').toLowerCase();
          if (st.includes('divert')) out.flight_status = 'diverted';
          else if (st.includes('cancel')) out.flight_status = 'cancelled';
        }
        break;
      } catch {}
    }
  }

  if (!hasValidSchedule && AVIATIONSTACK_KEY) {
    for (const ident of variants.slice(0, 6)) {
      try {
        const isIcao = /^[A-Z]{3}\d+/.test(ident);
        const q = isIcao ? `flight_icao=${encodeURIComponent(ident)}` : `flight_iata=${encodeURIComponent(ident)}`;
        const url = `${AVIATIONSTACK_BASE}/flights?access_key=${encodeURIComponent(AVIATIONSTACK_KEY)}&${q}&limit=5`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json().catch(() => null) as Record<string, unknown> | null;
        const list = Array.isArray(json?.data) ? (json?.data as Record<string, unknown>[]) : [];
        if (!list.length) continue;
        const row = list[0];
        const depObj = (row.departure as Record<string, unknown> | undefined) ?? {};
        const arrObj = (row.arrival as Record<string, unknown> | undefined) ?? {};
        const scheduledOut = toUtcIsoAssumeUtc((depObj.scheduled as string | undefined) ?? null) ?? null;
        const estimatedOut = toUtcIsoAssumeUtc((depObj.estimated as string | undefined) ?? null) ?? null;
        const actualOut = toUtcIsoAssumeUtc((depObj.actual as string | undefined) ?? null) ?? null;
        const scheduledIn = toUtcIsoAssumeUtc((arrObj.scheduled as string | undefined) ?? null) ?? null;
        const estimatedIn = toUtcIsoAssumeUtc((arrObj.estimated as string | undefined) ?? null) ?? null;
        const actualIn = toUtcIsoAssumeUtc((arrObj.actual as string | undefined) ?? null) ?? null;
        const dep = estimatedOut ?? scheduledOut;
        const arrRaw = estimatedIn ?? scheduledIn;
        const arr = normalizeOvernightArrScript(dep, arrRaw);
        if (!isDateNearby(dep ?? actualOut ?? scheduledOut, flightDate)) continue;
        out.lookup_source = out.lookup_source ? `${out.lookup_source}+aviationstack` : 'aviationstack';
        out.scheduled_departure = dep ?? out.scheduled_departure ?? null;
        out.scheduled_arrival = arr ?? out.scheduled_arrival ?? null;
        if (actualIn) out.flight_status = 'landed';
        else if (actualOut && String(out.flight_status ?? '').toLowerCase() === 'scheduled') out.flight_status = 'en_route';
        break;
      } catch {}
    }
  }

  return out;
}

async function lookupFlightFromDb(flightNumber: string, flightDate: string): Promise<Partial<FlightCardInput>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return {};
  const variants = flightNumberVariants(flightNumber);
  try {
    const select =
      'flight_number,flight_date,origin_airport,destination_airport,origin_city,destination_city,scheduled_departure,scheduled_arrival,flight_status,delay_dep_min,delay_arr_min,fr24_progress_dep_utc,fr24_progress_eta_utc,fr24_datetime_landed_utc,airlabs_progress_percent,diverted_to';
    const params = new URLSearchParams({
      select,
      flight_date: `eq.${flightDate}`,
      flight_number: `in.(${variants.join(',')})`,
      order: 'updated_at.desc',
      limit: '1',
    });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/flights?${params.toString()}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const data = await res.json().catch(() => []);
    let row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      const params2 = new URLSearchParams({
        select,
        flight_number: `in.(${variants.join(',')})`,
        order: 'flight_date.desc',
        limit: '1',
      });
      const res2 = await fetch(`${SUPABASE_URL}/rest/v1/flights?${params2.toString()}`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      });
      const latest = await res2.json().catch(() => []);
      row = Array.isArray(latest) ? latest[0] : null;
    }
    if (!row) return {};
    const rowDate = (row.flight_date as string | null) ?? null;
    const sourceLabel = rowDate && rowDate !== flightDate ? `supabase_db_nearest(${rowDate})` : 'supabase_db';
    return {
      lookup_source: sourceLabel,
      flight_number: (row.flight_number as string) ?? flightNumber,
      origin_airport: (row.origin_airport as string | null) ?? null,
      destination_airport: (row.destination_airport as string | null) ?? null,
      origin_city: (row.origin_city as string | null) ?? null,
      destination_city: (row.destination_city as string | null) ?? null,
      scheduled_departure: (row.scheduled_departure as string | null) ?? null,
      scheduled_arrival: (row.scheduled_arrival as string | null) ?? null,
      flight_status: (row.flight_status as FlightStatus | null) ?? null,
      delay_dep_min: (row.delay_dep_min as number | null) ?? null,
      delay_arr_min: (row.delay_arr_min as number | null) ?? null,
      fr24_progress_dep_utc: (row.fr24_progress_dep_utc as string | null) ?? null,
      fr24_progress_eta_utc: (row.fr24_progress_eta_utc as string | null) ?? null,
      fr24_datetime_landed_utc: (row.fr24_datetime_landed_utc as string | null) ?? null,
      airlabs_progress_percent: (row.airlabs_progress_percent as number | null) ?? null,
      diverted_to: (row.diverted_to as string | null) ?? null,
    };
  } catch {
    return {};
  }
}

async function lookupFlightByIdFromDb(flightId: string): Promise<Partial<FlightCardInput>> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !flightId) return {};
  try {
    const params = new URLSearchParams({
      select:
        'id,flight_number,flight_date,origin_airport,destination_airport,origin_city,destination_city,scheduled_departure,scheduled_arrival,estimated_departure,actual_arrival,flight_status,delay_dep_min,delay_arr_min,fr24_progress_dep_utc,fr24_progress_eta_utc,fr24_datetime_landed_utc,airlabs_progress_percent,diverted_to,roster_entry_kind,phase_active_locked',
      id: `eq.${flightId}`,
      limit: '1',
    });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/flights?${params.toString()}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const arr = await res.json().catch(() => []);
    const data = Array.isArray(arr) ? arr[0] : null;
    if (!data) return {};
    return {
      id: (data.id as string) ?? flightId,
      lookup_source: 'supabase_db_id',
      flight_number: (data.flight_number as string) ?? '',
      flight_date: (data.flight_date as string) ?? '',
      roster_entry_kind: (data.roster_entry_kind as RosterEntryKind) ?? 'flight',
      origin_airport: (data.origin_airport as string | null) ?? null,
      destination_airport: (data.destination_airport as string | null) ?? null,
      origin_city: (data.origin_city as string | null) ?? null,
      destination_city: (data.destination_city as string | null) ?? null,
      scheduled_departure: (data.scheduled_departure as string | null) ?? null,
      scheduled_arrival: (data.scheduled_arrival as string | null) ?? null,
      estimated_departure: (data.estimated_departure as string | null) ?? null,
      actual_arrival: (data.actual_arrival as string | null) ?? null,
      flight_status: (data.flight_status as FlightStatus | null) ?? null,
      phase_active_locked: (data.phase_active_locked as boolean | null) ?? null,
      delay_dep_min: (data.delay_dep_min as number | null) ?? null,
      delay_arr_min: (data.delay_arr_min as number | null) ?? null,
      fr24_progress_dep_utc: (data.fr24_progress_dep_utc as string | null) ?? null,
      fr24_progress_eta_utc: (data.fr24_progress_eta_utc as string | null) ?? null,
      fr24_datetime_landed_utc: (data.fr24_datetime_landed_utc as string | null) ?? null,
      airlabs_progress_percent: (data.airlabs_progress_percent as number | null) ?? null,
      diverted_to: (data.diverted_to as string | null) ?? null,
    };
  } catch {
    return {};
  }
}

function normalizeStatus(raw: FlightStatus | null | undefined): Exclude<FlightStatus, 'parked'> {
  const allowed: FlightStatus[] = [
    'scheduled',
    'taxi_out',
    'departed',
    'en_route',
    'landed',
    'parked',
    'cancelled',
    'diverted',
    'incident',
    'redirected',
  ];
  if (!raw || !allowed.includes(raw)) return 'scheduled';
  return raw === 'parked' ? 'landed' : raw;
}

function statusLabel(status: Exclude<FlightStatus, 'parked'>, lang: 'tr' | 'en'): string {
  const tr: Record<Exclude<FlightStatus, 'parked'>, string> = {
    scheduled: 'Planlı',
    taxi_out: 'Taxi-Out',
    departed: 'Kalktı',
    en_route: 'En-Route',
    landed: 'İndi',
    cancelled: 'İptal',
    diverted: 'Divert',
    incident: 'Olay',
    redirected: 'Yönlendirildi',
  };
  const en: Record<Exclude<FlightStatus, 'parked'>, string> = {
    scheduled: 'Scheduled',
    taxi_out: 'Taxi-Out',
    departed: 'Departed',
    en_route: 'En-Route',
    landed: 'Landed',
    cancelled: 'Cancelled',
    diverted: 'Diverted',
    incident: 'Incident',
    redirected: 'Redirected',
  };
  return lang === 'tr' ? tr[status] : en[status];
}

function getProgress(
  f: FlightCardInput,
  nowMs: number,
  lang: 'tr' | 'en',
): FlightCardDecision['progress'] {
  if (f.roster_entry_kind === 'duty_off' || f.roster_entry_kind === 'sim') {
    return { ratio: null, percentText: null, source: null };
  }

  const landFr = parseUtcMs(f.fr24_datetime_landed_utc ?? null);
  if (landFr > 0) {
    return { ratio: 1, percentText: lang === 'tr' ? '%100' : '100%', source: 'fr24_estimated' };
  }

  const depFr = parseUtcMs(f.fr24_progress_dep_utc ?? null);
  const etaFr = parseUtcMs(f.fr24_progress_eta_utc ?? null);
  if (depFr > 0 && etaFr > 0 && etaFr > depFr) {
    const ratio = nowMs <= depFr ? 0 : nowMs >= etaFr ? 1 : Math.min(1, Math.max(0, (nowMs - depFr) / (etaFr - depFr)));
    const pct = Math.round(ratio * 100);
    return { ratio, percentText: lang === 'tr' ? `%${pct}` : `${pct}%`, source: 'fr24_estimated' };
  }

  const start = parseUtcMs(f.scheduled_departure ?? null);
  const end = parseUtcMs(f.scheduled_arrival ?? null);
  if (start > 0 && end > 0 && end > start) {
    const ratio = nowMs <= start ? 0 : nowMs >= end ? 1 : Math.min(1, Math.max(0, (nowMs - start) / (end - start)));
    const pct = Math.round(ratio * 100);
    return { ratio, percentText: lang === 'tr' ? `%${pct}` : `${pct}%`, source: 'scheduled' };
  }

  const ap = typeof f.airlabs_progress_percent === 'number' ? f.airlabs_progress_percent : null;
  if (ap != null && ap >= 0 && ap <= 100) {
    const ratio = Math.min(1, Math.max(0, ap / 100));
    return { ratio, percentText: lang === 'tr' ? `%${Math.round(ap)}` : `${Math.round(ap)}%`, source: 'airlabs_percent' };
  }

  return { ratio: null, percentText: null, source: null };
}

function getDelay(f: FlightCardInput, status: Exclude<FlightStatus, 'parked'>): { minutes: number | null; source: 'dep' | 'arr' | null } {
  const depDelay = typeof f.delay_dep_min === 'number' ? f.delay_dep_min : null;
  const arrDelay = typeof f.delay_arr_min === 'number' ? f.delay_arr_min : null;
  const depCached = typeof f.delay_cache_dep_min === 'number' ? f.delay_cache_dep_min : null;
  const arrCached = typeof f.delay_cache_arr_min === 'number' ? f.delay_cache_arr_min : null;

  if (status === 'scheduled') {
    if (depDelay && depDelay > 0) return { minutes: depDelay, source: 'dep' };
    if (depCached && depCached > 0) return { minutes: depCached, source: 'dep' };
    return { minutes: null, source: null };
  }
  // Landed: prefer ATA−STA over stale AirLabs/ETA delay_arr_min.
  if (status === 'landed') {
    const landMs = parseUtcMs(f.fr24_datetime_landed_utc ?? f.actual_arrival ?? null);
    const staMs = parseUtcMs(f.scheduled_arrival ?? null);
    if (landMs > 0 && staMs > 0) {
      const actualArrDelay = Math.round((landMs - staMs) / 60_000);
      return { minutes: actualArrDelay > 0 ? actualArrDelay : null, source: 'arr' };
    }
  }
  if (status === 'en_route' || status === 'departed' || status === 'taxi_out' || status === 'landed') {
    if (arrDelay && arrDelay > 0) return { minutes: arrDelay, source: 'arr' };
    if (arrCached && arrCached > 0) return { minutes: arrCached, source: 'arr' };
  }
  return { minutes: null, source: null };
}

function formatRouteLabel(code: string | null | undefined, city: string | null | undefined): string {
  const c = (city ?? '').trim();
  const k = (code ?? '').trim().toUpperCase();
  if (c && k) return `${c} (${k})`;
  if (c) return c;
  return k || '—';
}

export function decideFlightCard(input: FlightCardInput, options: DecisionOptions = {}): FlightCardDecision {
  const nowMs = options.nowIso ? new Date(options.nowIso).getTime() : Date.now();
  const lang: 'tr' | 'en' = options.language ?? 'tr';
  const kind: 'flight' | 'duty_off' | 'sim' = (input.roster_entry_kind as any) || 'flight';

  let status = normalizeStatus(input.flight_status);
  const phase = computeApiRefreshPhase({
    roster_entry_kind: kind,
    scheduled_departure: input.scheduled_departure ?? null,
    scheduled_arrival: input.scheduled_arrival ?? null,
    estimated_departure: input.estimated_departure ?? null,
    nowMs,
    roster_flight_date: input.flight_date,
    origin_airport: input.origin_airport,
    delay_dep_min: input.delay_dep_min,
    flight_status: input.flight_status ?? null,
    actual_arrival: input.actual_arrival ?? null,
    fr24_datetime_landed_utc: input.fr24_datetime_landed_utc ?? null,
    phase_active_locked: input.phase_active_locked,
  });

  const dbg = (options.debug ?? '').trim().toLowerCase();
  const showPhaseDebug = dbg.includes('phase');
  const depMs = parseUtcMs(input.scheduled_departure ?? null);
  const arrMsRaw = parseUtcMs(input.scheduled_arrival ?? null);
  const endMs = arrMsRaw > 0 ? arrMsRaw : depMs + MS_4H;
  const phaseDebug: PhaseDebug | undefined = showPhaseDebug
    ? {
        nowIso: options.nowIso ?? new Date(nowMs).toISOString(),
        scheduledDepUsed: input.scheduled_departure ?? null,
        scheduledArrUsed: input.scheduled_arrival ?? null,
        depMs,
        arrMs: arrMsRaw,
        endMs,
        phase,
      }
    : undefined;

  // Align with app UI safety rules:
  // - passive_future should never show taxi/en-route.
  // - semi_active should never show taxi_out (when FR leaks it).
  if (phase === 'passive_future' || phase === 'passive_upcoming') status = 'scheduled';
  if (phase === 'semi_active' && status === 'taxi_out') status = 'scheduled';
  const progress = getProgress(input, nowMs, lang);
  const delay = getDelay(input, status);

  return {
    kind,
    status,
    statusLabel: statusLabel(status, lang),
    statusIsError: status === 'cancelled' || status === 'diverted',
    phase,
    phaseDebug,
    progress,
    delayMinutes: delay.minutes,
    delaySource: delay.source,
    route: {
      depLabel: formatRouteLabel(input.origin_airport, input.origin_city),
      arrLabel: formatRouteLabel(input.destination_airport, input.destination_city),
    },
    times: {
      depIstanbul: formatFlightTimeInTimeZone(input.scheduled_departure ?? null, TZ_ISTANBUL),
      depKarachi: formatFlightTimeInTimeZone(input.scheduled_departure ?? null, TZ_KARACHI),
      depUtc: formatFlightTimeUtcLocal(input.scheduled_departure ?? null),
      arrIstanbul: formatFlightTimeInTimeZone(input.scheduled_arrival ?? null, TZ_ISTANBUL),
      arrKarachi: formatFlightTimeInTimeZone(input.scheduled_arrival ?? null, TZ_KARACHI),
      arrUtc: formatFlightTimeUtcLocal(input.scheduled_arrival ?? null),
    },
    flightNumberText: input.flight_number,
    divertedTo: input.diverted_to ?? null,
  };
}

if (require.main === module) {
  (async () => {
    const { input, options } = parseArgs();
    let mergedInput: FlightCardInput = { ...input };

    // Short mode: fetch with current flight lookup algorithm.
    const isShortMode =
      !input.scheduled_departure &&
      !input.scheduled_arrival &&
      !!input.flight_number &&
      !!input.flight_date;
    const isIdMode = !!input.id && !input.flight_number && !input.flight_date;

    if (isIdMode) {
      const byId = await lookupFlightByIdFromDb(input.id!);
      mergedInput = { ...mergedInput, ...byId };
    }

    if (isShortMode) {
      const nowMs = options.nowIso ? new Date(options.nowIso).getTime() : Date.now();
      const fetched = await lookupFlightFromApis(input.flight_number, input.flight_date, nowMs);
      mergedInput = { ...mergedInput, ...fetched };
      if (!mergedInput.scheduled_departure && !mergedInput.scheduled_arrival) {
        const db = await lookupFlightFromDb(input.flight_number, input.flight_date);
        mergedInput = { ...mergedInput, ...db };
      }

      // Rule: semi_active phase should use AirLabs API result, not FR leg status.
      const phase = computeApiRefreshPhase({
        roster_entry_kind: mergedInput.roster_entry_kind ?? 'flight',
        scheduled_departure: mergedInput.scheduled_departure ?? null,
        scheduled_arrival: mergedInput.scheduled_arrival ?? null,
        estimated_departure: mergedInput.estimated_departure ?? null,
        nowMs,
        roster_flight_date: mergedInput.flight_date,
        origin_airport: mergedInput.origin_airport,
        delay_dep_min: mergedInput.delay_dep_min,
        flight_status: mergedInput.flight_status ?? null,
        actual_arrival: mergedInput.actual_arrival ?? null,
        fr24_datetime_landed_utc: mergedInput.fr24_datetime_landed_utc ?? null,
        phase_active_locked: mergedInput.phase_active_locked,
      });
      if (phase === 'semi_active') {
        // Keep semi_active status conservative, but do NOT force source to AirLabs.
        // This allows AeroAPI/Aviationstack schedule fallback to survive final merge.
        mergedInput = {
          ...mergedInput,
          flight_status: mergedInput.flight_status ?? 'scheduled',
        };
      }
    }

    const out = decideFlightCard(mergedInput, options);
    printCardTable(mergedInput, out, options);
  })().catch((err) => {
    process.stderr.write(`Script error: ${String(err?.message ?? err)}\n`);
    process.exit(1);
  });
}
