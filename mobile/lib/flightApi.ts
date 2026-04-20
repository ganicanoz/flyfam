import Constants from 'expo-constants';
import { getAirportDisplay } from '../constants/airports';
import { getLocalDateString, getLocalDateStringPlusDays, getLocalDateStringTomorrow, isLocalTodayOrTomorrow } from './dateUtils';
import { supabase } from './supabase';
import {
  applyFlightProviderCooldownFromResponse,
  FLIGHT_PROVIDER_AIRLABS,
  FLIGHT_PROVIDER_FR24,
  isFlightProviderInCooldown,
} from './flightProviderCooldown';
import { getEffectiveUtcOffsetMinutesForAirportAtFlightDate, utcIsoToLocalDateAtAirport } from './airportUtcOffset';

export { utcIsoToLocalDateAtAirport } from './airportUtcOffset';

// Deprecated provider disabled.
const AVIATION_EDGE_KEY = '';
const FR24_TOKEN =
  Constants.expoConfig?.extra?.flightradar24Token ?? process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
// Deprecated provider disabled.
const AVIATION_KEY = '';
const AIRLABS_KEY =
  Constants.expoConfig?.extra?.airlabsKey ?? process.env.EXPO_PUBLIC_AIRLABS_API_KEY;
/** RapidAPI — env yoksa yerleşik anahtar (üretimde secret tercih edilir). */
const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';
const AERODATABOX_RAPIDAPI_KEY =
  (Constants.expoConfig?.extra?.aerodataboxRapidApiKey ?? process.env.EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY ?? '')
    .trim() || AERODATABOX_RAPIDAPI_FALLBACK;
const AERODATABOX_APIMARKET_BASE =
  (Constants.expoConfig?.extra?.aerodataboxApiMarketBase ??
    process.env.EXPO_PUBLIC_AERODATABOX_APIMARKET_BASE ??
    '').trim();
const AERODATABOX_APIMARKET_KEY =
  (Constants.expoConfig?.extra?.aerodataboxApiMarketKey ??
    process.env.EXPO_PUBLIC_AERODATABOX_APIMARKET_KEY ??
    '').trim();

/** Uçuş araması: FR24 + AirLabs. */
export const hasFlightApiKeys = !!FR24_TOKEN || !!AIRLABS_KEY;

/** Aviation Edge timetable status values; we store and display these when present. */
/** FR24 live path adds: taxi_out, departed, parked (departed = airborne, parked = after last_seen). */
export type FlightStatusApi =
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

/** Map Aviation Edge timetable status to our FlightStatusApi. */
function mapAviationEdgeStatus(status: string | undefined): FlightStatusApi | undefined {
  if (!status || status === 'unknown') return undefined;
  const s = status.toLowerCase();
  switch (s) {
    case 'active':
    case 'en-route':
    case 'en_route':
    case 'enroute':
    case 'departed':
    case 'departure':
      return 'en_route';
    case 'scheduled':
      return 'scheduled';
    case 'landed':
    case 'arrived':
    case 'arrival':
      return 'landed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'diverted':
      return 'diverted';
    case 'incident':
      return 'incident';
    case 'redirected':
      return 'redirected';
    default:
      return undefined;
  }
}

/** Use Aviation Edge status only for cancelled/diverted; do not use AE for en_route, landed, etc. */
function aviationEdgeStatusOnlyCancelOrDivert(status: string | undefined): FlightStatusApi | undefined {
  const mapped = mapAviationEdgeStatus(status);
  return mapped === 'cancelled' || mapped === 'diverted' ? mapped : undefined;
}

export type FlightInfo = {
  origin: string;
  destination: string;
  originCity?: string;
  destinationCity?: string;
  depTime: string;
  arrTime: string;
  /** When set, store these directly (UTC ISO) so times match FR24/API. */
  scheduled_departure_utc?: string;
  scheduled_arrival_utc?: string;
  /** Real departure/arrival from API when available (for status: use these instead of scheduled). */
  actual_departure_utc?: string;
  actual_arrival_utc?: string;
  airline?: string;
  aircraftRegistration?: string;
  /** FR24 unique id for this flight leg when sourced from FR24. */
  fr24Id?: string;
  /** FR24 Mode-S hex identifier when available. */
  hex?: string;
  /** FR24 operator airline ICAO code (e.g. PGT). */
  operatedAs?: string;
  /** FR24 callsign (often the best "live" handle, e.g. PGT656). */
  callsign?: string;
  /** FR24 indicates whether this leg ended (historical) */
  flightEnded?: boolean;
  /** Live metrics (when available). */
  groundSpeedKts?: number;
  altitudeFt?: number;
  latitude?: number;
  longitude?: number;
  lastTrackUtc?: string;
  /** When true, show flight as delayed (red); when false, on time (green). */
  delayed?: boolean;
  /** Delay minutes when provided by API (AE timetable). */
  delayDepMin?: number;
  delayArrMin?: number;
  /** Live status from API (e.g. Aviation Edge timetable). When set, app uses this instead of time-based guess. */
  flightStatus?: FlightStatusApi;
  /**
   * True when scheduled times are from the next calendar day (scheduled_departure was in the past for selected date).
   * UI should show a subtle hint that the date shown is tomorrow.
   */
  nextDayHint?: boolean;
  /** FR24 timestamps for live status (when flightEnded === false). All UTC ISO. */
  first_seen_utc?: string;
  datetime_takeoff_utc?: string;
  datetime_landed_utc?: string;
  last_seen_utc?: string;
  /** When flightStatus is 'diverted', airport code (IATA/ICAO) where the flight was diverted to. */
  divertedTo?: string;
  /** FR24 — roster bar: 0%% at dep, 100%% at ETA; landed timestamp forces 100%%. */
  fr24_progress_dep_utc?: string;
  fr24_progress_eta_utc?: string;
  /** FR24 `datetime_takeoff` (UTC) — çubuk başlangıcı birinci öncelik. */
  fr24_datetime_takeoff_utc?: string;
  fr24_datetime_landed_utc?: string;
  /** AirLabs /flight percent 0–100 — bar fallback (see STATUS_ALGORITHM + roster rules). */
  airlabsProgressPercent?: number;
};

function parseTime(iso: string | null | undefined): string {
  if (!iso) return '';
  if (typeof iso !== 'string') return '';
  if (iso.includes('T')) {
    const part = iso.split('T')[1];
    return part ? part.slice(0, 5) : '';
  }
  if (/^\d{1,2}:\d{2}/.test(iso)) return iso.slice(0, 5);
  return '';
}

function shiftUtcIsoByDays(utcIso: string | undefined, days: number): string | undefined {
  if (!utcIso) return undefined;
  const ms = new Date(utcIso).getTime();
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeOvernightArrival(depUtcIso: string | undefined, arrUtcIso: string | undefined): string | undefined {
  if (!depUtcIso || !arrUtcIso) return arrUtcIso;
  const depMs = new Date(depUtcIso).getTime();
  const arrMs = new Date(arrUtcIso).getTime();
  if (Number.isNaN(depMs) || Number.isNaN(arrMs)) return arrUtcIso;
  // If arrival is before departure, assume arrival is next day.
  // Common when APIs provide only HH:MM for arrival or use departure-date as base.
  if (arrMs < depMs) return new Date(arrMs + 24 * 60 * 60 * 1000).toISOString();
  return arrUtcIso;
}

function toIataCode(code: string | null | undefined): string | undefined {
  if (!code || typeof code !== 'string') return undefined;
  const key = code.trim().toUpperCase();
  if (!key) return undefined;
  return getAirportDisplay(key)?.iata ?? key;
}

function isFlightInfoMatchingSelectedDate(info: FlightInfo | null | undefined, selectedDate: string): boolean {
  if (!info || !selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return false;
  const origin = String(info.origin ?? '').trim().toUpperCase();
  const depAnchor =
    info.scheduled_departure_utc ??
    info.actual_departure_utc ??
    info.scheduled_arrival_utc ??
    info.actual_arrival_utc;
  if (!depAnchor || typeof depAnchor !== 'string') return false;
  const localDate = utcIsoToLocalDateAtAirport(depAnchor, origin) ?? depAnchor.slice(0, 10);
  return localDate === selectedDate;
}

function isYmdWithinOneDay(a: string, b: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return false;
  const ams = new Date(`${a}T00:00:00Z`).getTime();
  const bms = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(ams) || !Number.isFinite(bms)) return false;
  return Math.abs(ams - bms) <= 24 * 60 * 60 * 1000;
}

function isFlightInfoMatchingSelectedDateRelaxed(
  info: FlightInfo | null | undefined,
  selectedDate: string,
  routeHint?: Pick<FlightInfo, 'origin' | 'destination'>
): boolean {
  if (!info) return false;
  if (isFlightInfoMatchingSelectedDate(info, selectedDate)) return true;
  const origin = String(info.origin ?? '').trim().toUpperCase();
  const depAnchor =
    info.scheduled_departure_utc ??
    info.actual_departure_utc ??
    info.scheduled_arrival_utc ??
    info.actual_arrival_utc;
  if (!depAnchor || typeof depAnchor !== 'string') return false;
  const localDate = utcIsoToLocalDateAtAirport(depAnchor, origin) ?? depAnchor.slice(0, 10);
  if (!isYmdWithinOneDay(localDate, selectedDate)) return false;
  const hintO = String(routeHint?.origin ?? '').trim().toUpperCase();
  const hintD = String(routeHint?.destination ?? '').trim().toUpperCase();
  if (hintO && hintD) {
    const o = String(info.origin ?? '').trim().toUpperCase();
    const d = String(info.destination ?? '').trim().toUpperCase();
    if (o && d && (o !== hintO || d !== hintD)) return false;
  }
  return true;
}

async function fetchFr24LastTrackPoint(fr24Id: string): Promise<{
  groundSpeedKts?: number;
  altitudeFt?: number;
  latitude?: number;
  longitude?: number;
  lastTrackUtc?: string;
} | null> {
  if (!FR24_TOKEN) return null;
  if (await isFlightProviderInCooldown(FLIGHT_PROVIDER_FR24)) return null;
  const id = fr24Id.trim();
  if (!id) return null;
  try {
    const url = `https://fr24api.flightradar24.com/api/flight-tracks?flight_id=${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${FR24_TOKEN}`,
        Accept: 'application/json',
        'Accept-Version': 'v1',
      },
    });
    if (res.status === 429) {
      await applyFlightProviderCooldownFromResponse(FLIGHT_PROVIDER_FR24, res);
      return null;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) return null;
    const root: any = json;
    const first = Array.isArray(root) ? root[0] : (root?.data?.[0] ?? root?.data ?? root);
    const tracksMaybe =
      first?.tracks ??
      first?.track ??
      first?.path ??
      first?.positions ??
      first?.data ??
      null;
    const tracks: any[] =
      Array.isArray(tracksMaybe) ? tracksMaybe
      : Array.isArray(tracksMaybe?.points) ? tracksMaybe.points
      : Array.isArray(tracksMaybe?.track) ? tracksMaybe.track
      : Array.isArray(first) ? first
      : [];
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    const last = tracks[tracks.length - 1] ?? null;
    if (!last) return null;
    // Track points can be objects OR arrays (provider-dependent).
    const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
    const asNum = (x: unknown) => {
      const n = typeof x === 'string' ? Number(x) : (x as number);
      return Number.isFinite(n) ? n : NaN;
    };
    let lat = NaN;
    let lon = NaN;
    let alt = NaN;
    let spd = NaN;
    let ts: any = null;

    if (Array.isArray(last)) {
      // Common layouts:
      // [ts, lat, lon, alt, spd, ...]
      // [lat, lon, alt, spd, ts, ...]
      const a = last.map(asNum);
      const candTs0 = a[0];
      const candLat0 = a[1];
      const candLon0 = a[2];
      if (isNum(candTs0) && candTs0 > 1_000_000_000 && isNum(candLat0) && Math.abs(candLat0) <= 90 && isNum(candLon0) && Math.abs(candLon0) <= 180) {
        ts = candTs0;
        lat = candLat0;
        lon = candLon0;
        alt = a[3];
        spd = a[4];
      } else if (isNum(a[0]) && Math.abs(a[0]) <= 90 && isNum(a[1]) && Math.abs(a[1]) <= 180) {
        lat = a[0];
        lon = a[1];
        alt = a[2];
        spd = a[3];
        ts = a.find((v) => isNum(v) && v > 1_000_000_000) ?? null;
      }
    } else {
      lat = asNum((last as any).lat ?? (last as any).latitude);
      lon = asNum((last as any).lon ?? (last as any).lng ?? (last as any).longitude);
      alt = asNum((last as any).alt ?? (last as any).altitude ?? (last as any).alt_ft ?? (last as any).altFt);
      // FR24 FlightTracks schema uses `gspeed` (knots) and `timestamp` (ISO datetime string).
      spd = asNum(
        (last as any).gspeed ??
        (last as any).spd ??
        (last as any).speed ??
        (last as any).gs ??
        (last as any).ground_speed ??
        (last as any).groundSpeed
      );
      ts = (last as any).ts ?? (last as any).timestamp ?? (last as any).time ?? null;
    }
    // Some APIs use seconds; guard by magnitude.
    const tsMs =
      typeof ts === 'number'
        ? (ts > 2_000_000_000 ? ts : ts * 1000)
        : (typeof ts === 'string' ? new Date(ts).getTime() : NaN);
    return {
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lon) ? lon : undefined,
      altitudeFt: Number.isFinite(alt) ? alt : undefined,
      groundSpeedKts: Number.isFinite(spd) ? spd : undefined,
      lastTrackUtc: Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

