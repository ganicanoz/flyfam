/**
 * Roster otomatik yenileme — Edge check-flight-status / rosterPollEdge ile aynı öncelik.
 * semi_active → hub tahta önbelleğinde kalkış+varış tam ise ücretli timetable istenmez; değilse ADB → AirLabs → AeroAPI
 * (ilk sağlıklı cevapta durur). FR24 yok.
 * active → FR24 (bacak seçimi); canlı değilse veya flight_ended ise timetable şelalesi; iptal/divert/actual* öncelikleri Edge ile uyumlu.
 */
import Constants from 'expo-constants';
import {
  applyFlightProviderCooldownFromResponse,
  FLIGHT_PROVIDER_AERODATABOX,
  FLIGHT_PROVIDER_AERODATABOX_ALT,
  FLIGHT_PROVIDER_AEROAPI,
  FLIGHT_PROVIDER_AIRLABS,
  FLIGHT_PROVIDER_FR24,
  isFlightProviderInCooldown,
} from './flightProviderCooldown';
import { mergeTimetableRowsPreferFirst, timetableRowIsSufficient } from './flightTimetableWaterfall';
import {
  fr24ScheduledFieldToUtcIso,
  utcIsoToLocalDateAtAirport,
  type FlightInfo,
  type FlightStatusApi,
} from './flightApi';
import { buildAerodataboxFlightNumberSources } from './aerodataboxHttp';
import { findAirportBoardCacheFlight } from './airportBoardCache';
import { supabase, SUPABASE_URL } from './supabase';

/** Admin: gerçek endpoint + yanıt özeti (anahtarlar logda gizli). */
export type FlightPollTraceEntry = {
  source: string;
  request: string;
  httpStatus?: number;
  outcome: string;
  lines: string[];
};

type PollProviderOptions = {
  ignoreCooldown?: boolean;
};

function pushTrace(trace: FlightPollTraceEntry[] | undefined, entry: FlightPollTraceEntry): void {
  if (trace) trace.push(entry);
}

function redactUrlQuerySecrets(url: string): string {
  return url
    .replace(/([?&])api_key=[^&]*/gi, '$1api_key=<REDACTED>')
    .replace(/([?&])access_key=[^&]*/gi, '$1access_key=<REDACTED>');
}

function summarizeFlightInfoForTrace(info: FlightInfo): string[] {
  return [
    `route: ${info.origin || '—'} → ${info.destination || '—'}`,
    `flightStatus: ${info.flightStatus ?? '—'}`,
    `scheduled_departure_utc: ${info.scheduled_departure_utc ?? '—'}`,
    `scheduled_arrival_utc: ${info.scheduled_arrival_utc ?? '—'}`,
    `actual_departure_utc: ${info.actual_departure_utc ?? '—'}`,
    `actual_arrival_utc: ${info.actual_arrival_utc ?? '—'}`,
    `flightEnded: ${String(info.flightEnded ?? '—')}`,
    `fr24Id: ${info.fr24Id ?? '—'}`,
    `delayed: ${String(info.delayed ?? '—')}`,
    `delayDepMin / delayArrMin: ${info.delayDepMin ?? '—'} / ${info.delayArrMin ?? '—'}`,
    `airlabsProgressPercent: ${info.airlabsProgressPercent ?? '—'}`,
  ];
}

const AIRLABS_BASE = 'https://airlabs.co/api/v9';
const AERODATABOX_BASE = 'https://aerodatabox.p.rapidapi.com';
const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
/** FR24 Flight Summary API — `light` varyantı (roster / admin debug). */
export const FR24_FLIGHT_SUMMARY_LIGHT_URL = 'https://fr24api.flightradar24.com/api/flight-summary/light';

const FR24_URL = FR24_FLIGHT_SUMMARY_LIGHT_URL;

const FR24_TOKEN =
  Constants.expoConfig?.extra?.flightradar24Token ?? process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
const AIRLABS_KEY =
  Constants.expoConfig?.extra?.airlabsKey ?? process.env.EXPO_PUBLIC_AIRLABS_API_KEY;
const AEROAPI_KEY =
  Constants.expoConfig?.extra?.aeroApiKey ??
  process.env.EXPO_PUBLIC_AEROAPI_API_KEY ??
  process.env.EXPO_PUBLIC_FLIGHTAWARE_AEROAPI_KEY;
const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS', '6E': 'IGO' };

function flightNumberVariants(flightNumber: string): string[] {
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const variants = [raw];
  const match = raw.match(/^([A-Z]{2})(\d+)$/);
  if (match) {
    const code = match[1];
    const num = match[2];
    if (num.length <= 3) variants.push(`${code}${num.padStart(4, '0')}`);
    if (num.length === 3) variants.push(`${code}0${num}`);
    if (num.length === 4 && num.startsWith('0')) variants.push(`${code}${num.slice(1)}`);
    const icao = IATA_TO_ICAO[code];
    if (icao) {
      variants.push(`${icao}${num}`);
      if (num.length <= 3) variants.push(`${icao}${num.padStart(4, '0')}`);
      if (num.length === 3) variants.push(`${icao}0${num}`);
    }
  }
  return [...new Set(variants)];
}

function toUtcIsoAssumeUtc(dt: string | null | undefined): string | undefined {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? `${s}:00.000Z` : `${s}Z`;
  }
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

interface Fr24Flight {
  scheduled_departure_utc?: string;
  scheduled_departure?: string;
  scheduled_arrival_utc?: string;
  scheduled_arrival?: string;
  // Some FR24 responses miss scheduled_* fields for older/summary legs.
  // We use estimated_* / takeoff / firstSeen as a best-effort schedule chain.
  estimated_departure_utc?: string;
  estimated_departure?: string;
  estimated_arrival_utc?: string;
  estimated_arrival?: string;
  estimated_landing_utc?: string;
  estimated_landing?: string;
  datetime_takeoff?: string;
  datetimeTakeoff?: string;
  first_seen?: string;
  firstSeen?: string;
  datetime_landed?: string;
  datetimeLanded?: string;
  last_seen?: string;
  lastSeen?: string;
  flight_ended?: boolean;
  flightEnded?: boolean;
  fr24_id?: string;
  fr24Id?: string;
  id?: string;
  reg?: string;
  registration?: string;
  orig_icao?: string;
  origin_icao?: string;
  orig_iata?: string;
  origin_iata?: string;
}

function fr24PickString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizeOvernightEta(depUtcIso: string | undefined, etaUtcIso: string | undefined): string | undefined {
  if (!depUtcIso || !etaUtcIso) return etaUtcIso;
  const depMs = new Date(depUtcIso).getTime();
  const etaMs = new Date(etaUtcIso).getTime();
  if (Number.isNaN(depMs) || Number.isNaN(etaMs)) return etaUtcIso;
  if (etaMs < depMs) return new Date(etaMs + 24 * 60 * 60 * 1000).toISOString();
  return etaUtcIso;
}

/**
 * Roster bar — FR adımı: yalnızca tahmini kalkış + tahmini varış çifti (estimated_*).
 * Planlı kart saatleri (scheduled_*) bu yüzden değiştirilmez; mermaid statü akışı dışına çıkılmaz.
 * iniş zamanı → çubuk %100; fr24Id.
 */
