import Constants from 'expo-constants';
import { getAirportDisplay } from '../constants/airports';
import { getLocalDateStringPlusDays } from './dateUtils';

const AVIATION_EDGE_KEY =
  Constants.expoConfig?.extra?.aviationEdgeKey ?? process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY;
const FR24_TOKEN =
  Constants.expoConfig?.extra?.flightradar24Token ?? process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN;
const AVIATION_KEY =
  Constants.expoConfig?.extra?.aviationStackKey ?? process.env.EXPO_PUBLIC_AVIATION_STACK_API_KEY;
const RAPIDAPI_KEY =
  Constants.expoConfig?.extra?.rapidApiKey ?? process.env.EXPO_PUBLIC_RAPIDAPI_KEY;

/** True if at least one flight lookup API key is set (Aviation Edge or Flightradar24). */
export const hasFlightApiKeys = !!AVIATION_EDGE_KEY || !!FR24_TOKEN;

/** Aviation Edge timetable status values; we store and display these when present. */
export type FlightStatusApi =
  | 'scheduled'
  | 'en_route'
  | 'landed'
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
  /** Live status from API (e.g. Aviation Edge timetable). When set, app uses this instead of time-based guess. */
  flightStatus?: FlightStatusApi;
  /**
   * True when we could not find schedule for the selected date and fell back to a previous day's scheduled times.
   * UI should show a warning and re-check later; when confirmed schedule arrives, this becomes false.
   */
  scheduleUnconfirmed?: boolean;
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