function deriveStatusFromLiveMetrics(
  base: FlightInfo,
  metrics: { groundSpeedKts?: number; altitudeFt?: number }
): FlightStatusApi | undefined {
  const gs = metrics.groundSpeedKts ?? -1;
  const alt = metrics.altitudeFt ?? -1;
  // Heuristic: airborne if speed or altitude indicates flight.
  if ((alt >= 500 && gs >= 0) || gs >= 90) return 'en_route';
  // Landed only when we have a confirmed landed timestamp (avoid false positives during taxi).
  if (base.actual_arrival_utc) return 'landed';
  return undefined;
}

function plusIsoDay(isoDay: string, delta: number): string {
  const [yy, mm, dd] = isoDay.split('-').map(Number);
  const dt = new Date(Date.UTC(yy, (mm ?? 1) - 1, dd ?? 1, 0, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Normalize API datetime to canonical UTC ISO string.
 * Parses with Date so any timezone offset (+03:00, Z, etc.) is converted to UTC correctly.
 * FR24 documents UTC; if no offset is given we assume UTC (append Z before parsing).
 * Return value is always ISO with Z so DB and display treat it as UTC.
 */
/**
 * Parse datetime that is known to be UTC even if it lacks an offset.
 * Used for sources that document UTC (e.g. FR24). If no offset is present we assume UTC.
 */
function toUtcIsoAssumeUtc(dt: string | null | undefined): string | undefined {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? s + ':00.000Z' : s + 'Z';
  }
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString(); // always includes Z
}

/**
 * Parse datetime only when it includes an explicit offset (Z or ±HH:MM).
 * For sources where a no-offset datetime is ambiguous (could be local), we refuse to guess.
 */
function toUtcIsoStrict(dt: string | null | undefined): string | undefined {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) return undefined;
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * FR24 flight_ended=FALSE iken kullanılır.
 * Landed yalnızca datetime_landed ≤ now ile (last_seen her zaman geçmişte olduğundan landed proxy değil).
 * - now < first_seen → Scheduled
 * - first_seen ≤ now < datetime_takeoff (veya takeoff null) → Taxi-Out
 * - datetime_takeoff ≤ now ve (datetime_landed yok veya now < landed) → En-Route
 * - datetime_landed ≤ now → Landed
 */
function deriveFr24LiveStatus(
  nowMs: number,
  firstSeenUtc: string | undefined,
  datetimeTakeoffUtc: string | undefined,
  datetimeLandedUtc: string | undefined,
): FlightStatusApi {
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

/**
 * AE Timetable path: cancelled/diverted değilse CHECK_TIME_1 — actual_departure / actual_arrival ile now karşılaştır.
 * - now ≤ actual_departure → Scheduled
 * - actual_departure ≤ now ≤ actual_arrival → En-Route
 * - actual_arrival ≤ now → Landed
 * actual yoksa scheduled ile kıyasla veya mevcut statusu koru (undefined döner).
 */
function deriveAeStatusFromActualTimes(
  nowMs: number,
  actualDepartureUtc: string | undefined,
  actualArrivalUtc: string | undefined
): FlightStatusApi | undefined {
  const depMs = actualDepartureUtc ? new Date(actualDepartureUtc).getTime() : 0;
  const arrMs = actualArrivalUtc ? new Date(actualArrivalUtc).getTime() : 0;
  if (!Number.isFinite(depMs) && !Number.isFinite(arrMs)) return undefined;
  if (depMs > 0 && nowMs < depMs) return 'scheduled';
  if (arrMs > 0 && nowMs >= arrMs) return 'landed';
  if (depMs > 0 && (arrMs === 0 || nowMs < arrMs)) return 'en_route';
  if (depMs === 0 && arrMs > 0 && nowMs < arrMs) return 'scheduled';
  return undefined;
}



// IATA -> ICAO (Flightradar24 often uses ICAO in data)
const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

// Build variants of flight number (e.g. PC614 -> PC614, PC0614, PGT614 for FR24)
function flightNumberVariants(flightNumber: string): string[] {
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const variants = [raw];
  const match = raw.match(/^([A-Z]{2})(\d+)$/);
  if (match) {
    const code = match[1];
    const num = match[2];
    if (num.length <= 3) variants.push(`${code}${num.padStart(4, '0')}`); // PC34 -> PC0034
    if (num.length === 3) variants.push(`${code}0${num}`); // PC614 -> PC0614
    if (num.length === 4 && num.startsWith('0')) variants.push(`${code}${num.slice(1)}`); // PC0614 -> PC614
    const icao = IATA_TO_ICAO[code];
    if (icao) {
      variants.push(`${icao}${num}`);   // PC614 -> PGT614
      if (num.length <= 3) variants.push(`${icao}${num.padStart(4, '0')}`); // PC34 -> PGT0034
      if (num.length === 3) variants.push(`${icao}0${num}`);
    }
  }
  return [...new Set(variants)];
}

// Airline (IATA 2-letter) -> hub airports to try for Aviation Edge timetable
const AIRLINE_HUBS: Record<string, string[]> = {
  PC: ['IST', 'SAW', 'ADB', 'AYT', 'ESB', 'ECN'], // Pegasus (+ ECN/Ercan)
  TK: ['IST', 'SAW', 'ESB', 'ADB', 'ECN'],        // Turkish Airlines (+ ECN)
  XQ: ['ADB', 'AYT', 'IST', 'SAW', 'ECN'],        // SunExpress (+ ECN)
  VF: ['ESB', 'SAW', 'AYT', 'IST', 'ADB', 'ECN'], // AJet (Turkey, ex-AnadoluJet) (+ ECN)
};
const FALLBACK_HUBS = ['IST', 'SAW', 'ECN', 'LHR', 'FRA', 'AMS', 'CDG', 'MAD', 'BCN'];

/** Convert local time at an airport (Aviation Edge returns local) to UTC ISO. */
function localTimeToUtcIso(date: string, time: string, offsetMinutes: number): string | undefined {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return undefined;
  const parts = time.trim().slice(0, 8).split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  const s = parseInt(parts[2] ?? '0', 10);
  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d) return undefined;
  const localAsUtcMs = Date.UTC(y, mo - 1, d, h, m, s);
  const utcMs = localAsUtcMs - offsetMinutes * 60 * 1000;
  return new Date(utcMs).toISOString();
}

/** Like localTimeToUtcIso but for full ISO string without Z (e.g. "2025-02-14T13:00:00.000"). */
function localIsoToUtcIso(iso: string | null | undefined, offsetMinutes: number): string | undefined {
  if (!iso || typeof iso !== 'string') return undefined;
  const s = iso.trim().replace(' ', 'T');
  const dateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = s.match(/T(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!dateMatch || !timeMatch) return undefined;
  const [, y, mo, d] = dateMatch;
  const [, h, min, sec] = timeMatch;
  const localAsUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min), Number(sec ?? 0));
  const utcMs = localAsUtcMs - offsetMinutes * 60 * 1000;
  return new Date(utcMs).toISOString();
}

/** Build UTC ISO from date + time; previously treated as UTC (for APIs that return UTC). */
function datePlusTime(date: string, time: string): string | undefined {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return undefined;
  const parts = time.trim().slice(0, 8).split(':');
  const h = (parts[0] ?? '00').padStart(2, '0');
  const m = (parts[1] ?? '00').padStart(2, '0');
  const s = (parts[2] ?? '00').padStart(2, '0');
  return `${date}T${h}:${m}:${s}.000Z`;
}

// ---------------------------------------------------------------------------
// Aviation Edge API – Flight Schedules (timetable) – real-time schedules
// ---------------------------------------------------------------------------
// timetable: real-time departure/arrival schedules; full ISO times; no date param
// (returns current/live schedule). Filter results by scheduledTime date.
// ---------------------------------------------------------------------------

/** When useFullStatus true (FR24 flight_ended true path), use full statusMapped. Otherwise only cancel/divert. */
async function fetchFromAviationEdgeTimetable(
  flightNumber: string,
  date: string,
  options?: { useFullStatus?: boolean }
): Promise<FlightInfo | null> {
  if (!AVIATION_EDGE_KEY) return null;
  const useFullStatus = options?.useFullStatus === true;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const airlineCode = raw.match(/^[A-Z]{2}/)?.[0] ?? '';
  const hubs = AIRLINE_HUBS[airlineCode] ?? FALLBACK_HUBS;
  // Aviation Edge sometimes matches better with ICAO variants too (e.g. PGT615).
  const variants = flightNumberVariants(flightNumber).filter((v) => /^[A-Z]{2,3}\d+$/.test(v));
  for (const airport of hubs) {
    for (const flightNum of variants) {
      for (const type of ['departure', 'arrival'] as const) {
        try {
          const url = `https://aviation-edge.com/v2/public/timetable?key=${encodeURIComponent(AVIATION_EDGE_KEY)}&iataCode=${encodeURIComponent(airport)}&type=${type}&flight_iata=${encodeURIComponent(flightNum)}`;
          const res = await fetch(url);
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            if (res.status === 404 || (data && (data.success === false || !Array.isArray(data)))) continue;
            continue;
          }
          const list = Array.isArray(data) ? data : data?.data ?? [];
          const depLocalDate = (x: any): string => {
            const dep = x?.departure;
            const origin = String(dep?.icaoCode ?? dep?.iataCode ?? '').toUpperCase();
            const rawTime = dep?.scheduledTime ?? dep?.estimatedTime ?? '';
            const str = rawTime ? String(rawTime) : '';
            const hasOffset = str.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(str);
            const offsetMin =
              getEffectiveUtcOffsetMinutesForAirportAtFlightDate(origin, date) ||
              getEffectiveUtcOffsetMinutesForAirportAtFlightDate(airport, date);
            const depIso =
              hasOffset ? toUtcIsoStrict(rawTime)
              : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)
                ? localIsoToUtcIso(rawTime, offsetMin)
                : undefined;
            return utcIsoToLocalDateAtAirport(depIso, origin) ?? str.slice(0, 10);
          };

          // Crew-entered date is interpreted as ORIGIN local departure date (exact match only; no prev-day fallback).
          const f: any = list.find((x: any) => depLocalDate(x) === date) ?? null;

          if (!f || !f.departure || !f.arrival) continue;
          const dep = f.departure;
          const arr = f.arrival;
          const origin = (dep.icaoCode ?? dep.iataCode ?? '').toString().toUpperCase();
          const destination = (arr.icaoCode ?? arr.iataCode ?? '').toString().toUpperCase();
          if (!origin && !destination) continue;
          const depRaw = dep.scheduledTime ?? dep.estimatedTime;
          const arrRaw = arr.scheduledTime ?? arr.estimatedTime;
          const depStr = depRaw ? String(depRaw) : '';
          const arrStr = arrRaw ? String(arrRaw) : '';
          const depHasOffset = depStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(depStr);
          const arrHasOffset = arrStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(arrStr);
          const depOffsetMin =
            getEffectiveUtcOffsetMinutesForAirportAtFlightDate(origin, date) ||
            getEffectiveUtcOffsetMinutesForAirportAtFlightDate(airport, date);
          const arrOffsetMin = getEffectiveUtcOffsetMinutesForAirportAtFlightDate(destination, date);
          const localDateForConvert = date;
          const depIso =
            depHasOffset ? toUtcIsoStrict(depRaw)
            : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(depStr)
              ? localIsoToUtcIso(depRaw, depOffsetMin)
              : localTimeToUtcIso(localDateForConvert, depStr.includes('T') ? depStr.split('T')[1]?.slice(0, 8) ?? depStr : depStr, depOffsetMin) ?? toUtcIsoStrict(depRaw);
          const arrIso =
            arrHasOffset ? toUtcIsoStrict(arrRaw)
            : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(arrStr)
              ? localIsoToUtcIso(arrRaw, arrOffsetMin)
              : localTimeToUtcIso(localDateForConvert, arrStr.includes('T') ? arrStr.split('T')[1]?.slice(0, 8) ?? arrStr : arrStr, arrOffsetMin) ?? toUtcIsoStrict(arrRaw);
          const originCity = getAirportDisplay(origin)?.city;
          const destinationCity = getAirportDisplay(destination)?.city;
          const apiStatus = (f.status as string | undefined)?.toLowerCase();
          const flightStatus = useFullStatus ? mapAviationEdgeStatus(apiStatus) : aviationEdgeStatusOnlyCancelOrDivert(apiStatus);
          const depActualRaw = dep.actualTime ?? dep.estimatedTime;
          const arrActualRaw = arr.actualTime ?? arr.estimatedTime;
          const depActualIso = depActualRaw && (String(depActualRaw).endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(String(depActualRaw)))
            ? toUtcIsoStrict(depActualRaw)
            : (depActualRaw && /^\d{4}-\d{2}-\d{2}T/.test(String(depActualRaw))
              ? localIsoToUtcIso(depActualRaw, depOffsetMin)
              : undefined) ?? toUtcIsoStrict(depActualRaw);
          const arrActualIso = arrActualRaw && (String(arrActualRaw).endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(String(arrActualRaw)))
            ? toUtcIsoStrict(arrActualRaw)
            : (arrActualRaw && /^\d{4}-\d{2}-\d{2}T/.test(String(arrActualRaw))
              ? localIsoToUtcIso(arrActualRaw, arrOffsetMin)
              : undefined) ?? toUtcIsoStrict(arrActualRaw);
          const shiftDays = 0;
          const depIsoShifted = shiftDays ? shiftUtcIsoByDays(depIso, shiftDays) : depIso;
          const arrIsoShifted0 = shiftDays ? shiftUtcIsoByDays(arrIso, shiftDays) : arrIso;
          const arrIsoShifted = normalizeOvernightArrival(depIsoShifted, arrIsoShifted0);

          const divertedTo = flightStatus === 'diverted' ? (getAirportDisplay(destination)?.iata ?? destination) : undefined;
          console.log(
            '[AviationEdge Timetable] Found:',
            origin,
            '→',
            destination,
            apiStatus ?? '',
            divertedTo != null ? `(diverted to ${divertedTo})` : '',
            `(${type})`,
            ''
          );
          return {
            origin,
            destination,
            originCity,
            destinationCity,
            depTime: parseTime(depRaw ?? undefined),
            arrTime: parseTime(arrRaw ?? undefined),
            scheduled_departure_utc: depIsoShifted,
            scheduled_arrival_utc: arrIsoShifted,
            actual_departure_utc: depActualIso ?? undefined,
            actual_arrival_utc: arrActualIso ?? undefined,
            airline: f.airline?.name,
            aircraftRegistration: f.aircraft?.regNumber,
            delayed: Number(dep.delay) > 0 || Number(arr.delay) > 0,
            delayDepMin: Number(dep.delay) || 0,
            delayArrMin: Number(arr.delay) || 0,
            flightStatus,
            divertedTo,
          };
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

async function fetchFromAviationEdgeTimetableAtAirports(
  flightNumber: string,
  date: string,
  airports: string[]
): Promise<FlightInfo | null> {
  if (!AVIATION_EDGE_KEY) return null;
  const uniqAirports = Array.from(new Set(airports.map((a) => a.trim().toUpperCase()).filter(Boolean)));
  if (uniqAirports.length === 0) return null;
  const variants = flightNumberVariants(flightNumber).filter((v) => /^[A-Z]{2,3}\d+$/.test(v));
  for (const airport of uniqAirports) {
    for (const flightNum of variants) {
      for (const type of ['departure', 'arrival'] as const) {
        try {
          const url = `https://aviation-edge.com/v2/public/timetable?key=${encodeURIComponent(AVIATION_EDGE_KEY)}&iataCode=${encodeURIComponent(airport)}&type=${type}&flight_iata=${encodeURIComponent(flightNum)}`;
          const res = await fetch(url);
          const data = await res.json().catch(() => null);
          if (!res.ok) continue;
          const list = Array.isArray(data) ? data : data?.data ?? [];
          const getDepDate = (x: any) => String(x?.departure?.scheduledTime ?? '').slice(0, 10);
          const getArrDate = (x: any) => String(x?.arrival?.scheduledTime ?? '').slice(0, 10);
          const f: any =
            list.find((x: any) => getDepDate(x) === date) ??
            list.find((x: any) => getArrDate(x) === date) ??
            null;
          if (!f || !f.departure || !f.arrival) continue;
          const dep = f.departure;
          const arr = f.arrival;
          const origin = (dep.icaoCode ?? dep.iataCode ?? '').toString().toUpperCase();
          const destination = (arr.icaoCode ?? arr.iataCode ?? '').toString().toUpperCase();
          if (!origin && !destination) continue;
          const depRaw = dep.scheduledTime ?? dep.estimatedTime;
          const arrRaw = arr.scheduledTime ?? arr.estimatedTime;
          const depStr = depRaw ? String(depRaw) : '';
          const arrStr = arrRaw ? String(arrRaw) : '';
          const depHasOffset = depStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(depStr);
          const arrHasOffset = arrStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(arrStr);
          const depOffsetMin =
            getEffectiveUtcOffsetMinutesForAirportAtFlightDate(origin, date) ||
            getEffectiveUtcOffsetMinutesForAirportAtFlightDate(airport, date);
          const arrOffsetMin = getEffectiveUtcOffsetMinutesForAirportAtFlightDate(destination, date);
          const depIso =
            depHasOffset ? toUtcIsoStrict(depRaw)
            : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(depStr)
              ? localIsoToUtcIso(depRaw, depOffsetMin)
              : localTimeToUtcIso(date, depStr.includes('T') ? depStr.split('T')[1]?.slice(0, 8) ?? depStr : depStr, depOffsetMin) ?? toUtcIsoStrict(depRaw);
          const arrIso =
            arrHasOffset ? toUtcIsoStrict(arrRaw)
            : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(arrStr)
              ? localIsoToUtcIso(arrRaw, arrOffsetMin)
              : localTimeToUtcIso(date, arrStr.includes('T') ? arrStr.split('T')[1]?.slice(0, 8) ?? arrStr : arrStr, arrOffsetMin) ?? toUtcIsoStrict(arrRaw);
          const arrIsoNorm = normalizeOvernightArrival(depIso, arrIso);
          const flightStatusAt = aviationEdgeStatusOnlyCancelOrDivert(String(f.status ?? ''));
          const divertedToAt = flightStatusAt === 'diverted' ? (getAirportDisplay(destination)?.iata ?? destination) : undefined;
          console.log('[AviationEdge Timetable] Found (route airports):', origin, '→', destination, flightStatusAt ?? '', divertedToAt != null ? `(diverted to ${divertedToAt})` : '', `(${airport}/${type})`);
          return {
            origin,
            destination,
            originCity: getAirportDisplay(origin)?.city,
            destinationCity: getAirportDisplay(destination)?.city,
            depTime: parseTime(depRaw ?? undefined),
            arrTime: parseTime(arrRaw ?? undefined),
            scheduled_departure_utc: depIso,
            scheduled_arrival_utc: arrIsoNorm,
            airline: f.airline?.name,
            aircraftRegistration: f.aircraft?.regNumber,
            delayed: Number(dep.delay) > 0 || Number(arr.delay) > 0,
            delayDepMin: Number(dep.delay) || 0,
            delayArrMin: Number(arr.delay) || 0,
            flightStatus: flightStatusAt,
            divertedTo: divertedToAt,
          };
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
async function fetchAviationEdgeLiveMetricsOnly(flightNumber: string): Promise<{
  groundSpeedKts?: number;
  altitudeFt?: number;
  latitude?: number;
  longitude?: number;
  isGround?: boolean;
} | null> {
  if (!AVIATION_EDGE_KEY) return null;
  const variants = flightNumberVariants(flightNumber).filter((v) => /^[A-Z]{2,3}\d+$/.test(v));
  for (const flightNum of variants) {
    try {
      const url = `https://aviation-edge.com/v2/public/flights?key=${encodeURIComponent(AVIATION_EDGE_KEY)}&flightIata=${encodeURIComponent(flightNum)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) continue;
      const list = Array.isArray(data) ? data : data?.data ?? [];
      if (!Array.isArray(list) || list.length === 0) continue;
      const live: any = list[0];
      const lat = Number(live?.geography?.latitude ?? live?.geography?.lat ?? live?.latitude);
      const lon = Number(live?.geography?.longitude ?? live?.geography?.lon ?? live?.longitude);
      const isGroundRaw = live?.geography?.isGround ?? live?.isGround ?? null;
      const isGround =
        typeof isGroundRaw === 'boolean' ? isGroundRaw
        : (typeof isGroundRaw === 'number' ? isGroundRaw === 1 : undefined);

      // Aviation Edge docs: metric system (commonly km/h, meters).
      const spdKmh = Number(live?.speed?.horizontal ?? live?.speed?.ground ?? live?.speed?.speed ?? live?.speed);
      const altM = Number(live?.altitude ?? live?.geography?.altitude ?? live?.alt);
      const kts = Number.isFinite(spdKmh) ? spdKmh / 1.852 : NaN;
      const ft = Number.isFinite(altM) ? altM * 3.28084 : NaN;
      return {
        latitude: Number.isFinite(lat) ? lat : undefined,
        longitude: Number.isFinite(lon) ? lon : undefined,
        groundSpeedKts: Number.isFinite(kts) ? kts : undefined,
        altitudeFt: Number.isFinite(ft) ? ft : undefined,
        isGround,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Aviation Edge flight_track_history: requires depIata, flightIata (or aircraftIcao24/regNum), depDate (or arrDate/dep_schTime/arr_schTime). */
export type AviationEdgeTrackPoint = {
  latitude: number;
  longitude: number;
  altitudeFt?: number;
  groundSpeedKts?: number;
  timestampUtc?: string;
};

/**
 * Fetches flight track history from Aviation Edge flight_track_history API.
 * @param flightNumber - IATA flight number (e.g. PC2532)
 * @param date - Local date YYYY-MM-DD (used as depDate)
 * @param depIata - Departure airport IATA (required by API). If omitted, tries airline hubs then fallback hubs.
 * @returns Array of track points or null
 */
export async function fetchFromAviationEdgeFlightTrackHistory(
  flightNumber: string,
  date: string,
  depIata?: string
): Promise<AviationEdgeTrackPoint[] | null> {
  if (!AVIATION_EDGE_KEY) return null;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const airlineCode = raw.match(/^[A-Z]{2}/)?.[0] ?? '';
  const hubs = depIata ? [depIata.trim().toUpperCase()] : (AIRLINE_HUBS[airlineCode] ?? FALLBACK_HUBS);
  const depDate = date.slice(0, 10); // YYYY-MM-DD
  const variants = flightNumberVariants(flightNumber).filter((v) => /^[A-Z]{2,3}\d+$/.test(v));

  for (const airport of hubs) {
    for (const flightNum of variants) {
      try {
        const params = new URLSearchParams({
          key: AVIATION_EDGE_KEY,
          depIata: airport,
          flightIata: flightNum,
          depDate,
        });
        const url = `https://aviation-edge.com/v2/public/flight_track_history?${params.toString()}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (data?.success === false || (data?.error && res.status === 400)) continue;
          continue;
        }
        const list = Array.isArray(data) ? data : data?.data ?? data?.response ?? [];
        if (!Array.isArray(list) || list.length === 0) continue;

        const asNum = (x: unknown) => {
          const n = typeof x === 'string' ? Number(x) : (x as number);
          return Number.isFinite(n) ? n : NaN;
        };
        const points: AviationEdgeTrackPoint[] = [];
        for (const item of list) {
          const lat = asNum((item as any).lat ?? (item as any).latitude ?? (item as any).geo?.latitude);
          const lon = asNum((item as any).lon ?? (item as any).lng ?? (item as any).longitude ?? (item as any).geo?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const altM = asNum((item as any).altitude ?? (item as any).alt ?? (item as any).geo?.altitude);
          const altFt = Number.isFinite(altM) ? altM * 3.28084 : undefined;
          const spdKmh = asNum((item as any).speed ?? (item as any).groundSpeed ?? (item as any).horizontal);
          const spdKts = Number.isFinite(spdKmh) ? spdKmh / 1.852 : undefined;
          const ts = (item as any).timestamp ?? (item as any).ts ?? (item as any).time ?? (item as any).datetime;
          const timestampUtc =
            typeof ts === 'string' ? ts
            : typeof ts === 'number' ? (ts > 2_000_000_000 ? new Date(ts).toISOString() : new Date(ts * 1000).toISOString())
            : undefined;
          points.push({ latitude: lat, longitude: lon, altitudeFt: altFt, groundSpeedKts: spdKts, timestampUtc });
        }
        if (points.length > 0) {
          console.log('[AviationEdge TrackHistory] Found', points.length, 'points for', flightNum, airport, depDate);
          return points;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function maybeEnrichWithAviationEdgeLiveMetrics(
  flightNumber: string,
  base: FlightInfo
): Promise<FlightInfo> {
  // Only if we don't already have live metrics and flight might be live.
  if (base.groundSpeedKts != null || base.altitudeFt != null) return base;
  if (base.actual_arrival_utc) return base;
  const depIso = base.actual_departure_utc ?? base.scheduled_departure_utc;
  const depMs = depIso ? new Date(depIso).getTime() : NaN;
  const now = Date.now();
  const nearDepartureWindow =
    Number.isFinite(depMs) ? (now >= depMs - 2 * 60 * 60 * 1000 && now <= depMs + 18 * 60 * 60 * 1000) : false;
  if (!nearDepartureWindow) return base;
  const m = await fetchAviationEdgeLiveMetricsOnly(flightNumber);
  if (!m) return base;
  const merged: FlightInfo = {
    ...base,
    groundSpeedKts: m.groundSpeedKts ?? base.groundSpeedKts,
    altitudeFt: m.altitudeFt ?? base.altitudeFt,
    latitude: m.latitude ?? base.latitude,
    longitude: m.longitude ?? base.longitude,
  };
  // Statü türetme (isGround → landed) kaldırıldı — baştan yazılacak.
  return merged;
}

// ---------------------------------------------------------------------------
// Flightradar24 API – which times we use
// ---------------------------------------------------------------------------
// We use SCHEDULED times as primary (what crew/family expect to see):
//   Departure: scheduled_departure_utc (fallback: scheduled_departure)
//   Arrival:   scheduled_arrival_utc  (fallback: scheduled_arrival)
// FR24 bazen offset olmadan saat döndürür; `toUtcIsoAssumeUtc` bunları UTC sanıyor → TR↔PK gibi
// uzun hatlarda ~1 saatlik saçma blok görülebiliyor. Bu hatlarda makul minimum blok altındaysa
// planı silip AirLabs (veya üst akıştaki yedek) doldursun.
// ---------------------------------------------------------------------------

const MIN_BLOCK_HOURS_TURKEY_PAKISTAN = 3;

function isTurkeyAirportIcaoIata(code: string): boolean {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.startsWith('LT')) return true;
  return ['SAW', 'IST', 'AYT', 'ADB', 'ESB', 'BJV', 'DLM', 'TZX', 'ADA', 'COV', 'CKZ', 'MLX', 'EZS'].includes(u);
}

function isPakistanAirportIcaoIata(code: string): boolean {
  const u = code.replace(/\s/g, '').toUpperCase();
  if (!u) return false;
  if (u.startsWith('OP')) return true;
  return ['KHI', 'ISB', 'LHE'].includes(u);
}

function fr24TurkeyPakistanScheduleTooShort(
  origin: string,
  dest: string,
  depIso: string | undefined,
  arrIso: string | undefined,
): boolean {
  if (!depIso || !arrIso) return false;
  const o = origin.replace(/\s/g, '').toUpperCase();
  const d = dest.replace(/\s/g, '').toUpperCase();
  const pair =
    (isTurkeyAirportIcaoIata(o) && isPakistanAirportIcaoIata(d)) ||
    (isPakistanAirportIcaoIata(o) && isTurkeyAirportIcaoIata(d));
  if (!pair) return false;
  const t0 = new Date(depIso).getTime();
  const t1 = new Date(arrIso).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return false;
  return (t1 - t0) / (3600 * 1000) < MIN_BLOCK_HOURS_TURKEY_PAKISTAN;
}

/**
 * FR24 flight-summary bazen alan adında utc olsa da offset vermeden döner; bu durumda değer çoğu zaman
 * kalkış/varış havalimanı yerel duvar saatidir (yaz/kış IANA ile). Offset yoksa yerel yorumlayıp UTC üret.
 * Z veya ±offset varsa gerçek anlık UTC olarak parse edilir.
 */
export function fr24ScheduledFieldToUtcIso(
  raw: string | null | undefined,
  airportCode: string,
  rosterFlightDateYmd: string,
): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const s0 = raw.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s0)) return undefined;
  const hasOffset = s0.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s0);
  if (hasOffset) return toUtcIsoStrict(raw);
  const ymdInField = s0.slice(0, 10);
  const code = airportCode.replace(/\s/g, '').toUpperCase();
  const offsetMin =
    getEffectiveUtcOffsetMinutesForAirportAtFlightDate(code, ymdInField) ||
    getEffectiveUtcOffsetMinutesForAirportAtFlightDate(code, rosterFlightDateYmd);
  const fromLocal = localIsoToUtcIso(s0, offsetMin);
  return fromLocal ?? toUtcIsoAssumeUtc(raw);
}

async function fetchFromFlightradar24(flightNumber: string, date: string): Promise<FlightInfo | null> {
  if (!FR24_TOKEN) {
    console.log('[FR24] No token');
    return null;
  }
  if (await isFlightProviderInCooldown(FLIGHT_PROVIDER_FR24)) {
    console.log('[FR24] In 429 cooldown, skip');
    return null;
  }
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(','); // FR24 allows up to 15
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0)); // -2 days
  const toDate = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59)); // +2 days
  // FR24 expects ISO-like timestamps (no timezone suffix) e.g. 2025-02-14T01:17:14
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);
  try {
    const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${FR24_TOKEN}`,
        Accept: 'application/json',
        'Accept-Version': 'v1',
      },
    });
    if (res.status === 429) {
      await applyFlightProviderCooldownFromResponse(FLIGHT_PROVIDER_FR24, res);
      console.log('[FR24] Rate limited (429)');
      return null;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      console.log('[FR24] Error:', res.status, json?.error || json?.message || 'Unknown');
      return null;
    }
    const list = json?.data;
    if (!Array.isArray(list) || list.length === 0) {
      console.log('[FR24] No flights found for', flightsParam, 'on', date);
      return null;
    }
    const targetDay = date; // crew-entered day (origin-local departure date)
    // Sadece seçilen gün eşleşmesi; tarih scheduled yoksa first_seen / datetime_takeoff ile hesaplanır (canlı bacak kullanılır).
    const pickBest = (flights: typeof list) => {
      const pickFrom = (candidates: any[]) => {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;
        const live = candidates.find((x) => x?.flight_ended === false || x?.flightEnded === false);
        if (live) return live;
        const score = (x: any) => {
          const origin = String(
            (x?.orig_icao ?? x?.origin_icao ?? x?.orig_iata ?? x?.origin_iata ?? '') as string,
          ).toUpperCase();
          const depSched = (x?.scheduled_departure_utc ?? x?.scheduled_departure) as string | undefined;
          const iso =
            depSched && String(depSched).trim()
              ? fr24ScheduledFieldToUtcIso(depSched, origin, targetDay)
              : toUtcIsoAssumeUtc(
                  String(
                    x?.first_seen ??
                      x?.firstSeen ??
                      x?.datetime_takeoff ??
                      x?.datetimeTakeoff ??
                      '',
                  ),
                );
          const ms = iso ? new Date(iso).getTime() : 0;
          return Number.isNaN(ms) ? 0 : ms;
        };
        return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
      };
      const getOriginLocalDepDate = (x: Record<string, unknown>) => {
        const origin = String(
          (x.orig_icao ?? x.origin_icao ?? x.orig_iata ?? x.origin_iata ?? '') as string,
        ).toUpperCase();
        const depScheduled = (x.scheduled_departure_utc ?? x.scheduled_departure) as string | undefined;
        const firstSeen = (x.first_seen ?? x.firstSeen) as string | undefined;
        const takeoff = (x.datetime_takeoff ?? x.datetimeTakeoff) as string | undefined;
        const depIso =
          (depScheduled
            ? fr24ScheduledFieldToUtcIso(depScheduled, origin, targetDay)
            : undefined) ??
          toUtcIsoAssumeUtc(takeoff) ??
          toUtcIsoAssumeUtc(firstSeen);
        return utcIsoToLocalDateAtAirport(depIso, origin) ?? (depIso ? depIso.slice(0, 10) : '');
      };
      const exactMatches = flights.filter((x: Record<string, unknown>) => getOriginLocalDepDate(x) === targetDay);
      return pickFrom(exactMatches as any[]);
    };
    const f = pickBest(list);
    if (!f) {
      console.log('[FR24] No flight on selected date', targetDay);
      return null;
    }
    const origin = (f.orig_icao ?? f.origin_icao ?? '') as string;
    const destination = (f.dest_icao ?? f.destination_icao ?? f.destination_icao_actual ?? '') as string;
    if (!origin && !destination) {
      console.log('[FR24] Flight found but no origin/destination');
      return null;
    }
    // Scheduled times: FR24 bazen scheduled_departure/arrival döndürmez; canlı bacak (flight_ended false) yine de kullanılır, saatler AE'den doldurulur.
    const depScheduled = (f.scheduled_departure_utc ?? f.scheduled_departure) as string | undefined;
    const arrScheduled = (f.scheduled_arrival_utc ?? f.scheduled_arrival) as string | undefined;
    let depIso = fr24ScheduledFieldToUtcIso(depScheduled, origin, targetDay);
    let arrIso = fr24ScheduledFieldToUtcIso(arrScheduled, destination, targetDay);
    if (fr24TurkeyPakistanScheduleTooShort(origin, destination, depIso, arrIso)) {
      console.warn(
        '[FR24] Turkey↔Pakistan block too short — dropping FR24 schedule (use AirLabs / backups)',
        origin,
        destination,
        depIso,
        arrIso,
      );
      depIso = undefined;
      arrIso = undefined;
    }
    // FR24 canlı statü (flight_ended false): first_seen, datetime_takeoff, datetime_landed — last_seen burada landed proxy değil.
    // flight_ended true iken FR24 bazen datetime_landed boş bırakır; roster poll ile aynı: last_seen → fr24_datetime_landed_utc.
    const firstSeenRaw = (f.first_seen ?? f.firstSeen) as string | undefined;
    const takeoffRaw = (f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined;
    const landedRaw = (f.datetime_landed ?? f.datetimeLanded) as string | undefined;
    const lastSeenRaw = (f.last_seen ?? f.lastSeen) as string | undefined;
    const first_seen_utc = toUtcIsoAssumeUtc(firstSeenRaw);
    const datetime_takeoff_utc = toUtcIsoAssumeUtc(takeoffRaw);
    const datetime_landed_utc = toUtcIsoAssumeUtc(landedRaw);
    const last_seen_utc = toUtcIsoAssumeUtc(lastSeenRaw);
    const flightEnded = (f.flight_ended ?? f.flightEnded) as boolean | undefined;
    const originCity = getAirportDisplay(origin)?.city;
    const destinationCity = getAirportDisplay(destination)?.city;
    console.log('[FR24] Found:', origin, '→', destination, 'flight_ended:', flightEnded);
    const base: FlightInfo = {
      origin,
      destination,
      originCity,
      destinationCity,
      depTime: depIso ? (depScheduled ? parseTime(depScheduled) : parseTime(depIso)) : '',
      arrTime: arrIso ? (arrScheduled ? parseTime(arrScheduled) : parseTime(arrIso)) : '',
      scheduled_departure_utc: depIso,
      scheduled_arrival_utc: arrIso,
      // No actual_departure_utc / actual_arrival_utc from FR24 — only status from 0–4.
      airline: undefined,
      aircraftRegistration: f.reg as string | undefined,
      fr24Id: (f.fr24_id ?? f.fr24Id ?? f.id) as string | undefined,
      hex: (f.hex ?? f.icao24) as string | undefined,
      operatedAs: (f.operating_as ?? f.operated_as ?? f.painted_as) as string | undefined,
      callsign: (f.callsign ?? f.callSign) as string | undefined,
      flightEnded,
      delayed: false,
      first_seen_utc: first_seen_utc ?? undefined,
      datetime_takeoff_utc: datetime_takeoff_utc ?? undefined,
      fr24_datetime_takeoff_utc: datetime_takeoff_utc ?? undefined,
      datetime_landed_utc: datetime_landed_utc ?? undefined,
      last_seen_utc: last_seen_utc ?? undefined,
    };
    if (flightEnded === true) {
      const landedForBar = datetime_landed_utc ?? last_seen_utc;
      if (landedForBar) base.fr24_datetime_landed_utc = landedForBar;
    }
    if (flightEnded === false && (first_seen_utc || datetime_takeoff_utc || datetime_landed_utc)) {
      base.flightStatus = deriveFr24LiveStatus(Date.now(), first_seen_utc, datetime_takeoff_utc, datetime_landed_utc);
    }
    // Bacak seçilen günden önceyse ve landed/parked ise eşleşme sayma (önceki gün verisi yok).
    const depForLegDate = depIso ?? first_seen_utc ?? datetime_takeoff_utc;
    const legOriginDate =
      utcIsoToLocalDateAtAirport(depForLegDate, origin) ?? (depForLegDate ? depForLegDate.slice(0, 10) : '');
    if (legOriginDate && legOriginDate < targetDay && (base.flightStatus === 'landed' || base.flightStatus === 'parked')) {
      console.log('[FR24] Picked leg is', legOriginDate, '(landed/parked); selected date is', targetDay, '→ no match');
      return null;
    }
    return base;
  } catch (err) {
    console.log('[FR24] Exception:', err);
    return null;
  }
}

function fr24WebUrlFromFlightInfo(flightNumber: string, date: string, info: FlightInfo | null): string {
  const callsign = info?.callsign?.trim()?.toUpperCase();
  const id = info?.fr24Id?.trim();
  if (id) {
    const digits = flightNumber.replace(/\s+/g, '').toUpperCase().match(/(\d+)/)?.[1] ?? '';
    const op = info?.operatedAs?.trim()?.toUpperCase();
    const slug =
      callsign && /^[A-Z0-9]{3,}$/.test(callsign)
        ? callsign
        : (op && digits ? `${op}${digits}` : (flightNumber.replace(/\s+/g, '').trim().toUpperCase() || 'FLIGHT'));
    return `https://www.flightradar24.com/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
  }
  if (callsign && info?.flightEnded === false) {
    return `https://fr24.com/${encodeURIComponent(callsign)}`;
  }
  const reg = info?.aircraftRegistration?.trim();
  if (reg) return `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(reg.toLowerCase())}`;
  const code = flightNumber.trim().toLowerCase().replace(/\s+/g, '');
  const base = `https://www.flightradar24.com/data/flights/${encodeURIComponent(code)}`;
  return date ? `${base}?date=${encodeURIComponent(date)}` : base;
}

/** Önce Edge (tek FR24 çağrısı, cooldown ortak); yoksa doğrudan API. */
export async function getFr24DeepLink(flightNumber: string, date: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('flight-lookup', {
      body: {
        mode: 'fr24_summary',
        flight_number: flightNumber,
        flight_date: date,
      },
    });
    if (!error && data && typeof data === 'object') {
      const raw = data as { info?: FlightInfo | null };
      if (raw.info) return fr24WebUrlFromFlightInfo(flightNumber, date, raw.info);
    }
    if (error) console.warn('[FlightAPI] flight-lookup fr24_summary', error.message);
  } catch (e) {
    console.warn('[FlightAPI] flight-lookup fr24_summary', e);
  }
  const info = await fetchFromFlightradar24(flightNumber, date);
  return fr24WebUrlFromFlightInfo(flightNumber, date, info);
}

// Aviation Stack API
async function fetchFromAviationStack(flightNumber: string, date: string): Promise<FlightInfo | null> {
  if (!AVIATION_KEY) {
    console.log('[AviationStack] No key');
    return null;
  }
  for (const num of flightNumberVariants(flightNumber)) {
    try {
      const url = `https://api.aviationstack.com/v1/flights?access_key=${AVIATION_KEY}&flight_iata=${encodeURIComponent(num)}&flight_date=${date}&limit=5`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        console.log('[AviationStack] Error for', num, ':', data.error.info || data.error.message);
        continue;
      }
      const list = data.data;
      if (!list || list.length === 0) continue;
      const f = list[0];
      const dep = f.departure ?? {};
      const arr = f.arrival ?? {};
      const origin = dep.iata ?? dep.icao ?? '';
      const destination = arr.iata ?? arr.icao ?? '';
      if (!origin && !destination) continue;
      const depTimeScheduled = dep.scheduled;
      const arrTimeScheduled = arr.scheduled;
      const delayDep = Number(dep.delay) || 0;
      const delayArr = Number(arr.delay) || 0;
      const delayed = delayDep > 0 || delayArr > 0;
      console.log('[AviationStack] Found:', origin, '→', destination, delayed ? '(delayed)' : '');
      return {
        origin,
        destination,
        originCity: dep.airport ?? dep.timezone?.split('/')[1],
        destinationCity: arr.airport ?? arr.timezone?.split('/')[1],
        depTime: parseTime(depTimeScheduled ?? dep.estimated),
        arrTime: parseTime(arrTimeScheduled ?? arr.estimated),
        scheduled_departure_utc: toUtcIsoStrict(depTimeScheduled),
        scheduled_arrival_utc: toUtcIsoStrict(arrTimeScheduled),
        airline: f.airline?.name,
        aircraftRegistration: f.aircraft?.iata ?? f.aircraft?.icao ?? undefined,
        delayed,
      };
    } catch (err) {
      console.log('[AviationStack] Exception for', num, ':', err);
      continue;
    }
  }
  return null;
}

// Flight lookup: Aviation Edge (primary) then Flightradar24
async function maybeEnrichWithFr24LiveMetrics(
  flightNumber: string,
  date: string,
  base: FlightInfo
): Promise<FlightInfo> {
  // Only useful for near-present flights. Avoid unnecessary FR24 calls for far-future schedules.
  const min = getLocalDateStringPlusDays(-1);
  const max = getLocalDateStringPlusDays(1); // include near-midnight / early-next-day flights (still cost-limited by roster filters)
  if (date < min || date > max) return base;
  if (!FR24_TOKEN) return base;
  // If already landed/parked/cancelled/etc, no need for live metrics.
  if (base.flightStatus && ['landed', 'parked', 'cancelled', 'diverted', 'incident', 'redirected'].includes(base.flightStatus)) {
    return base;
  }
  const fr = await fetchFromFlightradar24(flightNumber, date);
  if (!fr) return base;
  // Merge: keep Aviation Edge (or other) times/route as authoritative; add FR24 identifiers + live metrics when present.
  const merged: FlightInfo = {
    ...base,
    fr24Id: base.fr24Id ?? fr.fr24Id,
    hex: base.hex ?? fr.hex,
    operatedAs: base.operatedAs ?? fr.operatedAs,
    callsign: base.callsign ?? fr.callsign,
    flightEnded: base.flightEnded ?? fr.flightEnded,
    groundSpeedKts: base.groundSpeedKts ?? fr.groundSpeedKts,
    altitudeFt: base.altitudeFt ?? fr.altitudeFt,
    latitude: base.latitude ?? fr.latitude,
    longitude: base.longitude ?? fr.longitude,
    lastTrackUtc: base.lastTrackUtc ?? fr.lastTrackUtc,
  };
  // Statü merge kaldırıldı — baştan yazılacak. merged.flightStatus burada türetilmiyor.
  if (fr.actual_arrival_utc) merged.actual_arrival_utc = fr.actual_arrival_utc;
  if (fr.actual_departure_utc) merged.actual_departure_utc = fr.actual_departure_utc ?? merged.actual_departure_utc;
  return merged;
}

/**
 * When FR says flight_ended === true, use Aviation Edge timetable for the given date only.
 * AE buldu → cancelled/diverted ise statusMapped; değilse CHECK_TIME_1. Fallback yok.
 */
async function resolveAeTimetableWhenFrEnded(
  raw: string,
  date: string
): Promise<FlightInfo | null> {
  const now = Date.now();
  const ae = await fetchFromAviationEdgeTimetable(raw, date, { useFullStatus: true });
  if (ae && (ae.origin || ae.destination)) return applyAeStatusByFlowchart(ae, now);
  return null;
}

/** AE sonucu: cancelled/diverted → statusMapped; diğer → CHECK_TIME_1 (actual vs now → Scheduled/En-Route/Landed). */
function applyAeStatusByFlowchart(info: FlightInfo, nowMs: number): FlightInfo {
  const status = info.flightStatus;
  if (status === 'cancelled' || status === 'diverted') return info;
  const derived = deriveAeStatusFromActualTimes(nowMs, info.actual_departure_utc, info.actual_arrival_utc);
  if (derived) return { ...info, flightStatus: derived };
  return info;
}

/** AirLabs /flight fallback (closest leg; not strict by selected date). */
async function fetchFromAirLabsFlight(flightNumber: string): Promise<FlightInfo | null> {
  if (!AIRLABS_KEY) return null;
  if (await isFlightProviderInCooldown(FLIGHT_PROVIDER_AIRLABS)) return null;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw) return null;
  const variants = flightNumberVariants(raw);
  for (const v of variants) {
    try {
      const useIcao = /^[A-Z]{3}\d+$/.test(v);
      const qs = useIcao ? `flight_icao=${encodeURIComponent(v)}` : `flight_iata=${encodeURIComponent(v)}`;
      const url = `https://airlabs.co/api/v9/flight?${qs}&api_key=${encodeURIComponent(AIRLABS_KEY)}`;
      const res = await fetch(url);
      if (res.status === 429) {
        await applyFlightProviderCooldownFromResponse(FLIGHT_PROVIDER_AIRLABS, res);
        break;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) continue;
      const f: any = json?.response ?? json;
      if (!f || typeof f !== 'object') continue;
      const depIso = toUtcIsoAssumeUtc(f.dep_time_utc ?? f.dep_time);
      const arrIso = toUtcIsoAssumeUtc(f.arr_time_utc ?? f.arr_time);
      const depActualIso = toUtcIsoAssumeUtc(f.dep_actual_utc ?? f.dep_actual);
      const arrActualIso = toUtcIsoAssumeUtc(f.arr_actual_utc ?? f.arr_actual);
      const mapped = mapAviationEdgeStatus(typeof f.status === 'string' ? f.status : undefined);
      const out: FlightInfo = {
        origin: toIataCode(f.dep_iata ?? f.dep_icao ?? '') ?? '',
        destination: toIataCode(f.arr_iata ?? f.arr_icao ?? '') ?? '',
        originCity: typeof f.dep_city === 'string' ? f.dep_city : undefined,
        destinationCity: typeof f.arr_city === 'string' ? f.arr_city : undefined,
        depTime: parseTime(f.dep_time ?? f.dep_estimated ?? f.dep_time_utc ?? f.dep_estimated_utc),
        arrTime: parseTime(f.arr_time ?? f.arr_estimated ?? f.arr_time_utc ?? f.arr_estimated_utc),
        scheduled_departure_utc: depIso,
        scheduled_arrival_utc: arrIso,
        actual_departure_utc: depActualIso,
        actual_arrival_utc: arrActualIso,
        airline: typeof f.airline_name === 'string' ? f.airline_name : undefined,
        aircraftRegistration: typeof f.reg_number === 'string' ? f.reg_number : undefined,
        hex: typeof f.hex === 'string' ? f.hex : undefined,
        flightStatus: mapped,
        delayed: Number(f.dep_delayed ?? f.arr_delayed ?? f.delayed ?? 0) > 0,
        delayDepMin: Number.isFinite(Number(f.dep_delayed)) ? Number(f.dep_delayed) : undefined,
        delayArrMin: Number.isFinite(Number(f.arr_delayed)) ? Number(f.arr_delayed) : undefined,
        airlabsProgressPercent: Number.isFinite(Number(f.percent)) ? Number(f.percent) : undefined,
      };
      if (out.origin || out.destination || out.scheduled_departure_utc || out.scheduled_arrival_utc) return out;
    } catch {
      continue;
    }
  }
  return null;
}