function fr24ProgressAnchorsFromFr24(f: Fr24Flight): Partial<FlightInfo> {
  const raw = f as unknown as Record<string, unknown>;
  const depRaw = fr24PickString(raw, [
    'estimated_departure_utc',
    'estimated_departure',
    'estimated_time_departure',
    'estimated_time_departure_utc',
    'etd',
    'etd_utc',
  ]);
  const arrRaw = fr24PickString(raw, [
    'estimated_landing',
    'estimated_landing_utc',
    'estimated_arrival',
    'estimated_arrival_utc',
    'eta',
    'eta_utc',
  ]);
  const depIso = depRaw ? toUtcIsoAssumeUtc(depRaw) : undefined;
  const arrIsoRaw = arrRaw ? toUtcIsoAssumeUtc(arrRaw) : undefined;
  const arrIso = normalizeOvernightEta(depIso, arrIsoRaw);
  const t0 = depIso ? new Date(depIso).getTime() : 0;
  const t1 = arrIso ? new Date(arrIso).getTime() : 0;
  const ended = f.flight_ended === true || f.flightEnded === true;
  const landRaw = f.datetime_landed ?? f.datetimeLanded;
  const landedIsoRaw = typeof landRaw === 'string' ? toUtcIsoAssumeUtc(landRaw) : undefined;
  // FR24 bazen datetime_landed boş döner; flight_ended=true iken last_seen'i landed fallback kabul et.
  const landedIso =
    landedIsoRaw ??
    (ended ? toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined) : undefined);
  const takeoffIso = toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined);
  const fr24Id = fr24PickString(raw, ['fr24_id', 'fr24Id']) ?? (typeof raw.id === 'string' ? raw.id.trim() : undefined);
  const out: Partial<FlightInfo> = {};
  if (takeoffIso) out.fr24_datetime_takeoff_utc = takeoffIso;
  if (depIso && arrIso && t1 > t0) {
    out.fr24_progress_dep_utc = depIso;
    out.fr24_progress_eta_utc = arrIso;
  }
  if (landedIso) out.fr24_datetime_landed_utc = landedIso;
  if (fr24Id) out.fr24Id = fr24Id;
  const reg = fr24PickString(raw, ['reg', 'registration', 'aircraft_registration', 'reg_number', 'reg_num', 'tail_number']);
  if (reg) out.aircraftRegistration = reg.toUpperCase();
  return out;
}