async function fetchFr24LastTrackPoint(fr24Id: string): Promise<{
  groundSpeedKts?: number;
  altitudeFt?: number;
  latitude?: number;
  longitude?: number;
  lastTrackUtc?: string;
} | null> {
  if (!FR24_TOKEN) return null;
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

function utcIsoToLocalDateAtAirport(utcIso: string | undefined, airportCode: string | undefined): string | undefined {
  if (!utcIso || !airportCode) return undefined;
  const offsetMin = getAirportOffsetMinutes(airportCode);
  const ms = new Date(utcIso).getTime();
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + offsetMin * 60 * 1000).toISOString().slice(0, 10);
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

// IATA -> ICAO for MVP airlines (Flightradar24 often uses ICAO in data)
const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS' };

// Build variants of flight number (e.g. PC614 -> PC614, PC0614, PGT614 for FR24)
function flightNumberVariants(flightNumber: string): string[] {
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const variants = [raw];
  const match = raw.match(/^([A-Z]{2})(\d+)$/);
  if (match) {
    const code = match[1];
    const num = match[2];
    if (num.length === 3) variants.push(`${code}0${num}`); // PC614 -> PC0614
    if (num.length === 4 && num.startsWith('0')) variants.push(`${code}${num.slice(1)}`); // PC0614 -> PC614
    const icao = IATA_TO_ICAO[code];
    if (icao) {
      variants.push(`${icao}${num}`);   // PC614 -> PGT614
      if (num.length === 3) variants.push(`${icao}0${num}`);
    }
  }
  return [...new Set(variants)];
}

// Airline (IATA 2-letter) -> hub airports to try for Aviation Edge Future Schedules
const AIRLINE_HUBS: Record<string, string[]> = {
  PC: ['IST', 'SAW', 'ADB', 'AYT', 'ESB'], // Pegasus
  TK: ['IST', 'SAW', 'ESB', 'ADB'],         // Turkish Airlines
  XQ: ['ADB', 'AYT', 'IST', 'SAW'],         // SunExpress
};
const FALLBACK_HUBS = ['IST', 'SAW', 'LHR', 'FRA', 'AMS', 'CDG', 'MAD', 'BCN'];

/** Airport (ICAO or IATA) → UTC offset in minutes (e.g. Turkey +180 = UTC+3). Used when APIs return local time. */
const AIRPORT_UTC_OFFSET_MINUTES: Record<string, number> = {
  // Turkey (UTC+3)
  IST: 180, LTFM: 180, SAW: 180, LTFJ: 180, ADB: 180, LTAF: 180, AYT: 180, LTAI: 180,
  ESB: 180, LTFB: 180, BJV: 180, DLM: 180, LTBS: 180, IZM: 180, TZX: 180, ADA: 180,
  GZP: 180, LTGP: 180, ASR: 180, LTAU: 180, KYA: 180, LTAN: 180, GZT: 180, LTAJ: 180,
  VAN: 180, LTCI: 180, ERZ: 180, LTCE: 180, DIY: 180, LTCC: 180, SZF: 180, EDO: 180, LTFD: 180,
  // Cyprus (UTC+2) (DST ignored; good enough for date matching in winter)
  ECN: 120, LCEN: 120, LCA: 120, LCLK: 120, PFO: 120,
  // UK (UTC+0)
  LHR: 0, EGLL: 0, LGW: 0, EGKK: 0, STN: 0, EGSS: 0, MAN: 0, EGCC: 0, EDI: 0, EGPH: 0,
  BHX: 0, EGBB: 0, BRS: 0, EGGD: 0, NCL: 0, EGNT: 0, LPL: 0, EGGP: 0, BFS: 0, EGAA: 0,
  // Europe CET (UTC+1)
  FRA: 60, EDDF: 60, MUC: 60, EDDM: 60, DUS: 60, EDDL: 60, BER: 60, EDDB: 60,
  CDG: 60, LFPG: 60, ORY: 60, LFPO: 60, LYS: 60, MRS: 60,
  MAD: 60, LEMD: 60, BCN: 60, LEBL: 60, SVQ: 60, LEZL: 60,
  AMS: 60, EHAM: 60, BRU: 60, EBBR: 60, ZRH: 60, LSZH: 60, VIE: 60, LOWW: 60,
  PRG: 60, LKPR: 60, CPH: 60, EKCH: 60, HEL: 60, EFHK: 60,
  ATH: 60, LGAV: 60, LIS: 60, LPPT: 60, OPO: 60, DUB: 60, EIDW: 60,
  WAW: 60, EPWA: 60, KRK: 60, EPKK: 60, OSL: 60, ENGM: 60, ARN: 60, ESSA: 60,
  GVA: 60, LSGG: 60, BSL: 60, LFSB: 60, CGN: 60, EDDK: 60, HAM: 60, EDDH: 60,
  STR: 60, EDDS: 60, NUE: 60, EDDN: 60, LEJ: 60, EDDP: 60, EIN: 60, EHEH: 60, RTM: 60, EHRD: 60,
  BLQ: 60, LIPE: 60, BUD: 60, LHBP: 60, BEG: 60, LYBE: 60, BTS: 60, LZIB: 60,
  // Europe EET (UTC+2)
  RHO: 120, HER: 120, CHQ: 120, SKG: 120, LGTS: 120, TIA: 120, LATI: 120,
  ZAG: 120, LDZA: 120, SJJ: 120, LQSA: 120, SOF: 120, LBSF: 120, OTP: 120, LROP: 120,
  SKP: 120, LWSK: 120, PRN: 120, BKPR: 120, KIV: 120, LUKK: 120,
  // Cyprus, Greece islands (UTC+2)
  LCA: 120, LCLK: 120, PFO: 120, LCRA: 120,
  // Gulf
  // UAE (UTC+4)
  DXB: 240, OMDB: 240, SHJ: 240, AUH: 240, OMAA: 240,
  // Qatar, Bahrain, Kuwait (UTC+3)
  DOH: 180, OTHH: 180, OTBD: 180, BAH: 180, OBBI: 180, KWI: 180, OKBK: 180,
  // Oman (UTC+4)
  MCT: 240, OOMS: 240,
  // Pakistan (UTC+5)
  KHI: 300, OPKC: 300, ISB: 300, LHE: 300,
  // Iraq (UTC+3)
  BGW: 180, ORBI: 180,
  // Russia (UTC+3)
  SVO: 180, UUEE: 180, DME: 180, UUDD: 180, LED: 180, ULLI: 180,
};
function getAirportOffsetMinutes(icaoOrIata: string): number {
  if (!icaoOrIata) return 0;
  const key = icaoOrIata.toUpperCase().trim();
  return AIRPORT_UTC_OFFSET_MINUTES[key] ?? 0;
}

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

async function fetchFromAviationEdgeTimetable(flightNumber: string, date: string): Promise<FlightInfo | null> {
  if (!AVIATION_EDGE_KEY) return null;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const airlineCode = raw.match(/^[A-Z]{2}/)?.[0] ?? '';
  const hubs = AIRLINE_HUBS[airlineCode] ?? FALLBACK_HUBS;
  // Aviation Edge sometimes matches better with ICAO variants too (e.g. PGT615).
  const variants = flightNumberVariants(flightNumber).filter((v) => /^[A-Z]{2,3}\d+$/.test(v));
  const prevDate = plusIsoDay(date, -1);
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
            const offsetMin = getAirportOffsetMinutes(origin) || getAirportOffsetMinutes(airport);
            const depIso =
              hasOffset ? toUtcIsoStrict(rawTime)
              : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)
                ? localIsoToUtcIso(rawTime, offsetMin)
                : undefined;
            return utcIsoToLocalDateAtAirport(depIso, origin) ?? str.slice(0, 10);
          };

          // Crew-entered date is interpreted as ORIGIN local departure date.
          let f: any = list.find((x: any) => depLocalDate(x) === date) ?? null;

          let usedFallbackPrev = false;
          if (!f) {
            // 2) Fallback: use previous day's *scheduled* times (not estimated/actual),
            // and mark schedule as unconfirmed so UI shows a warning until corrected.
            f = list.find((x: any) => depLocalDate(x) === prevDate) ?? null;
            usedFallbackPrev = !!f;
          }

          if (!f || !f.departure || !f.arrival) continue;
          const dep = f.departure;
          const arr = f.arrival;
          const origin = (dep.icaoCode ?? dep.iataCode ?? '').toString().toUpperCase();
          const destination = (arr.icaoCode ?? arr.iataCode ?? '').toString().toUpperCase();
          if (!origin && !destination) continue;
          const depRaw = usedFallbackPrev ? dep.scheduledTime : (dep.scheduledTime ?? dep.estimatedTime);
          const arrRaw = usedFallbackPrev ? arr.scheduledTime : (arr.scheduledTime ?? arr.estimatedTime);
          if (usedFallbackPrev && (!depRaw || !arrRaw)) continue;
          const depStr = depRaw ? String(depRaw) : '';
          const arrStr = arrRaw ? String(arrRaw) : '';
          const depHasOffset = depStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(depStr);
          const arrHasOffset = arrStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(arrStr);
          const depOffsetMin = getAirportOffsetMinutes(origin) || getAirportOffsetMinutes(airport);
          const arrOffsetMin = getAirportOffsetMinutes(destination);
          const localDateForConvert = usedFallbackPrev ? prevDate : date;
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
          const flightStatus = usedFallbackPrev ? undefined : mapAviationEdgeStatus(apiStatus);
          // Prefer true actual time, then estimated (if actual missing).
          const depActualRaw = usedFallbackPrev ? null : (dep.actualTime ?? dep.estimatedTime);
          const arrActualRaw = usedFallbackPrev ? null : (arr.actualTime ?? arr.estimatedTime);
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
          // If we fell back to the previous day's schedule for a *future* date, shift times forward
          // so status logic doesn't treat the flight as already departed/arrived.
          const isFutureDay = date >= getLocalDateStringPlusDays(1);
          const shiftDays = usedFallbackPrev && isFutureDay ? 1 : 0;
          const depIsoShifted = shiftDays ? shiftUtcIsoByDays(depIso, shiftDays) : depIso;
          const arrIsoShifted0 = shiftDays ? shiftUtcIsoByDays(arrIso, shiftDays) : arrIso;
          const arrIsoShifted = normalizeOvernightArrival(depIsoShifted, arrIsoShifted0);

          console.log(
            '[AviationEdge Timetable] Found:',
            origin,
            '→',
            destination,
            apiStatus ?? '',
            `(${type})`,
            usedFallbackPrev ? '(fallback prev-day schedule)' : ''
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
            actual_departure_utc: (flightStatus === 'en_route' || flightStatus === 'landed') ? (depActualIso ?? depIso) : undefined,
            actual_arrival_utc: flightStatus === 'landed' ? (arrActualIso ?? arrIso) : undefined,
            airline: f.airline?.name,
            aircraftRegistration: f.aircraft?.regNumber,
            delayed: usedFallbackPrev ? undefined : (Number(dep.delay) > 0 || Number(arr.delay) > 0),
            flightStatus,
            scheduleUnconfirmed: usedFallbackPrev ? true : false,
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
          const depOffsetMin = getAirportOffsetMinutes(origin) || getAirportOffsetMinutes(airport);
          const arrOffsetMin = getAirportOffsetMinutes(destination);
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
          console.log('[AviationEdge Timetable] Found (route airports):', origin, '→', destination, `(${airport}/${type})`);
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
            flightStatus: mapAviationEdgeStatus(String(f.status ?? '')),
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
// Aviation Edge API – Live Flights (tracking)
// ---------------------------------------------------------------------------
// flights: live flights with tracking and status. Filter by flightIata.
// ---------------------------------------------------------------------------

async function fetchFromAviationEdgeFlights(flightNumber: string, date: string): Promise<FlightInfo | null> {
  if (!AVIATION_EDGE_KEY) return null;
  const variants = flightNumberVariants(flightNumber).filter((v) => /^[A-Z]{2,3}\d+$/.test(v));
  for (const flightNum of variants) {
    try {
      // /flights is primarily for live tracking (status/position) and does not reliably include times.
      // We use it to discover dep/arr airports, then pull times from timetable at those airports.
      const url = `https://aviation-edge.com/v2/public/flights?key=${encodeURIComponent(AVIATION_EDGE_KEY)}&flightIata=${encodeURIComponent(flightNum)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) continue;
      const list = Array.isArray(data) ? data : data?.data ?? [];
      if (!Array.isArray(list) || list.length === 0) continue;
      const live: any = list[0];

      const depIata = String(live?.departure?.iataCode ?? '').toUpperCase();
      const arrIata = String(live?.arrival?.iataCode ?? '').toUpperCase();
      const aircraftReg = (live?.aircraft?.regNumber ?? live?.aircraft?.registration) as string | undefined;
      const liveStatus = mapAviationEdgeStatus(String(live?.status ?? ''));
      // Live metrics from /flights (best-effort; units vary by provider).
      const liveLat = Number(live?.geography?.latitude ?? live?.geography?.lat ?? live?.latitude);
      const liveLon = Number(live?.geography?.longitude ?? live?.geography?.lon ?? live?.longitude);
      const liveAltRaw = Number(live?.altitude ?? live?.geography?.altitude ?? live?.alt);
      const liveSpdRaw = Number(live?.speed?.horizontal ?? live?.speed?.ground ?? live?.speed?.speed ?? live?.groundSpeed ?? live?.speed);
      // Guess units: if speed is very high (> 700) it's likely km/h; convert to knots for internal consistency.
      const spdKts = Number.isFinite(liveSpdRaw)
        ? (liveSpdRaw > 700 ? liveSpdRaw / 1.852 : liveSpdRaw)
        : NaN;
      // Guess altitude: if small (< 15000) and speed suggests km/h, it may be meters; convert to feet.
      const altFt = Number.isFinite(liveAltRaw)
        ? (liveAltRaw <= 15000 && liveSpdRaw > 700 ? liveAltRaw * 3.28084 : liveAltRaw)
        : NaN;

      for (const [airport, type] of [
        [depIata, 'departure'],
        [arrIata, 'arrival'],
      ] as const) {
        if (!airport) continue;
        const url2 = `https://aviation-edge.com/v2/public/timetable?key=${encodeURIComponent(AVIATION_EDGE_KEY)}&iataCode=${encodeURIComponent(airport)}&type=${type}&flight_iata=${encodeURIComponent(flightNum)}`;
        const res2 = await fetch(url2);
        const data2 = await res2.json().catch(() => null);
        if (!res2.ok) continue;
        const list2 = Array.isArray(data2) ? data2 : data2?.data ?? [];
        const row = list2.find((x: any) => {
          const depDate = String(x?.departure?.scheduledTime ?? '').slice(0, 10);
          const arrDate = String(x?.arrival?.scheduledTime ?? '').slice(0, 10);
          return depDate === date || arrDate === date;
        });
        if (!row || !row.departure || !row.arrival) continue;

        const dep = row.departure;
        const arr = row.arrival;
        const origin = (dep.icaoCode ?? dep.iataCode ?? '').toString().toUpperCase();
        const destination = (arr.icaoCode ?? arr.iataCode ?? '').toString().toUpperCase();
        if (!origin && !destination) continue;

        const depRaw = dep.scheduledTime ?? dep.estimatedTime;
        const arrRaw = arr.scheduledTime ?? arr.estimatedTime;
        const depStr = depRaw ? String(depRaw) : '';
        const arrStr = arrRaw ? String(arrRaw) : '';
        const depHasOffset = depStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(depStr);
        const arrHasOffset = arrStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(arrStr);
        const depOffsetMin = getAirportOffsetMinutes(origin) || getAirportOffsetMinutes(airport);
        const arrOffsetMin = getAirportOffsetMinutes(destination);

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

        const apiStatus = (row.status as string | undefined)?.toLowerCase();
        const flightStatus = mapAviationEdgeStatus(apiStatus) ?? liveStatus;

        // Prefer true actual time, then estimated (if actual missing).
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

        console.log('[AviationEdge Flights] Found (via timetable):', origin, '→', destination, apiStatus ?? '', `(${airport}/${type})`);
        return {
          origin,
          destination,
          originCity: getAirportDisplay(origin)?.city,
          destinationCity: getAirportDisplay(destination)?.city,
          depTime: parseTime(depRaw ?? undefined),
          arrTime: parseTime(arrRaw ?? undefined),
          scheduled_departure_utc: depIso,
          scheduled_arrival_utc: arrIso,
          actual_departure_utc: (flightStatus === 'en_route' || flightStatus === 'landed') ? (depActualIso ?? depIso) : undefined,
          actual_arrival_utc: flightStatus === 'landed' ? (arrActualIso ?? arrIso) : undefined,
          airline: row?.airline?.name ?? live?.airline?.iataCode ?? undefined,
          aircraftRegistration: row?.aircraft?.regNumber ?? aircraftReg,
          delayed: Number(dep.delay) > 0 || Number(arr.delay) > 0,
          flightStatus,
          groundSpeedKts: Number.isFinite(spdKts) ? spdKts : undefined,
          altitudeFt: Number.isFinite(altFt) ? altFt : undefined,
          latitude: Number.isFinite(liveLat) ? liveLat : undefined,
          longitude: Number.isFinite(liveLon) ? liveLon : undefined,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

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
  if (m.isGround === true && (base.flightStatus === 'en_route' || !base.flightStatus)) {
    merged.flightStatus = 'landed';
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Aviation Edge API – Future Schedules (dates after API minimum, e.g. 2026-02-26)
// ---------------------------------------------------------------------------
// flightsFuture requires an airport (iataCode). We try hub airports for the
// airline inferred from the flight number, then fallback hubs.
// ---------------------------------------------------------------------------

async function fetchFromAviationEdgeFuture(flightNumber: string, date: string): Promise<FlightInfo | null> {
  if (!AVIATION_EDGE_KEY) {
    console.log('[AviationEdge] No API key');
    return null;
  }
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const airlineCode = raw.match(/^[A-Z]{2}/)?.[0] ?? '';
  const hubs = AIRLINE_HUBS[airlineCode] ?? FALLBACK_HUBS;
  const iataVariants = flightNumberVariants(flightNumber).filter((v) => /^[A-Z]{2,3}\d+$/.test(v)); // "PC615" / "PGT615"
  const numericVariants = Array.from(
    new Set(iataVariants.map((v) => v.replace(/^\D+/, '')).filter((v) => /^\d+$/.test(v)))
  ); // "615" (Aviation Edge flightsFuture often expects numeric)
  const variants = Array.from(new Set([...iataVariants, ...numericVariants]));
  for (const airport of hubs) {
    for (const flightNum of variants) {
      for (const type of ['departure', 'arrival'] as const) {
        try {
          const url = `https://aviation-edge.com/v2/public/flightsFuture?key=${encodeURIComponent(AVIATION_EDGE_KEY)}&type=${type}&iataCode=${encodeURIComponent(airport)}&date=${date}&flight_num=${encodeURIComponent(flightNum)}`;
          const res = await fetch(url);
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            if (res.status === 404 || (data && !Array.isArray(data))) continue;
            console.log('[AviationEdge] Error:', res.status, data?.error ?? '');
            continue;
          }
          const list = Array.isArray(data) ? data : data?.data ?? [];
          const f = list[0];
          if (!f || !f.departure || !f.arrival) continue;
          const dep = f.departure;
          const arr = f.arrival;
          const origin = (dep.icaoCode ?? dep.iataCode ?? '').toString().toUpperCase();
          const destination = (arr.icaoCode ?? arr.iataCode ?? '').toString().toUpperCase();
          if (!origin && !destination) continue;
          const depTimeStr = dep.scheduledTime ?? dep.estimatedTime ?? '';
          const arrTimeStr = arr.scheduledTime ?? arr.estimatedTime ?? '';
          const depIso = localTimeToUtcIso(date, depTimeStr, getAirportOffsetMinutes(origin));
          const arrIso0 = localTimeToUtcIso(date, arrTimeStr, getAirportOffsetMinutes(destination));
          const arrIso = normalizeOvernightArrival(depIso, arrIso0);
          const originCity = getAirportDisplay(origin)?.city;
          const destinationCity = getAirportDisplay(destination)?.city;
          console.log('[AviationEdge] Found:', origin, '→', destination, `(${type})`);
          return {
            origin,
            destination,
            originCity,
            destinationCity,
            depTime: parseTime(depTimeStr ? `${date}T${depTimeStr}` : ''),
            arrTime: parseTime(arrTimeStr ? `${date}T${arrTimeStr}` : ''),
            scheduled_departure_utc: depIso ?? toUtcIsoStrict(depTimeStr),
            scheduled_arrival_utc: arrIso ?? toUtcIsoStrict(arrTimeStr),
            airline: f.airline?.name,
            aircraftRegistration: undefined,
            delayed: false,
          };
        } catch (err) {
          console.log('[AviationEdge] Exception for', airport, flightNum, err);
          continue;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flightradar24 API – which times we use
// ---------------------------------------------------------------------------
// We use SCHEDULED times as primary (what crew/family expect to see):
//   Departure: scheduled_departure_utc (fallback: scheduled_departure)
//   Arrival:   scheduled_arrival_utc  (fallback: scheduled_arrival)
// ---------------------------------------------------------------------------

async function fetchFromFlightradar24(flightNumber: string, date: string): Promise<FlightInfo | null> {
  if (!FR24_TOKEN) {
    console.log('[FR24] No token');
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
    const isFutureDay = targetDay >= getLocalDateStringPlusDays(1);
    // FR24 scheduled_* fields are UTC. A flight that departs just after midnight local time
    // (e.g. DOH 00:30 on 24th) may have a UTC date of the previous day (23rd).
    // So we accept +/- 1 day matches and prefer the exact match when present.
    const targetMinus1 = plusIsoDay(targetDay, -1);
    const targetPlus1 = plusIsoDay(targetDay, 1);
    const pickBest = (flights: typeof list) => {
      const pickFrom = (candidates: any[]) => {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;
        // Prefer currently tracked leg when available.
        const live = candidates.find((x) => x?.flight_ended === false || x?.flightEnded === false);
        if (live) return live;
        // Otherwise pick the most recent by scheduled departure / first_seen.
        const score = (x: any) => {
          const t = (x?.scheduled_departure_utc ?? x?.scheduled_departure ?? x?.first_seen ?? '') as string;
          const iso = toUtcIsoAssumeUtc(String(t));
          const ms = iso ? new Date(iso).getTime() : 0;
          return Number.isNaN(ms) ? 0 : ms;
        };
        return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
      };
      const getOriginLocalDepDate = (x: Record<string, unknown>) => {
        const origin = String((x.origin_icao ?? x.orig_icao ?? '') as string).toUpperCase();
        const depScheduled = (x.scheduled_departure_utc ?? x.scheduled_departure) as string | undefined;
        const depIso = toUtcIsoAssumeUtc(depScheduled);
        return utcIsoToLocalDateAtAirport(depIso, origin) ?? (depIso ? depIso.slice(0, 10) : '');
      };
      const exactMatches = flights.filter((x: Record<string, unknown>) => getOriginLocalDepDate(x) === targetDay);
      const exact = pickFrom(exactMatches as any[]);
      if (exact) return exact;
      const minus1Matches = flights.filter((x: Record<string, unknown>) => getOriginLocalDepDate(x) === targetMinus1);
      const minus1 = pickFrom(minus1Matches as any[]);
      if (minus1) return minus1;
      const plus1Matches = flights.filter((x: Record<string, unknown>) => getOriginLocalDepDate(x) === targetPlus1);
      return pickFrom(plus1Matches as any[]) ?? null;
    };
    const f = pickBest(list);
    if (!f) {
      console.log('[FR24] No flight on selected date', targetDay);
      return null;
    }
    const origin = (f.origin_icao ?? f.orig_icao ?? '') as string;
    const destination = (f.destination_icao_actual ?? f.destination_icao ?? f.dest_icao ?? '') as string;
    if (!origin && !destination) {
      console.log('[FR24] Flight found but no origin/destination');
      return null;
    }
    // Scheduled times: ONLY scheduled fields (do not fall back to actual takeoff/landing).
    const depScheduled = (f.scheduled_departure_utc ?? f.scheduled_departure) as string | undefined;
    const arrScheduled = (f.scheduled_arrival_utc ?? f.scheduled_arrival) as string | undefined;
    if (isFutureDay && !depScheduled && !arrScheduled) {
      console.log('[FR24] Found flight but no scheduled times for future date; treating as no match');
      return null;
    }
    const depIso = toUtcIsoAssumeUtc(depScheduled);
    const arrIso = toUtcIsoAssumeUtc(arrScheduled);
    // For future-day lookups, never write actual times (avoid matching previous instances).
    const depActual = isFutureDay ? undefined : ((f.datetime_takeoff ?? f.first_seen) as string | undefined);
    const arrActual = isFutureDay ? undefined : ((f.datetime_landed ?? f.last_seen) as string | undefined);
    const originCity = getAirportDisplay(origin)?.city;
    const destinationCity = getAirportDisplay(destination)?.city;
    console.log('[FR24] Found:', origin, '→', destination);
    const base: FlightInfo = {
      origin,
      destination,
      originCity,
      destinationCity,
      depTime: depScheduled ? parseTime(depScheduled) : '',
      arrTime: arrScheduled ? parseTime(arrScheduled) : '',
      scheduled_departure_utc: depIso,
      scheduled_arrival_utc: arrIso,
      actual_departure_utc: toUtcIsoAssumeUtc(depActual) ?? undefined,
      actual_arrival_utc: toUtcIsoAssumeUtc(arrActual) ?? undefined,
      airline: undefined,
      aircraftRegistration: f.reg as string | undefined,
      fr24Id: (f.fr24_id ?? f.fr24Id ?? f.id) as string | undefined,
      hex: (f.hex ?? f.icao24) as string | undefined,
      operatedAs: (f.operating_as ?? f.operated_as ?? f.painted_as) as string | undefined,
      callsign: (f.callsign ?? f.callSign) as string | undefined,
      flightEnded: (f.flight_ended ?? f.flightEnded) as boolean | undefined,
      delayed: false,
    };
    // Live metrics (ground speed, altitude, last position) for currently tracked flights.
    const depMs = base.scheduled_departure_utc ? new Date(base.scheduled_departure_utc).getTime() : NaN;
    const now = Date.now();
    const nearDepartureWindow =
      Number.isFinite(depMs) ? (now >= depMs - 2 * 60 * 60 * 1000 && now <= depMs + 18 * 60 * 60 * 1000) : true;
    if (base.fr24Id && base.flightEnded !== true && !base.actual_arrival_utc && nearDepartureWindow) {
      const m = await fetchFr24LastTrackPoint(base.fr24Id);
      if (m) {
        base.groundSpeedKts = m.groundSpeedKts;
        base.altitudeFt = m.altitudeFt;
        base.latitude = m.latitude;
        base.longitude = m.longitude;
        base.lastTrackUtc = m.lastTrackUtc;
        base.flightStatus = base.flightStatus ?? deriveStatusFromLiveMetrics(base, m);
      }
    }
    return base;
  } catch (err) {
    console.log('[FR24] Exception:', err);
    return null;
  }
}

export async function getFr24DeepLink(flightNumber: string, date: string): Promise<string | null> {
  const info = await fetchFromFlightradar24(flightNumber, date);
  const callsign = info?.callsign?.trim()?.toUpperCase();
  const id = info?.fr24Id?.trim();
  if (id) {
    // Prefer the direct live-flight URL format: https://www.flightradar24.com/PGT656/3e769767
    const digits = flightNumber.replace(/\s+/g, '').toUpperCase().match(/(\d+)/)?.[1] ?? '';
    const op = info?.operatedAs?.trim()?.toUpperCase();
    const slug =
      callsign && /^[A-Z0-9]{3,}$/.test(callsign)
        ? callsign
        : (op && digits ? `${op}${digits}` : (flightNumber.replace(/\s+/g, '').trim().toUpperCase() || 'FLIGHT'));
    return `https://www.flightradar24.com/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
  }
  // Fallback: when FR24 id isn't available, callsign shortcut can still open the live map in the app (if active).
  if (callsign && info?.flightEnded === false) {
    return `https://fr24.com/${encodeURIComponent(callsign)}`;
  }
  const reg = info?.aircraftRegistration?.trim();
  if (reg) return `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(reg.toLowerCase())}`;
  const code = flightNumber.trim().toLowerCase().replace(/\s+/g, '');
  const base = `https://www.flightradar24.com/data/flights/${encodeURIComponent(code)}`;
  return date ? `${base}?date=${encodeURIComponent(date)}` : base;
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

/** Map AeroDataBox status to our FlightStatusApi. */
function mapAeroDataBoxStatus(s: string | undefined): FlightStatusApi | undefined {
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'scheduled' || lower === 'ontime') return 'scheduled';
  if (lower === 'departure' || lower === 'departed' || lower === 'onboard' || lower === 'enroute' || lower === 'en_route') return 'en_route';
  if (lower === 'landed' || lower === 'arrival' || lower === 'arrived') return 'landed';
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
  if (lower === 'diverted') return 'diverted';
  if (lower === 'incident') return 'incident';
  if (lower === 'redirected') return 'redirected';
  return undefined;
}

// AeroDataBox via RapidAPI – good for status and actual/estimated times
async function fetchFromAeroDataBox(flightNumber: string, date: string): Promise<FlightInfo | null> {
  if (!RAPIDAPI_KEY) return null;
  const hosts = ['aerodatabox.p.rapidapi.com', 'aedbx-aedbx.p.rapidapi.com'];
  for (const host of hosts) {
    for (const num of flightNumberVariants(flightNumber)) {
      try {
        const url = `https://${host}/flights/number/${encodeURIComponent(num)}/${date}`;
        const res = await fetch(url, {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': host,
          },
        });
        if (!res.ok) continue;
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.flights ? data.flights : data?.departure ? [data] : []);
        const f = list[0];
        if (!f) continue;
        const dep = f.departure ?? f.departureAirport ?? f.origin ?? {};
        const arr = f.arrival ?? f.arrivalAirport ?? f.destination ?? {};
        const getCode = (x: Record<string, unknown>) => (x?.iata ?? x?.icao ?? x?.code ?? '') as string;
        const origin = getCode(dep);
        const destination = getCode(arr);
        if (!origin && !destination) continue;
        const depSched = dep.scheduledTimeUtc ?? dep.scheduledTime ?? dep.scheduledTimeLocal ?? dep.scheduled ?? dep.time ?? '';
        const arrSched = arr.scheduledTimeUtc ?? arr.scheduledTime ?? arr.scheduledTimeLocal ?? arr.scheduled ?? arr.time ?? '';
        const depActual = dep.actualTimeUtc ?? dep.actualTime ?? dep.estimatedTimeUtc ?? dep.estimatedTime ?? depSched;
        const arrActual = arr.actualTimeUtc ?? arr.actualTime ?? arr.estimatedTimeUtc ?? arr.estimatedTime ?? arrSched;
        const depIso = toUtcIsoStrict(String(depSched));
        const arrIso = toUtcIsoStrict(String(arrSched));
        const depActualIso = toUtcIsoStrict(String(depActual));
        const arrActualIso = toUtcIsoStrict(String(arrActual));
        if (!depIso || !arrIso) continue;
        const delayMin = Number(f.delay ?? dep.delay ?? arr.delay) || 0;
        const flightStatus = mapAeroDataBoxStatus((f.status ?? f.flightStatus ?? f.leg?.status) as string);
        console.log('[AeroDataBox] Found:', origin, '→', destination, f.status ?? '', flightStatus ?? '');
        return {
          origin,
          destination,
          originCity: (dep.city ?? dep.municipality ?? dep.name) as string | undefined,
          destinationCity: (arr.city ?? arr.municipality ?? arr.name) as string | undefined,
          depTime: parseTime(String(depSched)),
          arrTime: parseTime(String(arrSched)),
          scheduled_departure_utc: depIso,
          scheduled_arrival_utc: arrIso,
          actual_departure_utc: flightStatus === 'en_route' || flightStatus === 'landed' ? (depActualIso ?? depIso) : undefined,
          actual_arrival_utc: flightStatus === 'landed' ? (arrActualIso ?? arrIso) : undefined,
          airline: (f.airline?.name ?? f.carrier?.name ?? f.operator?.name) as string | undefined,
          aircraftRegistration: (f.aircraft?.registration ?? f.aircraft?.number ?? f.registration) as string | undefined,
          delayed: delayMin > 0,
          flightStatus,
        };
      } catch {
        continue;
      }
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
  // If already landed/cancelled/etc, no need for live metrics.
  if (base.flightStatus && ['landed', 'cancelled', 'diverted', 'incident', 'redirected'].includes(base.flightStatus)) {
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
  // If FR24 derived a better live status, allow it to upgrade scheduled → en_route.
  if (!merged.flightStatus && fr.flightStatus) merged.flightStatus = fr.flightStatus;
  if (merged.flightStatus === 'scheduled' && fr.flightStatus === 'en_route') merged.flightStatus = 'en_route';
  return merged;
}

export async function fetchFlightByNumber(
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

  let result = await fetchFromAviationEdgeTimetable(raw, date);
  if (result && (result.origin || result.destination)) {
    console.log('[FlightAPI] Success from Aviation Edge (timetable)');
    const ae = await maybeEnrichWithAviationEdgeLiveMetrics(raw, result);
    return await maybeEnrichWithFr24LiveMetrics(raw, date, ae);
  }
  if (debug) console.log('[Debug PC615] timetable: no match');

  // Live tracking/status (Aviation Edge flights). Useful when timetable doesn't have the leg but flight is in-progress.
  result = await fetchFromAviationEdgeFlights(raw, date);
  if (result && (result.origin || result.destination)) {
    console.log('[FlightAPI] Success from Aviation Edge (flights)');
    return await maybeEnrichWithFr24LiveMetrics(raw, date, result);
  }
  if (debug) console.log('[Debug PC615] flights (live): no match');

  // Future schedules: for tomorrow and later we want scheduled times (not yesterday's actual).
  const futureMin = getLocalDateStringPlusDays(1); // todayLocal + 1 day (tomorrow)
  if (date >= futureMin) {
    result = await fetchFromAviationEdgeFuture(raw, date);
    if (result && (result.origin || result.destination)) {
      console.log('[FlightAPI] Success from Aviation Edge (future schedules)');
      return result;
    }
    if (debug) console.log('[Debug PC615] flightsFuture: no match');
  } else if (debug) {
    console.log('[Debug PC615] flightsFuture: skipped (date < tomorrow)');
  }

  result = await fetchFromFlightradar24(raw, date);
  if (result && (result.origin || result.destination)) {
    console.log('[FlightAPI] Success from Flightradar24');
    return result;
  }
  if (debug) console.log('[Debug PC615] FR24: no match');

  result = await fetchFromAeroDataBox(raw, date);
  if (result && (result.origin || result.destination)) {
    console.log('[FlightAPI] Success from AeroDataBox (RapidAPI)');
    return result;
  }
  if (debug) console.log('[Debug PC615] AeroDataBox: no match');

  // If we couldn't find the selected future date, fall back to previous day's schedule as placeholder + warning.
  if (date >= futureMin) {
    const [yy, mm, dd] = date.split('-').map(Number);
    const prev = new Date(Date.UTC(yy, (mm ?? 1) - 1, (dd ?? 1) - 1, 0, 0, 0)).toISOString().slice(0, 10);
    const prevRes =
      (await fetchFromAviationEdgeTimetable(raw, prev)) ??
      (await fetchFromFlightradar24(raw, prev)) ??
      null;
    const routeAirports = [
      toIataCode(prevRes?.origin),
      toIataCode(prevRes?.destination),
    ].filter(Boolean) as string[];
    const prevScheduleFromRoute = routeAirports.length > 0
      ? await fetchFromAviationEdgeTimetableAtAirports(raw, prev, routeAirports)
      : null;
    const base = prevScheduleFromRoute ?? prevRes;
    const prevDep = base?.scheduled_departure_utc;
    const prevArr = base?.scheduled_arrival_utc;
    if (base && (prevDep || prevArr)) {
      console.log('[FlightAPI] Using prev-day scheduled time fallback (unconfirmed)');
      const schedDep = shiftUtcIsoByDays(prevDep, 1);
      const schedArr = shiftUtcIsoByDays(prevArr, 1);
      return {
        ...base,
        depTime: parseTime(schedDep),
        arrTime: parseTime(schedArr),
        scheduled_departure_utc: schedDep,
        scheduled_arrival_utc: schedArr,
        actual_departure_utc: undefined,
        actual_arrival_utc: undefined,
        flightStatus: undefined,
        delayed: undefined,
        scheduleUnconfirmed: true,
      };
    }
  }

  console.log('[FlightAPI] No result from Aviation Edge, Flightradar24, or AeroDataBox');
  return null;
}