function aeroCoerceTimeString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.utc === 'string' && o.utc.trim()) return o.utc.trim();
    if (typeof o.local === 'string' && o.local.trim()) return o.local.trim();
  }
  return undefined;
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

function aeroLegAirportAndCity(leg: Record<string, unknown>): { code: string; city: string | undefined } {
  const ap = leg.airport;
  if (ap && typeof ap === 'object') {
    const a = ap as Record<string, unknown>;
    const iata = typeof a.iata === 'string' ? a.iata.trim() : '';
    const icao = typeof a.icao === 'string' ? a.icao.trim() : '';
    const code = (iata || icao || '').toUpperCase().slice(0, 4);
    const city =
      typeof a.municipalityName === 'string'
        ? a.municipalityName.trim()
        : typeof a.name === 'string'
        ? a.name.trim()
        : undefined;
    return { code, city: city || undefined };
  }
  const flat =
    (typeof leg.iata === 'string' ? leg.iata : typeof leg.icao === 'string' ? leg.icao : '')?.trim().toUpperCase() ?? '';
  return { code: flat.slice(0, 4), city: undefined };
}

function mapAeroDataBoxStatusText(statusRaw: string | undefined): FlightStatusApi | undefined {
  if (!statusRaw) return undefined;
  const s = statusRaw.toLowerCase();
  if (s.includes('en-route') || s.includes('en route') || s.includes('airborne')) return 'en_route';
  if (s.includes('scheduled')) return 'scheduled';
  if (s.includes('landed') || s.includes('arrived')) return 'landed';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('divert')) return 'diverted';
  return undefined;
}