function airlabsNumField(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function airlabsProgressPercentParsed(o: Record<string, unknown>): number | null {
  let p = airlabsNumField(o, 'percent') ?? airlabsNumField(o, 'percentage');
  if (p == null) return null;
  if (p >= 0 && p <= 1) p = Math.round(p * 100);
  if (p < 0 || p > 100) return null;
  return Math.round(p);
}

function airlabsPollExtras(o: Record<string, unknown>): {
  delayDepMin: number | null;
  delayArrMin: number | null;
  progressPercent: number | null;
} {
  return {
    delayDepMin: airlabsNumField(o, 'dep_delayed'),
    delayArrMin: airlabsNumField(o, 'arr_delayed'),
    progressPercent: airlabsProgressPercentParsed(o),
  };
}

/** flightApi.fetchFromFlightradar24 ile aynı: crew flight_date = kalkış meydanı yerel takvim günü (UTC günü değil). */
function fr24LegMatchesRosterDate(f: Fr24Flight, rosterYmd: string): boolean {
  const raw = f as unknown as Record<string, unknown>;
  const origin = String(
    (raw.orig_icao ?? raw.origin_icao ?? raw.orig_iata ?? raw.origin_iata ?? '') as string,
  ).toUpperCase();
  const depRaw = (f.scheduled_departure_utc ?? f.scheduled_departure) as string | undefined;
  const depIso =
    (depRaw ? fr24ScheduledFieldToUtcIso(depRaw, origin, rosterYmd) : undefined) ??
    toUtcIsoAssumeUtc(f.datetime_takeoff ?? f.datetimeTakeoff) ??
    toUtcIsoAssumeUtc(f.first_seen ?? f.firstSeen);
  const localDay =
    utcIsoToLocalDateAtAirport(depIso, origin) ?? (depIso ? depIso.slice(0, 10) : '');
  return localDay === rosterYmd;
}

type DbLive = 'scheduled' | 'taxi_out' | 'en_route' | 'landed';

function deriveFr24LiveStatus(
  nowMs: number,
  firstSeenUtc: string | undefined,
  datetimeTakeoffUtc: string | undefined,
  datetimeLandedUtc: string | undefined,
): DbLive {
  const first = firstSeenUtc ? new Date(firstSeenUtc).getTime() : 0;
  const takeoff = datetimeTakeoffUtc ? new Date(datetimeTakeoffUtc).getTime() : 0;
  const landed = datetimeLandedUtc ? new Date(datetimeLandedUtc).getTime() : 0;
  if (first > 0 && nowMs < first) return 'scheduled';
  if (first > 0 && (takeoff === 0 || nowMs < takeoff)) return 'taxi_out';
  if (landed > 0 && nowMs >= landed) return 'landed';
  if (takeoff > 0 && (landed === 0 || nowMs < landed)) return 'en_route';
  if (first > 0 && nowMs >= first) return 'taxi_out';
  return 'scheduled';
}

function airlabsTimeToIsoUtc(obj: Record<string, unknown>, strKey: string, tsKey: string): string | null {
  const ts = obj[tsKey];
  if (typeof ts === 'number' && ts > 1e9) {
    return new Date(ts * 1000).toISOString();
  }
  const s = obj[strKey];
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(t)) {
    const d = new Date(`${t.replace(' ', 'T')}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return toUtcIsoAssumeUtc(t) ?? null;
}

function airlabsUtcStringOnly(o: Record<string, unknown>, key: string): string | null {
  const s = o[key];
  if (typeof s !== 'string' || !s.trim()) return null;
  return toUtcIsoAssumeUtc(s.trim()) ?? null;
}

/** AirLabs /flight: güncel tahmin (dep_estimated / arr_estimated) önce; sonra plan/bildirilen saat. */
function airlabsBestDepArrEstimated(o: Record<string, unknown>): { dep: string | null; arr: string | null } {
  const dep =
    airlabsUtcStringOnly(o, 'dep_estimated_utc') ??
    airlabsTimeToIsoUtc(o, 'dep_estimated', 'dep_estimated_ts') ??
    airlabsUtcStringOnly(o, 'dep_time_utc') ??
    airlabsTimeToIsoUtc(o, 'dep_time', 'dep_time_ts') ??
    airlabsTimeToIsoUtc(o, 'dep_scheduled', 'dep_scheduled_ts');
  const arr =
    airlabsUtcStringOnly(o, 'arr_estimated_utc') ??
    airlabsTimeToIsoUtc(o, 'arr_estimated', 'arr_estimated_ts') ??
    airlabsUtcStringOnly(o, 'arr_time_utc') ??
    airlabsTimeToIsoUtc(o, 'arr_time', 'arr_time_ts') ??
    airlabsTimeToIsoUtc(o, 'arr_scheduled', 'arr_scheduled_ts');
  const depN = dep ?? null;
  const arrN = arr ?? null;
  const arrAdj =
    depN && arrN
      ? (normalizeOvernightEta(depN, arrN) ?? arrN)
      : arrN;
  return { dep: depN, arr: arrAdj };
}

function airlabsDivertAirport(o: Record<string, unknown>): string | null {
  const a = o.arr_iata ?? o.arrIata;
  const b = o.arr_icao ?? o.arrIcao;
  const v = (typeof a === 'string' && a.trim()) ? a.trim() : (typeof b === 'string' && b.trim()) ? b.trim() : '';
  return v ? v.toUpperCase().slice(0, 4) : null;
}

function firstDefinedString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function calcDelayMinutes(estimatedIso: string | null | undefined, scheduledIso: string | null | undefined): number | null {
  if (!estimatedIso || !scheduledIso) return null;
  const est = new Date(estimatedIso).getTime();
  const sch = new Date(scheduledIso).getTime();
  if (!Number.isFinite(est) || !Number.isFinite(sch)) return null;
  return Math.round((est - sch) / 60000);
}

function aeroCoerceTimeString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.utc === 'string' && o.utc.trim()) return o.utc.trim();
    if (typeof o.local === 'string' && o.local.trim()) return o.local.trim();
  }
  return null;
}

function aeroRootLegs(root: Record<string, unknown>): { dep: Record<string, unknown>; arr: Record<string, unknown> } {
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

function aeroLegAirportCode(leg: Record<string, unknown>): string | null {
  const ap = leg.airport;
  if (ap && typeof ap === 'object') {
    const a = ap as Record<string, unknown>;
    const iata = typeof a.iata === 'string' ? a.iata.trim().toUpperCase() : '';
    const icao = typeof a.icao === 'string' ? a.icao.trim().toUpperCase() : '';
    const code = (iata || icao || '').slice(0, 4);
    return code || null;
  }
  const flat = firstDefinedString(leg.iata, leg.icao)?.toUpperCase() ?? null;
  return flat ? flat.slice(0, 4) : null;
}

type PollTimetableRow = {
  scheduledDep: string | null;
  scheduledArr: string | null;
  status: string | null;
  divertedTo: string | null;
  delayDepMin: number | null;
  delayArrMin: number | null;
  progressPercent: number | null;
  aircraftRegistration?: string | null;
  actualOut?: string | null;
  actualIn?: string | null;
};

function flightInfoToPollTimetableRow(info: FlightInfo): PollTimetableRow {
  const fs = info.flightStatus;
  const statusStr = fs ? String(fs).toLowerCase() : null;
  return {
    scheduledDep: info.scheduled_departure_utc ?? null,
    scheduledArr: info.scheduled_arrival_utc ?? null,
    status: statusStr,
    divertedTo: info.divertedTo ?? null,
    delayDepMin: info.delayDepMin ?? null,
    delayArrMin: info.delayArrMin ?? null,
    progressPercent: info.airlabsProgressPercent ?? null,
  };
}

/** Öncelik mevcut merged; boş alanları hub tahta önbelleğinden doldur. */
function mergePollWithBoardCache(merged: PollTimetableRow | null, board: PollTimetableRow): PollTimetableRow {
  if (!merged) return board;
  return {
    scheduledDep: merged.scheduledDep ?? board.scheduledDep,
    scheduledArr: merged.scheduledArr ?? board.scheduledArr,
    status: merged.status ?? board.status,
    divertedTo: merged.divertedTo ?? board.divertedTo,
    delayDepMin: merged.delayDepMin ?? board.delayDepMin,
    delayArrMin: merged.delayArrMin ?? board.delayArrMin,
    progressPercent: merged.progressPercent ?? board.progressPercent,
    actualOut: merged.actualOut ?? board.actualOut,
    actualIn: merged.actualIn ?? board.actualIn,
  };
}

async function fetchAeroDataBoxFlight(
  flightNumber: string,
  flightDate: string,
  trace?: FlightPollTraceEntry[],
  options?: PollProviderOptions,
): Promise<PollTimetableRow | null> {
  const variants = flightNumberVariants(flightNumber).slice(0, 6);
  const sources = buildAerodataboxFlightNumberSources(variants, flightDate);

  for (const src of sources) {
    if (!options?.ignoreCooldown && await isFlightProviderInCooldown(src.cooldownKey)) {
      pushTrace(trace, {
        source: src.label,
        request: 'GET /flights/number/…',
        outcome: 'skipped',
        lines: ['provider cooldown'],
      });
      continue;
    }
    for (const url of src.urls) {
      const reqLine = `GET ${url}`;
      try {
        const res = await fetch(url, { headers: src.headers });
      if (res.status === 429) {
        await applyFlightProviderCooldownFromResponse(src.cooldownKey, res);
        pushTrace(trace, {
          source: src.label,
          request: reqLine,
          httpStatus: res.status,
          outcome: 'rate_limited',
          lines: [],
        });
        continue;
      }
      if (!res.ok) {
        pushTrace(trace, {
          source: src.label,
          request: reqLine,
          httpStatus: res.status,
          outcome: 'http_error',
          lines: [],
        });
        continue;
      }
      const json = await res.json().catch(() => null);
      const root = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
      if (!root || typeof root !== 'object') {
        pushTrace(trace, {
          source: src.label,
          request: reqLine,
          httpStatus: res.status,
          outcome: 'empty_body',
          lines: [],
        });
        continue;
      }
      const { dep, arr } = aeroRootLegs(root);
      const depSched =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(dep.scheduledTimeUtc) ?? aeroCoerceTimeString(dep.scheduledTime) ?? aeroCoerceTimeString(dep.scheduledTimeLocal) ?? undefined,
        ) ?? null;
      const arrSched =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(arr.scheduledTimeUtc) ?? aeroCoerceTimeString(arr.scheduledTime) ?? aeroCoerceTimeString(arr.scheduledTimeLocal) ?? undefined,
        ) ?? null;
      const depExp =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(dep.predictedTimeUtc) ??
            aeroCoerceTimeString(dep.predictedTime) ??
            aeroCoerceTimeString(dep.estimatedTimeUtc) ??
            aeroCoerceTimeString(dep.estimatedTime) ??
            undefined,
        ) ?? null;
      const arrExp =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(arr.predictedTimeUtc) ??
            aeroCoerceTimeString(arr.predictedTime) ??
            aeroCoerceTimeString(arr.estimatedTimeUtc) ??
            aeroCoerceTimeString(arr.estimatedTime) ??
            undefined,
        ) ?? null;
      const depIso = depSched ?? depExp;
      const arrIso = arrSched ?? arrExp;
      if (!depIso && !arrIso) {
        pushTrace(trace, {
          source: src.label,
          request: reqLine,
          httpStatus: res.status,
          outcome: 'no_times',
          lines: [],
        });
        continue;
      }
      const status = firstDefinedString((root.status as Record<string, unknown> | undefined)?.text, root.status)?.toLowerCase() ?? null;
      const divertedTo = status?.includes('divert') ? aeroLegAirportCode(arr) : null;
      pushTrace(trace, {
        source: src.label,
        request: reqLine,
        httpStatus: res.status,
        outcome: 'ok',
        lines: [
          `scheduledDep: ${depIso ?? '—'}`,
          `scheduledArr: ${arrIso ?? '—'}`,
          `status: ${status ?? '—'}`,
          `divertedTo: ${divertedTo ?? '—'}`,
        ],
      });
      return { scheduledDep: depIso, scheduledArr: arrIso, status, divertedTo, delayDepMin: null, delayArrMin: null, progressPercent: null };
      } catch (e) {
        pushTrace(trace, {
          source: src.label,
          request: reqLine,
          outcome: 'error',
          lines: [e instanceof Error ? e.message : String(e)],
        });
        continue;
      }
    }
  }
  return null;
}

async function fetchAirLabsFlight(
  flightNumber: string,
  flightDate: string,
  trace?: FlightPollTraceEntry[],
  options?: PollProviderOptions,
): Promise<PollTimetableRow | null> {
  if (!AIRLABS_KEY) {
    pushTrace(trace, {
      source: 'AirLabs',
      request: `${AIRLABS_BASE}/flight`,
      outcome: 'skipped',
      lines: ['EXPO_PUBLIC_AIRLABS_API_KEY yok'],
    });
    return null;
  }
  if (!options?.ignoreCooldown && await isFlightProviderInCooldown(FLIGHT_PROVIDER_AIRLABS)) {
    pushTrace(trace, {
      source: 'AirLabs',
      request: `${AIRLABS_BASE}/flight`,
      outcome: 'skipped',
      lines: ['provider cooldown'],
    });
    return null;
  }
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const match = raw.match(/^([A-Z]{2,3})(\d+)$/);
  const flightIata = match ? `${match[1]}${match[2]}` : raw;
  const icaoVars = flightNumberVariants(flightNumber).filter((v) => v.length >= 5 && /^[A-Z]{3}\d+/.test(v));
  const urls: string[] = [
    `${AIRLABS_BASE}/flight?api_key=${encodeURIComponent(AIRLABS_KEY)}&flight_iata=${encodeURIComponent(flightIata)}`,
  ];
  for (const icaoNum of icaoVars.slice(0, 2)) {
    urls.push(`${AIRLABS_BASE}/flight?api_key=${encodeURIComponent(AIRLABS_KEY)}&flight_icao=${encodeURIComponent(icaoNum)}`);
  }
  for (const url of urls) {
    const displayUrl = redactUrlQuerySecrets(url);
    const reqLine = `GET ${displayUrl}`;
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await applyFlightProviderCooldownFromResponse(FLIGHT_PROVIDER_AIRLABS, res);
        pushTrace(trace, {
          source: 'AirLabs',
          request: reqLine,
          httpStatus: res.status,
          outcome: 'rate_limited',
          lines: [],
        });
        break;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) {
        pushTrace(trace, {
          source: 'AirLabs',
          request: reqLine,
          httpStatus: res.status,
          outcome: json?.error ? 'api_error' : 'http_error',
          lines: json?.error ? [JSON.stringify(json.error)] : [],
        });
        continue;
      }
      const fr = json?.response;
      if (!fr || typeof fr !== 'object') {
        pushTrace(trace, {
          source: 'AirLabs',
          request: reqLine,
          httpStatus: res.status,
          outcome: 'empty_response',
          lines: [],
        });
        continue;
      }
      const o = fr as Record<string, unknown>;
      const { dep: depIso, arr: arrIso } = airlabsBestDepArrEstimated(o);
      const depDay = depIso ? depIso.slice(0, 10) : '';
      if (depDay && depDay !== flightDate) {
        const y = parseInt(flightDate.slice(0, 4), 10);
        const m = parseInt(flightDate.slice(5, 7), 10) - 1;
        const d = parseInt(flightDate.slice(8, 10), 10);
        const prev = new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10);
        const next = new Date(Date.UTC(y, m, d + 1)).toISOString().slice(0, 10);
        if (depDay !== prev && depDay !== next) {
          pushTrace(trace, {
            source: 'AirLabs',
            request: reqLine,
            httpStatus: res.status,
            outcome: 'date_mismatch',
            lines: [`response dep day ${depDay} ≠ roster ${flightDate}`],
          });
          continue;
        }
      }
      const st = typeof o.status === 'string' ? o.status : null;
      const sl = st?.toLowerCase();
      const divertedTo = sl === 'diverted' ? airlabsDivertAirport(o) : null;
      const { delayDepMin, delayArrMin, progressPercent } = airlabsPollExtras(o);
      const regRaw = o.reg_number ?? o.reg_num;
      const aircraftRegistration =
        typeof regRaw === 'string' && regRaw.trim() ? regRaw.trim().toUpperCase() : null;
      if (
        !depIso && !arrIso && !st && delayDepMin == null && delayArrMin == null && progressPercent == null &&
        !aircraftRegistration
      ) {
        pushTrace(trace, {
          source: 'AirLabs',
          request: reqLine,
          httpStatus: res.status,
          outcome: 'no_usable_fields',
          lines: [],
        });
        continue;
      }
      pushTrace(trace, {
        source: 'AirLabs',
        request: reqLine,
        httpStatus: res.status,
        outcome: 'ok',
        lines: [
          `status: ${st ?? '—'}`,
          `scheduledDep: ${depIso ?? '—'}`,
          `scheduledArr: ${arrIso ?? '—'}`,
          `delayDepMin / delayArrMin: ${delayDepMin ?? '—'} / ${delayArrMin ?? '—'}`,
          `progressPercent: ${progressPercent ?? '—'}`,
          `divertedTo: ${divertedTo ?? '—'}`,
          `reg: ${aircraftRegistration ?? '—'}`,
        ],
      });
      return {
        scheduledDep: depIso,
        scheduledArr: arrIso,
        status: st,
        divertedTo,
        delayDepMin,
        delayArrMin,
        progressPercent,
        aircraftRegistration,
        actualOut: null,
        actualIn: null,
      };
    } catch (e) {
      pushTrace(trace, {
        source: 'AirLabs',
        request: reqLine,
        outcome: 'error',
        lines: [e instanceof Error ? e.message : String(e)],
      });
      continue;
    }
  }
  return null;
}

function isDateNearby(iso: string | null, flightDate: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  if (d === flightDate) return true;
  const y = Number(flightDate.slice(0, 4));
  const m = Number(flightDate.slice(5, 7)) - 1;
  const day = Number(flightDate.slice(8, 10));
  const prev = new Date(Date.UTC(y, m, day - 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(y, m, day + 1)).toISOString().slice(0, 10);
  return d === prev || d === next;
}

function isActualInReliableForCurrentLeg(args: {
  actualInUtc?: string | null;
  actualOutUtc?: string | null;
  scheduledDepUtc?: string | null;
  scheduledArrUtc?: string | null;
  nowMs: number;
}): boolean {
  const inIso = toUtcIsoAssumeUtc(args.actualInUtc ?? null);
  if (!inIso) return false;
  const inMs = new Date(inIso).getTime();
  if (!Number.isFinite(inMs)) return false;
  if (inMs > args.nowMs + 30 * 60 * 1000) return false;

  const outIso = toUtcIsoAssumeUtc(args.actualOutUtc ?? null);
  const outMs = outIso ? new Date(outIso).getTime() : NaN;
  if (Number.isFinite(outMs) && inMs < outMs - 5 * 60 * 1000) return false;

  const stdIso = toUtcIsoAssumeUtc(args.scheduledDepUtc ?? null);
  const stdMs = stdIso ? new Date(stdIso).getTime() : NaN;
  if (Number.isFinite(stdMs) && inMs < stdMs - 90 * 60 * 1000) return false;

  const staIso = toUtcIsoAssumeUtc(args.scheduledArrUtc ?? null);
  const staMs = staIso ? new Date(staIso).getTime() : NaN;
  if (Number.isFinite(staMs) && inMs < staMs - 24 * 60 * 60 * 1000) return false;

  return true;
}

async function fetchAeroApiFlight(
  flightNumber: string,
  flightDate: string,
  trace?: FlightPollTraceEntry[],
  options?: PollProviderOptions,
): Promise<PollTimetableRow | null> {
  if (!AEROAPI_KEY) {
    pushTrace(trace, {
      source: 'FlightAware AeroAPI',
      request: `${AEROAPI_BASE}/flights/{ident}`,
      outcome: 'skipped',
      lines: ['AeroAPI key yok'],
    });
    return null;
  }
  if (!options?.ignoreCooldown && await isFlightProviderInCooldown(FLIGHT_PROVIDER_AEROAPI)) {
    pushTrace(trace, {
      source: 'FlightAware AeroAPI',
      request: `${AEROAPI_BASE}/flights/{ident}`,
      outcome: 'skipped',
      lines: ['provider cooldown'],
    });
    return null;
  }
  const variants = flightNumberVariants(flightNumber).slice(0, 6);
  const start = new Date(`${flightDate}T00:00:00Z`).toISOString();
  const end = new Date(`${flightDate}T23:59:59Z`).toISOString();
  for (const ident of variants) {
    const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max_pages=1`;
    const reqLine = `GET ${url}\nx-apikey: <REDACTED>`;
    try {
      const res = await fetch(url, {
        headers: { 'x-apikey': AEROAPI_KEY, Accept: 'application/json' },
      });
      if (res.status === 429) {
        await applyFlightProviderCooldownFromResponse(FLIGHT_PROVIDER_AEROAPI, res);
        pushTrace(trace, {
          source: 'FlightAware AeroAPI',
          request: reqLine,
          httpStatus: res.status,
          outcome: 'rate_limited',
          lines: [],
        });
        continue;
      }
      if (!res.ok) {
        pushTrace(trace, {
          source: 'FlightAware AeroAPI',
          request: reqLine,
          httpStatus: res.status,
          outcome: 'http_error',
          lines: [],
        });
        continue;
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json || !Array.isArray(json.flights) || json.flights.length === 0) {
        pushTrace(trace, {
          source: 'FlightAware AeroAPI',
          request: reqLine,
          httpStatus: res.status,
          outcome: 'no_flights_array',
          lines: [],
        });
        continue;
      }
      const r = json.flights[0] as Record<string, unknown>;
      const scheduledOut = toUtcIsoAssumeUtc((r.scheduled_out as string | undefined) ?? null) ?? null;
      const estimatedOut = toUtcIsoAssumeUtc((r.estimated_out as string | undefined) ?? null) ?? null;
      const actualOut = toUtcIsoAssumeUtc((r.actual_out as string | undefined) ?? null) ?? null;
      const scheduledIn = toUtcIsoAssumeUtc((r.scheduled_in as string | undefined) ?? null) ?? null;
      const estimatedIn = toUtcIsoAssumeUtc((r.estimated_in as string | undefined) ?? null) ?? null;
      const actualIn = toUtcIsoAssumeUtc((r.actual_in as string | undefined) ?? null) ?? null;
      const dep = estimatedOut ?? scheduledOut;
      const arrRaw = estimatedIn ?? scheduledIn;
      const arr = dep && arrRaw ? (normalizeOvernightEta(dep, arrRaw) ?? arrRaw) : arrRaw;
      if (!isDateNearby(dep ?? actualOut ?? scheduledOut, flightDate)) {
        pushTrace(trace, {
          source: 'FlightAware AeroAPI',
          request: reqLine,
          httpStatus: res.status,
          outcome: 'date_mismatch',
          lines: [],
        });
        continue;
      }
      const status = typeof r.status === 'string' ? r.status.toLowerCase() : null;
      pushTrace(trace, {
        source: 'FlightAware AeroAPI',
        request: reqLine,
        httpStatus: res.status,
        outcome: 'ok',
        lines: [
          `ident: ${ident}`,
          `status: ${status ?? '—'}`,
          `scheduledDep / scheduledArr: ${dep ?? '—'} / ${arr ?? '—'}`,
          `actualOut / actualIn: ${actualOut ?? '—'} / ${actualIn ?? '—'}`,
        ],
      });
      return {
        scheduledDep: dep,
        scheduledArr: arr,
        status,
        divertedTo: status?.includes('divert') ? (firstDefinedString(r.diverted_airport) ?? null) : null,
        delayDepMin: calcDelayMinutes(dep, scheduledOut),
        delayArrMin: calcDelayMinutes(arr, scheduledIn),
        progressPercent: null,
        actualOut,
        actualIn,
      };
    } catch (e) {
      pushTrace(trace, {
        source: 'FlightAware AeroAPI',
        request: reqLine,
        outcome: 'error',
        lines: [e instanceof Error ? e.message : String(e)],
      });
      continue;
    }
  }
  return null;
}

async function fetchTimetableWaterfallLocal(
  flightNumber: string,
  flightDate: string,
  trace?: FlightPollTraceEntry[],
  options?: PollProviderOptions,
): Promise<PollTimetableRow | null> {
  const adb = await fetchAeroDataBoxFlight(flightNumber, flightDate, trace, options);
  if (timetableRowIsSufficient(adb)) return adb;
  const al = await fetchAirLabsFlight(flightNumber, flightDate, trace, options);
  if (timetableRowIsSufficient(al)) return al as PollTimetableRow;
  const aero = await fetchAeroApiFlight(flightNumber, flightDate, trace, options);
  if (timetableRowIsSufficient(aero)) return aero;
  const m1 = mergeTimetableRowsPreferFirst(adb, al) as PollTimetableRow | null;
  return mergeTimetableRowsPreferFirst(m1, aero) as PollTimetableRow;
}

/** semi_active: tam hub tahta önbelleği varsa ücretli çağrı yok; yoksa ADB → AL → Aero şelalesi. */
async function fetchSemiTimetableWithBoardCache(
  flightNumber: string,
  flightDate: string,
  trace?: FlightPollTraceEntry[],
  options?: PollProviderOptions,
): Promise<PollTimetableRow | null> {
  let merged: PollTimetableRow | null = null;
  const boardCache = await findAirportBoardCacheFlight(flightNumber, flightDate);
  if (boardCache?.scheduled_departure_utc && boardCache?.scheduled_arrival_utc) {
    merged = flightInfoToPollTimetableRow(boardCache);
    pushTrace(trace, {
      source: 'AeroDataBox — hub board cache (client)',
      request: 'findAirportBoardCacheFlight → AsyncStorage flyfam_airport_board_cache_v2',
      outcome: 'ok',
      lines: [
        `scheduled_departure_utc: ${boardCache.scheduled_departure_utc ?? '—'}`,
        `scheduled_arrival_utc: ${boardCache.scheduled_arrival_utc ?? '—'}`,
      ],
    });
  }
  if (!merged) {
    merged = await fetchTimetableWaterfallLocal(flightNumber, flightDate, trace, options);
    if (
      boardCache &&
      merged &&
      (!merged.scheduledDep || !merged.scheduledArr) &&
      (boardCache.scheduled_departure_utc || boardCache.scheduled_arrival_utc)
    ) {
      merged = mergePollWithBoardCache(merged, flightInfoToPollTimetableRow(boardCache));
    }
  }
  return merged;
}

function mapAirLabsStatus(s: string | undefined): FlightStatusApi | undefined {
  if (!s) return undefined;
  const x = s.toLowerCase().replace(/_/g, '-');
  if (x === 'scheduled') return 'scheduled';
  if (x === 'active' || x === 'en-route') return 'en_route';
  if (x === 'landed') return 'landed';
  return undefined;
}

function fr24RequestDocLines(
  fullUrl: string,
  fromIso19: string,
  toIso19: string,
  flightsCsv: string,
): string[] {
  return [
    '── FR24 Flight Summary (light) ──',
    `Endpoint: GET ${FR24_URL}`,
    `Tam URL:\n${fullUrl}`,
    `Param · flight_datetime_from: ${fromIso19} (UTC)`,
    `Param · flight_datetime_to: ${toIso19} (UTC)`,
    `Param · flights: ${flightsCsv}`,
    'Param · limit: 20',
    'Headers: Authorization: Bearer <REDACTED> · Accept: application/json · Accept-Version: v1',
  ];
}

function fr24JsonErrorLines(json: unknown): string[] {
  if (json == null) return [];
  try {
    const s = JSON.stringify(json);
    if (s.length <= 3500) return [`response_body: ${s}`];
    return [`response_body (truncated): ${s.slice(0, 3500)}…`];
  } catch {
    return [];
  }
}

/** Seçilen bacaktaki tüm düz alanlar + ham JSON (admin). */
function fr24PickedLegVerboseLines(picked: Fr24Flight): string[] {
  const pr = picked as unknown as Record<string, unknown>;
  const keys = Object.keys(pr)
    .filter((k) => k !== '__proto__')
    .sort();
  const flat: string[] = ['── Bacak alanları (düz) ──'];
  for (const k of keys) {
    const v = pr[k];
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      flat.push(`${k}: ${String(v)}`);
    } else if (Array.isArray(v)) {
      flat.push(`${k}: [array n=${v.length}]`);
    } else if (t === 'object') {
      try {
        flat.push(`${k}: ${JSON.stringify(v).slice(0, 240)}`);
      } catch {
        flat.push(`${k}: {object}`);
      }
    }
    if (flat.length > 72) break;
  }
  let jsonBlock = '';
  try {
    jsonBlock = JSON.stringify(picked, null, 2);
  } catch {
    jsonBlock = '';
  }
  if (jsonBlock) {
    flat.push('── Bacak (ham JSON) ──');
    flat.push(jsonBlock.length > 12000 ? `${jsonBlock.slice(0, 12000)}\n… [truncated]` : jsonBlock);
  }
  return flat;
}