function timetableNeedsAeroFillFlightInfo(al: FlightInfo | null): boolean {
  if (!al) return true;
  const noSched = !al.scheduled_departure_utc || !al.scheduled_arrival_utc;
  const o = String(al.origin ?? '').trim();
  const d = String(al.destination ?? '').trim();
  const noRoute = !o || !d;
  const noCity = !al.originCity || !al.destinationCity;
  return noSched || noRoute || noCity;
}

function mergeAirLabsWithAeroFlightInfo(al: FlightInfo | null, adb: FlightInfo | null): FlightInfo | null {
  if (!al && !adb) return null;
  if (!al) return adb;
  if (!adb) return al;
  const schedDep = al.scheduled_departure_utc ?? adb.scheduled_departure_utc;
  const schedArrRaw = al.scheduled_arrival_utc ?? adb.scheduled_arrival_utc;
  const schedArr = normalizeOvernightArrival(schedDep, schedArrRaw);
  return {
    ...al,
    origin: String(al.origin ?? '').trim() || adb.origin,
    destination: String(al.destination ?? '').trim() || adb.destination,
    originCity: al.originCity ?? adb.originCity,
    destinationCity: al.destinationCity ?? adb.destinationCity,
    scheduled_departure_utc: schedDep,
    scheduled_arrival_utc: schedArr,
    actual_departure_utc: al.actual_departure_utc ?? adb.actual_departure_utc,
    actual_arrival_utc: al.actual_arrival_utc ?? adb.actual_arrival_utc,
    depTime: (al.depTime as string) || (adb.depTime as string) || '',
    arrTime: (al.arrTime as string) || (adb.arrTime as string) || '',
    flightStatus: al.flightStatus ?? adb.flightStatus,
    delayDepMin: al.delayDepMin ?? adb.delayDepMin,
    delayArrMin: al.delayArrMin ?? adb.delayArrMin,
    delayed: al.delayed ?? adb.delayed,
    airlabsProgressPercent: al.airlabsProgressPercent ?? adb.airlabsProgressPercent,
    divertedTo: al.divertedTo ?? adb.divertedTo,
  };
}