/**
 * Admin ekranı: ana poll’dan bağımsız olarak FR24 light endpoint’ine bir kez daha gidip
 * tam URL + yanıt özeti üretir (Edge yalnızca flight-lookup döndüyse FR24 izi görünsün diye).
 */
export async function fetchFr24LightForAdminDebug(
  flightNumber: string,
  flightDateYmd: string,
): Promise<{ trace: FlightPollTraceEntry[] }> {
  const trace: FlightPollTraceEntry[] = [];
  const token = (FR24_TOKEN ?? '').trim();
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(',');
  const ymd = flightDateYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const y = ymd ? Number(ymd[1]) : NaN;
  const m = ymd ? Number(ymd[2]) : NaN;
  const d = ymd ? Number(ymd[3]) : NaN;
  const fromDate = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
    ? new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0))
    : new Date(NaN);
  const toDate = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
    ? new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59))
    : new Date(NaN);
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);
  const exampleUrl = Number.isFinite(fromDate.getTime())
    ? `${FR24_URL}?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`
    : `${FR24_URL}?flight_datetime_from=<from>&flight_datetime_to=<to>&flights=<variants>&limit=20`;

  if (!token) {
    pushTrace(trace, {
      source: 'Flightradar24 (admin · doğrudan)',
      request: [
        `GET ${exampleUrl}`,
        'Authorization: Bearer <YOK — EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN veya expo.extra.flightradar24Token>',
        'Accept: application/json',
        'Accept-Version: v1',
      ].join('\n'),
      outcome: 'no_token',
      lines: fr24RequestDocLines(exampleUrl, from || '<from>', to || '<to>', flightsParam || '<variants>'),
    });
    return { trace };
  }
  await selectFr24Flight(flightNumber, flightDateYmd, token, trace, { adminDirectLabel: true });
  return { trace };
}

async function selectFr24Flight(
  flightNumber: string,
  date: string,
  token: string,
  trace?: FlightPollTraceEntry[],
  opts?: { adminDirectLabel?: boolean; ignoreCooldown?: boolean },
): Promise<Fr24Flight | null> {
  const src = opts?.adminDirectLabel ? 'Flightradar24 (admin · doğrudan)' : 'Flightradar24';
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(',');
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m! - 1, d! - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m! - 1, d! + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);
  const url = `${FR24_URL}?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  const reqLine = `GET ${url}\nAuthorization: Bearer <REDACTED>\nAccept: application/json\nAccept-Version: v1`;
  const docBlock = () => fr24RequestDocLines(url, from, to, flightsParam);

  if (!opts?.ignoreCooldown && await isFlightProviderInCooldown(FLIGHT_PROVIDER_FR24)) {
    pushTrace(trace, {
      source: src,
      request: reqLine,
      outcome: 'skipped',
      lines: [...docBlock(), 'reason: provider cooldown'],
    });
    return null;
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Version': 'v1',
    },
  });
  if (res.status === 429) {
    await applyFlightProviderCooldownFromResponse(FLIGHT_PROVIDER_FR24, res);
    pushTrace(trace, {
      source: src,
      request: reqLine,
      httpStatus: res.status,
      outcome: 'rate_limited',
      lines: [...docBlock(), 'reason: HTTP 429'],
    });
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data || !Array.isArray(json.data) || json.data.length === 0) {
    const extra = !res.ok ? fr24JsonErrorLines(json) : [];
    pushTrace(trace, {
      source: src,
      request: reqLine,
      httpStatus: res.status,
      outcome: !res.ok ? 'http_error' : 'empty_data',
      lines: [
        ...docBlock(),
        `http_status: ${res.status}`,
        `data_array_length: ${Array.isArray(json?.data) ? json.data.length : 0}`,
        ...extra,
      ],
    });
    return null;
  }
  const list = json.data as Fr24Flight[];
  const candidates = list.filter((f) => fr24LegMatchesRosterDate(f, date));
  if (candidates.length === 0) {
    let firstLegPreview = '';
    try {
      if (list[0] != null) {
        const s0 = JSON.stringify(list[0], null, 2);
        firstLegPreview = s0.length > 2500 ? `${s0.slice(0, 2500)}\n…` : s0;
      }
    } catch {
      firstLegPreview = '';
    }
    pushTrace(trace, {
      source: src,
      request: reqLine,
      httpStatus: res.status,
      outcome: 'no_matching_leg',
      lines: [
        ...docBlock(),
        `legs_in_response: ${list.length}`,
        `candidates_after_roster_date_filter: 0`,
        `roster_flight_date: ${date}`,
        ...(firstLegPreview ? ['── İlk bacak (eşleşmedi; örnek) ──', firstLegPreview] : []),
      ],
    });
    return null;
  }
  const live = candidates.find((x) => x.flight_ended === false || x.flightEnded === false);
  const picked =
    live ??
    candidates.sort((fa, fb) => {
      const ra = fa as unknown as Record<string, unknown>;
      const rb = fb as unknown as Record<string, unknown>;
      const oa = String(ra.orig_icao ?? ra.origin_icao ?? '').toUpperCase();
      const ob = String(rb.orig_icao ?? rb.origin_icao ?? '').toUpperCase();
      const da = ra.scheduled_departure_utc ?? ra.scheduled_departure;
      const db = rb.scheduled_departure_utc ?? rb.scheduled_departure;
      const ia =
        typeof da === 'string' && da.trim()
          ? fr24ScheduledFieldToUtcIso(da, oa, date)
          : toUtcIsoAssumeUtc(
              String(
                fa.datetime_landed ??
                  fa.datetimeLanded ??
                  fa.last_seen ??
                  fa.lastSeen ??
                  fa.first_seen ??
                  fa.firstSeen ??
                  '',
              ),
            );
      const ib =
        typeof db === 'string' && db.trim()
          ? fr24ScheduledFieldToUtcIso(db, ob, date)
          : toUtcIsoAssumeUtc(
              String(
                fb.datetime_landed ??
                  fb.datetimeLanded ??
                  fb.last_seen ??
                  fb.lastSeen ??
                  fb.first_seen ??
                  fb.firstSeen ??
                  '',
              ),
            );
      const ta = ia ?? '';
      const tb = ib ?? '';
      return tb.localeCompare(ta);
    })[0] ??
    null;
  if (!picked) {
    pushTrace(trace, {
      source: src,
      request: reqLine,
      httpStatus: res.status,
      outcome: 'empty',
      lines: [...docBlock(), 'reason: pick_sort_returned_null'],
    });
    return null;
  }
  const pr = picked as unknown as Record<string, unknown>;
  const pid = fr24PickString(pr, ['fr24_id', 'fr24Id']) ?? (typeof pr.id === 'string' ? pr.id.trim() : undefined);
  pushTrace(trace, {
    source: src,
    request: reqLine,
    httpStatus: res.status,
    outcome: 'ok',
    lines: [
      ...docBlock(),
      `http_status: ${res.status}`,
      `matched_candidates: ${candidates.length}`,
      `picked_live_not_ended: ${Boolean(live)}`,
      `── Özet ──`,
      `fr24_id: ${pid ?? '—'}`,
      `flight_ended: ${String(picked.flight_ended ?? picked.flightEnded ?? '—')}`,
      `orig_iata/icao: ${String(pr.orig_iata ?? pr.origin_iata ?? pr.orig_icao ?? pr.origin_icao ?? '—')}`,
      `dest_iata/icao: ${String(pr.dest_iata ?? pr.destination_iata ?? pr.dest_icao ?? pr.destination_icao ?? '—')}`,
      `scheduled_dep: ${String(picked.scheduled_departure_utc ?? picked.scheduled_departure ?? '—')}`,
      `scheduled_arr: ${String(picked.scheduled_arrival_utc ?? picked.scheduled_arrival ?? '—')}`,
      `estimated_dep: ${String(picked.estimated_departure_utc ?? picked.estimated_departure ?? '—')}`,
      `estimated_arr/landing: ${String(picked.estimated_arrival_utc ?? picked.estimated_arrival ?? picked.estimated_landing_utc ?? picked.estimated_landing ?? '—')}`,
      `first_seen: ${String(picked.first_seen ?? picked.firstSeen ?? '—')}`,
      `datetime_takeoff: ${String(picked.datetime_takeoff ?? picked.datetimeTakeoff ?? '—')}`,
      `datetime_landed: ${String(picked.datetime_landed ?? picked.datetimeLanded ?? '—')}`,
      `last_seen: ${String(picked.last_seen ?? picked.lastSeen ?? '—')}`,
      ...fr24PickedLegVerboseLines(picked),
    ],
  });
  return picked;
}

function dbLiveToFlightStatus(s: DbLive): FlightStatusApi {
  if (s === 'taxi_out') return 'taxi_out';
  if (s === 'en_route') return 'en_route';
  if (s === 'landed') return 'landed';
  return 'scheduled';
}

function emptyBase(): FlightInfo {
  return {
    origin: '',
    destination: '',
    depTime: '',
    arrTime: '',
  };
}

function attachAirLabsTimingFields(
  info: FlightInfo,
  al: {
    delayDepMin?: number | null;
    delayArrMin?: number | null;
    progressPercent?: number | null;
    aircraftRegistration?: string | null;
  },
): void {
  if (al.delayDepMin != null) info.delayDepMin = al.delayDepMin;
  if (al.delayArrMin != null) info.delayArrMin = al.delayArrMin;
  if (al.progressPercent != null) info.airlabsProgressPercent = al.progressPercent;
  if (al.aircraftRegistration) info.aircraftRegistration = al.aircraftRegistration;
}

function coalescePollAircraftRegistration(info: FlightInfo): FlightInfo {
  if (info.aircraftRegistration?.trim()) {
    info.aircraftRegistration = info.aircraftRegistration.trim().toUpperCase();
    return info;
  }
  const raw = info as unknown as Record<string, unknown>;
  const snake = raw.aircraft_registration;
  if (typeof snake === 'string' && snake.trim()) {
    info.aircraftRegistration = snake.trim().toUpperCase();
  }
  return info;
}

/** Edge önbelleği / timetable yanıtında kuyruk yoksa FR24 veya AirLabs ile tamamla. */
async function enrichPollInfoAircraftRegistration(
  flightNumber: string,
  flightDate: string,
  phase: 'semi_active' | 'active',
  info: FlightInfo,
  trace?: FlightPollTraceEntry[],
  options?: PollProviderOptions,
): Promise<FlightInfo> {
  coalescePollAircraftRegistration(info);
  if (info.aircraftRegistration?.trim()) return info;

  if (FR24_TOKEN) {
    const f = await selectFr24Flight(flightNumber, flightDate, FR24_TOKEN, trace, options);
    if (f) {
      const bar = fr24ProgressAnchorsFromFr24(f);
      if (bar.aircraftRegistration) {
        return { ...info, aircraftRegistration: bar.aircraftRegistration };
      }
    }
  }

  if (phase === 'semi_active' || !info.aircraftRegistration) {
    const al = await fetchAirLabsFlight(flightNumber, flightDate, trace, options);
    if (al?.aircraftRegistration) {
      return { ...info, aircraftRegistration: al.aircraftRegistration };
    }
  }

  return info;
}

/**
 * Yerel yedek (Edge `flight-lookup` yoksa veya hata).
 * @param phase DB/api_refresh_phase: semi_active | active
 */
async function pollFlightForRosterLocal(
  flightNumber: string,
  flightDate: string,
  phase: 'semi_active' | 'active',
  trace?: FlightPollTraceEntry[],
  options?: PollProviderOptions,
): Promise<FlightInfo | null> {
  if (phase === 'semi_active') {
    const al = await fetchSemiTimetableWithBoardCache(flightNumber, flightDate, trace, options);
    const o = emptyBase();
    const stSemi = mapAirLabsStatus(al?.status ?? undefined);
    o.flightStatus = stSemi ?? 'scheduled';
    if (al) {
      if (al.scheduledDep) o.scheduled_departure_utc = al.scheduledDep;
      if (al.scheduledArr) o.scheduled_arrival_utc = al.scheduledArr;
      attachAirLabsTimingFields(o, al);
    }
    if (!o.aircraftRegistration && FR24_TOKEN) {
      const fReg = await selectFr24Flight(flightNumber, flightDate, FR24_TOKEN, trace, options);
      if (fReg) {
        const barReg = fr24ProgressAnchorsFromFr24(fReg);
        if (barReg.aircraftRegistration) o.aircraftRegistration = barReg.aircraftRegistration;
      }
    }
    if (
      !o.scheduled_departure_utc &&
      !o.scheduled_arrival_utc &&
      o.delayDepMin == null &&
      o.delayArrMin == null &&
      o.airlabsProgressPercent == null &&
      !o.fr24_progress_dep_utc &&
      !o.aircraftRegistration
    ) {
      return null;
    }
    return o;
  }

  const nowMs = Date.now();
  if (FR24_TOKEN) {
    const f = await selectFr24Flight(flightNumber, flightDate, FR24_TOKEN, trace, {
      ignoreCooldown: options?.ignoreCooldown,
    });
    if (f) {
      const bar = fr24ProgressAnchorsFromFr24(f);
      const ended = f.flight_ended === true || f.flightEnded === true;
      if (!ended) {
        const firstSeen = toUtcIsoAssumeUtc((f.first_seen ?? f.firstSeen) as string | undefined);
        const takeoff = toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined);
        const landedTs = toUtcIsoAssumeUtc((f.datetime_landed ?? f.datetimeLanded) as string | undefined);
        const lastSeen = toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined);
        const live = deriveFr24LiveStatus(nowMs, firstSeen, takeoff, landedTs);
        return {
          ...emptyBase(),
          flightStatus: dbLiveToFlightStatus(live),
          lastTrackUtc: lastSeen,
          ...(firstSeen ? { first_seen_utc: firstSeen } : {}),
          ...bar,
        };
      }
      const alEnded = await fetchTimetableWaterfallLocal(flightNumber, flightDate, trace, options);
      const slE = alEnded?.status?.toLowerCase();
      if (slE === 'cancelled' || slE === 'canceled') {
        const o = { ...emptyBase(), flightStatus: 'cancelled' as const, ...bar };
        if (alEnded) attachAirLabsTimingFields(o, alEnded);
        return o;
      }
      if (slE === 'diverted') {
        const o = {
          ...emptyBase(),
          flightStatus: 'diverted' as const,
          divertedTo: alEnded?.divertedTo ?? undefined,
          ...bar,
        };
        if (alEnded) attachAirLabsTimingFields(o, alEnded);
        return o;
      }
      if (alEnded?.actualIn && isActualInReliableForCurrentLeg({
        actualInUtc: alEnded.actualIn,
        actualOutUtc: alEnded.actualOut ?? null,
        scheduledDepUtc: alEnded.scheduledDep ?? null,
        scheduledArrUtc: alEnded.scheduledArr ?? null,
        nowMs,
      })) {
        const o = { ...emptyBase(), flightStatus: 'landed' as const, ...bar };
        attachAirLabsTimingFields(o, alEnded);
        return o;
      }
      if (alEnded?.actualOut && (slE === 'scheduled' || !slE)) {
        const o = { ...emptyBase(), flightStatus: 'en_route' as const, ...bar };
        attachAirLabsTimingFields(o, alEnded);
        return o;
      }
      if (alEnded) {
        const st = mapAirLabsStatus(alEnded.status ?? undefined);
        if (st && st !== 'landed') {
          const o = { ...emptyBase(), flightStatus: st, ...bar };
          attachAirLabsTimingFields(o, alEnded);
          return o;
        }
      }
      // Edge `rosterPollEdge` ile aynı: FR24 flight_ended=true tek başına operasyon bitti;
      // timetable actualIn yoksa bile inişe çek (mobil önceden null dönüyordu → DB güncellenmiyordu).
      const endedLastSeen = toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined);
      const oLanded = { ...emptyBase(), flightStatus: 'landed' as const, ...bar, lastTrackUtc: endedLastSeen };
      if (alEnded) attachAirLabsTimingFields(oLanded, alEnded);
      return oLanded;
    }
  }

  const al = await fetchTimetableWaterfallLocal(flightNumber, flightDate, trace, options);
  const sl = al?.status?.toLowerCase();
  if (sl === 'cancelled' || sl === 'canceled') {
    const o = { ...emptyBase(), flightStatus: 'cancelled' as const };
    if (al) attachAirLabsTimingFields(o, al);
    return o;
  }
  if (sl === 'diverted') {
    const o = {
      ...emptyBase(),
      flightStatus: 'diverted' as const,
      divertedTo: al?.divertedTo ?? undefined,
    };
    if (al) attachAirLabsTimingFields(o, al);
    return o;
  }
  if (al?.actualIn && isActualInReliableForCurrentLeg({
    actualInUtc: al.actualIn,
    actualOutUtc: al.actualOut ?? null,
    scheduledDepUtc: al.scheduledDep ?? null,
    scheduledArrUtc: al.scheduledArr ?? null,
    nowMs,
  })) {
    const o = { ...emptyBase(), flightStatus: 'landed' as const };
    attachAirLabsTimingFields(o, al);
    return o;
  }
  if (al?.actualOut && (sl === 'scheduled' || !sl)) {
    const o = { ...emptyBase(), flightStatus: 'en_route' as const };
    attachAirLabsTimingFields(o, al);
    return o;
  }

  if (al) {
    const st = mapAirLabsStatus(al.status ?? undefined);
    if (st) {
      const o = { ...emptyBase(), flightStatus: st };
      attachAirLabsTimingFields(o, al);
      return o;
    }
  }

  return null;
}

export type PollFlightWithTraceResult = {
  info: FlightInfo | null;
  trace: FlightPollTraceEntry[];
  /** Edge `flight-lookup` cevap vermediyse yerel zincir çalıştı. */
  usedLocalFallback: boolean;
};

/** Edge + (gerekirse) yerel zincir; her adım `trace` içinde gerçek endpoint ve özet yanıt. */
export async function pollFlightForRosterWithTrace(
  flightNumber: string,
  flightDate: string,
  phase: 'semi_active' | 'active',
  options?: PollProviderOptions,
): Promise<PollFlightWithTraceResult> {
  const trace: FlightPollTraceEntry[] = [];
  const edgeUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/flight-lookup`;
  const bodyJson = JSON.stringify({ flight_number: flightNumber, flight_date: flightDate, phase });
  try {
    const { data, error } = await supabase.functions.invoke('flight-lookup', {
      body: { flight_number: flightNumber, flight_date: flightDate, phase },
    });
    let edgeNullInfoHandled = false;
    if (!error && data && typeof data === 'object') {
      const raw = data as { info?: FlightInfo | null };
      // Yalnızca dolu info ile erken dön; Edge `info: null` ise yerel FR24+timetable dene (eskiden null ile erken dönülüyordu).
      if (raw.info != null) {
        let info = raw.info as FlightInfo;
        info = await enrichPollInfoAircraftRegistration(flightNumber, flightDate, phase, info, trace, options);
        pushTrace(trace, {
          source: 'Supabase Edge — flight-lookup',
          request: `POST ${edgeUrl}\nContent-Type: application/json\nBody: ${bodyJson}`,
          outcome: 'ok',
          lines: summarizeFlightInfoForTrace(info),
        });
        return { info, trace, usedLocalFallback: false };
      }
      if (raw.info === null) {
        edgeNullInfoHandled = true;
        pushTrace(trace, {
          source: 'Supabase Edge — flight-lookup',
          request: `POST ${edgeUrl}\nBody: ${bodyJson}`,
          outcome: 'empty_info · fallback local',
          lines: ['info: null → pollFlightForRosterLocal'],
        });
      }
    }
    if (!edgeNullInfoHandled) {
      const errMsg = error?.message ?? (error ? String(error) : 'no_info_field');
      pushTrace(trace, {
        source: 'Supabase Edge — flight-lookup',
        request: `POST ${edgeUrl}\nBody: ${bodyJson}`,
        outcome: `fallback · ${errMsg}`,
        lines: [],
      });
      if (error) console.warn('[flightStatusPoll] flight-lookup', error.message);
    }
  } catch (e) {
    pushTrace(trace, {
      source: 'Supabase Edge — flight-lookup',
      request: `POST ${edgeUrl}\nBody: ${bodyJson}`,
      outcome: `error · ${e instanceof Error ? e.message : String(e)}`,
      lines: [],
    });
    console.warn('[flightStatusPoll] flight-lookup', e);
  }
  let info = await pollFlightForRosterLocal(flightNumber, flightDate, phase, trace, options);
  if (info) {
    info = await enrichPollInfoAircraftRegistration(flightNumber, flightDate, phase, info, trace, options);
  }
  return { info, trace, usedLocalFallback: true };
}

/** Önce sunucu (`flight-lookup`); başarısızsa `pollFlightForRosterLocal`. */
export async function pollFlightForRoster(
  flightNumber: string,
  flightDate: string,
  phase: 'semi_active' | 'active',
  options?: PollProviderOptions,
): Promise<FlightInfo | null> {
  const { info } = await pollFlightForRosterWithTrace(flightNumber, flightDate, phase, options);
  return info;
}