/** Havalimanı tahtası ve `/flights/number/` yanıtları aynı bacak şeklini kullanır (`departure` / `arrival`). */
export function flightInfoFromAeroDataBoxRoot(root: Record<string, unknown>): FlightInfo | null {
  const { dep, arr } = aeroRootLegs(root);
  const depSched = toUtcIsoAssumeUtc(
    aeroCoerceTimeString(dep.scheduledTimeUtc) ??
      aeroCoerceTimeString(dep.scheduledTime) ??
      aeroCoerceTimeString(dep.scheduledTimeLocal),
  );
  const arrSched = toUtcIsoAssumeUtc(
    aeroCoerceTimeString(arr.scheduledTimeUtc) ??
      aeroCoerceTimeString(arr.scheduledTime) ??
      aeroCoerceTimeString(arr.scheduledTimeLocal),
  );
  const depExp = toUtcIsoAssumeUtc(
    aeroCoerceTimeString(dep.predictedTimeUtc) ??
      aeroCoerceTimeString(dep.predictedTime) ??
      aeroCoerceTimeString(dep.estimatedTimeUtc) ??
      aeroCoerceTimeString(dep.estimatedTime) ??
      aeroCoerceTimeString(dep.expectedTimeUtc) ??
      aeroCoerceTimeString(dep.expectedTime),
  );
  const arrExp = toUtcIsoAssumeUtc(
    aeroCoerceTimeString(arr.predictedTimeUtc) ??
      aeroCoerceTimeString(arr.predictedTime) ??
      aeroCoerceTimeString(arr.estimatedTimeUtc) ??
      aeroCoerceTimeString(arr.estimatedTime) ??
      aeroCoerceTimeString(arr.expectedTimeUtc) ??
      aeroCoerceTimeString(arr.expectedTime),
  );
  const depIso = depSched ?? depExp;
  const arrIsoRaw = arrSched ?? arrExp;
  const arrIso = normalizeOvernightArrival(depIso, arrIsoRaw);
  const depActual = toUtcIsoAssumeUtc(
    aeroCoerceTimeString(dep.actualTimeUtc) ??
      aeroCoerceTimeString(dep.actualTime) ??
      aeroCoerceTimeString(dep.runwayTimeUtc),
  );
  const arrActual = toUtcIsoAssumeUtc(
    aeroCoerceTimeString(arr.actualTimeUtc) ??
      aeroCoerceTimeString(arr.actualTime) ??
      aeroCoerceTimeString(arr.runwayTimeUtc),
  );
  const depAp = aeroLegAirportAndCity(dep);
  const arrAp = aeroLegAirportAndCity(arr);
  const origin = toIataCode(depAp.code || (dep.iata as string) || (dep.icao as string) || '') ?? '';
  const destination = toIataCode(arrAp.code || (arr.iata as string) || (arr.icao as string) || '') ?? '';
  const stNode = root.status;
  const statusText =
    stNode && typeof stNode === 'object' && 'text' in (stNode as object)
      ? String((stNode as { text?: string }).text ?? '')
      : typeof stNode === 'string'
      ? stNode
      : '';
  const mapped = mapAeroDataBoxStatusText(statusText.trim() || undefined);
  const divertedTo =
    mapped === 'diverted' || statusText.toLowerCase().includes('divert')
      ? (toIataCode(arrAp.code) ?? (arrAp.code || undefined))
      : undefined;
  if (!depIso && !arrIso && !origin && !destination) return null;
  return {
    origin,
    destination,
    originCity: depAp.city,
    destinationCity: arrAp.city,
    depTime: parseTime(depIso),
    arrTime: parseTime(arrIso),
    scheduled_departure_utc: depIso,
    scheduled_arrival_utc: arrIso,
    actual_departure_utc: depActual,
    actual_arrival_utc: arrActual,
    flightStatus: mapped,
    divertedTo,
  };
}

async function fetchFromAeroDataBoxFlight(flightNumber: string, date: string): Promise<FlightInfo | null> {
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw) return null;
  const variants = flightNumberVariants(raw).slice(0, 6);
  const sources: Array<{ urls: string[]; headers: Record<string, string> }> = [
    {
      urls: variants.flatMap((v) => [
        `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(date)}?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
        `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(date)}T00:00?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
      ]),
      headers: {
        'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
        'x-rapidapi-key': AERODATABOX_RAPIDAPI_KEY,
      },
    },
  ];
  if (AERODATABOX_APIMARKET_BASE && AERODATABOX_APIMARKET_KEY) {
    const b = AERODATABOX_APIMARKET_BASE.replace(/\/$/, '');
    sources.push({
      urls: variants.flatMap((v) => [
        `${b}/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(date)}?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
        `${b}/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(date)}T00:00?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
      ]),
      headers: {
        'x-api-key': AERODATABOX_APIMARKET_KEY,
        Authorization: `Bearer ${AERODATABOX_APIMARKET_KEY}`,
        'User-Agent': 'Mozilla/5.0 FlyFam/1.0',
      },
    });
  }
  for (const src of sources) {
    for (const url of src.urls) {
      try {
        const res = await fetch(url, { headers: src.headers });
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        const root = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
        if (!root || typeof root !== 'object') continue;
        const info = flightInfoFromAeroDataBoxRoot(root);
        if (info) return info;
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function fetchFromTimetablePrimary(flightNumber: string, date: string): Promise<FlightInfo | null> {
  const al = await fetchFromAirLabsFlight(flightNumber);
  if (!timetableNeedsAeroFillFlightInfo(al)) return al;
  const adb = await fetchFromAeroDataBoxFlight(flightNumber, date);
  return mergeAirLabsWithAeroFlightInfo(al, adb);
}

/** PC2264 varış meydanı her zaman Bodrum (BJV). */
function normalizeDestinationForFlight(flightNumber: string, info: FlightInfo | null): FlightInfo | null {
  if (!info) return null;
  const r = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (r !== 'PC2264') return info;
  return { ...info, destination: 'BJV', destinationCity: 'Bodrum' };
}

async function fetchFlightByNumberDirect(
  flightNumber: string,
  date: string
): Promise<FlightInfo | null> {
  const raw = flightNumber.replace(/\s/g, '').trim();
  if (!raw || date.length !== 10) {
    console.log('[FlightAPI] Invalid input:', raw, date);
    return null;
  }
  console.log('[FlightAPI] Looking up', raw, 'on', date);
  const debug = raw.toUpperCase() === 'PC615';
  const debug2088 = raw.toUpperCase() === 'PC2088';
  const debug2550 = raw.toUpperCase() === 'PC2550';
  const debug656 = raw.toUpperCase() === 'PC656';

  // Bugün / yarın: önce AirLabs /flight (tek “en yakın” bacak). flight_date yine kullanıcı seçimi; FR24 ile sonrasında hizalanır.
  if (isLocalTodayOrTomorrow(date)) {
    const alNearest = await fetchFromTimetablePrimary(raw, date);
    if (
      alNearest &&
      isFlightInfoMatchingSelectedDate(alNearest, date) &&
      (alNearest.scheduled_departure_utc ||
        alNearest.scheduled_arrival_utc ||
        (alNearest.origin && alNearest.destination))
    ) {
      console.log('[FlightAPI] Local today/tomorrow → AirLabs nearest');
      // AirLabs tek kayıtta sık sık *bir önceki* inmiş seferi verir; landed + actual_* yanlış yazılmasın.
      const { flightStatus: _fs, actual_departure_utc: _ad, actual_arrival_utc: _aa, ...restNearest } = alNearest;
      return normalizeDestinationForFlight(raw, { ...restNearest });
    }
  }

  // 1) FR24: flight_ended bak.
  const fr = await fetchFromFlightradar24(raw, date);
  if (debug2088) console.log('[FlightAPI PC2088] FR24 result:', fr ? { origin: fr.origin, destination: fr.destination, flightStatus: fr.flightStatus, flightEnded: fr.flightEnded } : null);
  if (debug2550) console.log('[FlightAPI PC2550] FR24 result:', fr ? { origin: fr.origin, destination: fr.destination, schedDep: fr.scheduled_departure_utc, schedArr: fr.scheduled_arrival_utc, flightEnded: fr.flightEnded } : 'null');
  if (debug656) console.log('[FlightAPI PC656] FR24 result:', fr ? { flightStatus: fr.flightStatus, flightEnded: fr.flightEnded, datetime_landed_utc: fr.datetime_landed_utc, last_seen_utc: fr.last_seen_utc } : 'null');
  async function fillScheduledFromAirLabs(info: FlightInfo): Promise<FlightInfo> {
    if (info.scheduled_departure_utc && info.scheduled_arrival_utc) return info;
    const al = await fetchFromTimetablePrimary(raw, date);
    if (!isFlightInfoMatchingSelectedDateRelaxed(al, date, { origin: info.origin, destination: info.destination })) {
      return info;
    }
    if (!al?.scheduled_departure_utc && !al?.scheduled_arrival_utc) return info;
    return {
      ...info,
      scheduled_departure_utc: info.scheduled_departure_utc ?? al.scheduled_departure_utc,
      scheduled_arrival_utc: info.scheduled_arrival_utc ?? al.scheduled_arrival_utc,
      depTime: info.depTime || (al.scheduled_departure_utc ? parseTime(al.scheduled_departure_utc) : ''),
      arrTime: info.arrTime || (al.scheduled_arrival_utc ? parseTime(al.scheduled_arrival_utc) : ''),
      // Keep explicit FR/AE status unless empty.
      flightStatus: info.flightStatus ?? al.flightStatus,
      delayDepMin: info.delayDepMin ?? al.delayDepMin,
      delayArrMin: info.delayArrMin ?? al.delayArrMin,
      delayed: info.delayed ?? al.delayed,
      airlabsProgressPercent: info.airlabsProgressPercent ?? al.airlabsProgressPercent,
    };
  }

  function fillScheduledFromFr24Operational(info: FlightInfo): FlightInfo {
    if (info.scheduled_departure_utc && info.scheduled_arrival_utc) return info;
    const dep = info.scheduled_departure_utc ?? info.datetime_takeoff_utc ?? info.first_seen_utc;
    const arrRaw = info.scheduled_arrival_utc ?? info.datetime_landed_utc ?? info.fr24_datetime_landed_utc ?? info.last_seen_utc;
    const arr = normalizeOvernightArrival(dep, arrRaw);
    if (!dep && !arr) return info;
    return {
      ...info,
      scheduled_departure_utc: info.scheduled_departure_utc ?? dep,
      scheduled_arrival_utc: info.scheduled_arrival_utc ?? arr,
      depTime: info.depTime || (dep ? parseTime(dep) : ''),
      arrTime: info.arrTime || (arr ? parseTime(arr) : ''),
    };
  }

  if (fr && (fr.origin || fr.destination)) {
    if (fr.flightEnded === true) {
      const alResult = await fetchFromTimetablePrimary(raw, date);
      if (alResult && (alResult.origin || alResult.destination || alResult.scheduled_departure_utc || alResult.scheduled_arrival_utc)) {
        console.log('[FlightAPI] FR24 flight_ended true → AirLabs fallback');
        return normalizeDestinationForFlight(raw, alResult);
      }
      // Landed: datetime_landed; yoksa fetchFromFlightradar24 last_seen → fr24_datetime_landed_utc (ended bacaklar).
      let out: FlightInfo = fr;
      const today = getLocalDateStringPlusDays(0);
      const isFutureSelectedDate = typeof date === 'string' && date > today;
      if (isFutureSelectedDate) {
        out = { ...fr, flightStatus: 'scheduled' };
        out = await fillScheduledFromAirLabs(out);
        return normalizeDestinationForFlight(raw, out);
      }
      const landedIso = fr.datetime_landed_utc ?? fr.fr24_datetime_landed_utc;
      const landedMs = landedIso ? new Date(landedIso).getTime() : 0;
      const nowMs = Date.now();
      if (Number.isFinite(landedMs) && landedMs > 0 && nowMs >= landedMs) {
        out = { ...fr, flightStatus: 'landed' };
      } else if (
        fr.flightStatus === 'en_route' &&
        fr.last_seen_utc &&
        Number.isFinite(new Date(fr.last_seen_utc).getTime()) &&
        nowMs >= new Date(fr.last_seen_utc).getTime()
      ) {
        // Yalnızca en_route görünen ended bacaklarda last_seen ile landed'a çek.
        out = { ...fr, flightStatus: 'landed', fr24_datetime_landed_utc: fr.last_seen_utc };
      } else {
        out = { ...fr, flightStatus: 'scheduled' };
      }
      // FR24 bitmiş uçuşlarda çoğu zaman scheduled vermiyor; scheduled yoksa AirLabs'den doldur.
      out = await fillScheduledFromAirLabs(out);
      return normalizeDestinationForFlight(raw, out);
    }
    if (fr.flightEnded === false) {
      let out: FlightInfo = fr;
      out = await fillScheduledFromAirLabs(out);
      if (!out.scheduled_departure_utc || !out.scheduled_arrival_utc) {
        const adb = await fetchFromAeroDataBoxFlight(raw, date);
        if (adb && isFlightInfoMatchingSelectedDateRelaxed(adb, date, { origin: out.origin, destination: out.destination })) {
          out = {
            ...out,
            scheduled_departure_utc: out.scheduled_departure_utc ?? adb.scheduled_departure_utc,
            scheduled_arrival_utc: out.scheduled_arrival_utc ?? adb.scheduled_arrival_utc,
            depTime: out.depTime || (adb.scheduled_departure_utc ? parseTime(adb.scheduled_departure_utc) : ''),
            arrTime: out.arrTime || (adb.scheduled_arrival_utc ? parseTime(adb.scheduled_arrival_utc) : ''),
          };
        }
      }
      out = fillScheduledFromFr24Operational(out);
      if (debug2088) console.log('[FlightAPI PC2088] Returning from FR24:', { flightStatus: out.flightStatus });
      if (debug2550) console.log('[FlightAPI PC2550] Returning from FR24 path:', { schedDep: out.scheduled_departure_utc, schedArr: out.scheduled_arrival_utc, flightStatus: out.flightStatus });
      return normalizeDestinationForFlight(raw, out);
    }
  }

  // 2) FR24 yok: AirLabs /flight fallback.
  if (debug) console.log('[Debug PC615] timetable: no match');

  // 3) AirLabs /flight son fallback.
  const airlabsOnly = await fetchFromTimetablePrimary(raw, date);
  if (
    airlabsOnly &&
    isFlightInfoMatchingSelectedDate(airlabsOnly, date) &&
    (airlabsOnly.origin || airlabsOnly.destination || airlabsOnly.scheduled_departure_utc || airlabsOnly.scheduled_arrival_utc)
  ) {
    console.log('[FlightAPI] No FR24 → AirLabs fallback');
    return normalizeDestinationForFlight(raw, airlabsOnly);
  }

  if (debug2550) console.log('[FlightAPI PC2550] No result from any API (dash will stay until one returns scheduled times).');
  console.log('[FlightAPI] No result from AirLabs or Flightradar24');
  try {
    const { findAirportBoardCacheFlight } = await import('./airportBoardCache');
    const cached = await findAirportBoardCacheFlight(raw, date);
    if (cached) {
      console.log('[FlightAPI] Airport board cache hit');
      return normalizeDestinationForFlight(raw, cached);
    }
  } catch (e) {
    console.warn('[FlightAPI] airport board cache', e);
  }
  return null;
}

/** Önce Edge `flight-lookup` (mode: by_number); başarısızsa doğrudan API. */
export async function fetchFlightByNumber(flightNumber: string, date: string): Promise<FlightInfo | null> {
  try {
    const { data, error } = await supabase.functions.invoke('flight-lookup', {
      body: {
        mode: 'by_number',
        flight_number: flightNumber,
        flight_date: date,
        local_today: getLocalDateString(),
        local_tomorrow: getLocalDateStringTomorrow(),
      },
    });
    if (!error && data && typeof data === 'object') {
      const raw = data as { info?: FlightInfo | null };
      if (raw.info !== undefined) {
        return raw.info ?? null;
      }
    }
    if (error) {
      console.warn('[FlightAPI] flight-lookup by_number', error.message);
    }
  } catch (e) {
    console.warn('[FlightAPI] flight-lookup by_number', e);
  }
  return fetchFlightByNumberDirect(flightNumber, date);
}
