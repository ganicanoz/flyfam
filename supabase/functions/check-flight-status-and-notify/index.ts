// Cron: yalnızca api_refresh_phase ∈ ('semi_active','active').
// Adaptive polling: last_poll_at + getAdaptivePollIntervalMs (5 / 25 / 60 dk, STD−3h öncesi API yok).
// Kalkış ref: fr24_datetime_takeoff_utc → actual_departure → ETD; üst üste binen pencerelerde min aralık.
// Harici API önceliği (maliyet: ilk sağlıklı kaynakta dur):
//   active: FR24 → ADB (API.Market → RapidAPI) → AirLabs → FlightAPI (AeroAPI)
//   semi_active: ADB (API.Market → RapidAPI) → AirLabs → FlightAPI (FR24 yok)
// Pasif fazlar: DB trigger + refresh_flights_api_refresh_phase.
// Secrets: CRON_SECRET, SUPABASE_*, AIRLABS_API_KEY veya EXPO_PUBLIC_AIRLABS_API_KEY, FR24_API_TOKEN, AEROAPI_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { semiActivePatchFromCachedRosterPoll } from '../_shared/cachedRosterPollPatch.ts';
import { mergeTimetableRowsPreferFirst, timetableRowIsSufficient } from '../_shared/flightTimetableWaterfall.ts';
import {
  fr24LegMatchesRosterDate,
  fr24PrimaryDepUtcIsoForSort,
  fr24ScheduledFieldToUtcIso,
  utcFieldOrAirportLocalToUtcIso,
} from '../_shared/fr24FlightDateMatch.ts';
import { fr24TurkeyPakistanScheduleTooShort } from '../_shared/fr24TurkeyPakistanSanity.ts';
import { getCachedPayload } from '../_shared/providerResponseCache.ts';
import {
  apply429ToCooldown,
  isBlockedUntil,
  loadCooldownUntilByProvider,
} from '../_shared/providerCooldown.ts';
import { rosterPollCacheKey } from '../_shared/rosterPollCacheKey.ts';
import { fr24AircraftRegistrationFromFlight } from '../_shared/fr24AircraftRegistration.ts';
import { buildAerodataboxFlightNumberSources } from '../_shared/aerodataboxHttp.ts';

const COOLDOWN_PROVIDER_AIRLABS = 'airlabs';
const COOLDOWN_PROVIDER_FR24 = 'fr24';
const COOLDOWN_PROVIDER_AEROAPI = 'aeroapi';

const FR24_URL = 'https://fr24api.flightradar24.com/api/flight-summary/light';
const AIRLABS_BASE = 'https://airlabs.co/api/v9';
const AERODATABOX_BASE = 'https://aerodatabox.p.rapidapi.com';
const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';

const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS' };

type DbFlightStatus = 'scheduled' | 'taxi_out' | 'en_route' | 'landed';

function extractMissingColumn(msg: string): string | null {
  const s = String(msg ?? '');
  const m1 = s.match(/column\s+\w+\.(\w+)\s+does not exist/i);
  if (m1?.[1]) return m1[1];
  const m2 = s.match(/Could not find the '([^']+)' column/i);
  if (m2?.[1]) return m2[1];
  return null;
}

function calcDelayMinutes(estimatedIso: string | null | undefined, scheduledIso: string | null | undefined): number | null {
  if (!estimatedIso || !scheduledIso) return null;
  const est = new Date(estimatedIso).getTime();
  const sch = new Date(scheduledIso).getTime();
  if (!Number.isFinite(est) || !Number.isFinite(sch)) return null;
  return Math.round((est - sch) / 60000);
}

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
    s = noSecs ? s + ':00.000Z' : s + 'Z';
  }
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

interface Fr24Flight {
  orig_icao?: string;
  origin_icao?: string;
  dest_icao?: string;
  destination_icao?: string;
  destination_icao_actual?: string;
  scheduled_departure_utc?: string;
  scheduled_departure?: string;
  scheduled_arrival_utc?: string;
  scheduled_arrival?: string;
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
}

function normalizeOvernightEta(depUtcIso: string | undefined, etaUtcIso: string | undefined): string | undefined {
  if (!depUtcIso || !etaUtcIso) return etaUtcIso;
  const depMs = new Date(depUtcIso).getTime();
  const etaMs = new Date(etaUtcIso).getTime();
  if (Number.isNaN(depMs) || Number.isNaN(etaMs)) return etaUtcIso;
  if (etaMs < depMs) return new Date(etaMs + 24 * 60 * 60 * 1000).toISOString();
  return etaUtcIso;
}

function fr24PickString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Roster bar: yalnızca FR estimated dep+arr; iniş; scheduled_* dokunulmaz. */
function fr24ProgressBarPatch(f: Fr24Flight): Record<string, unknown> {
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
  const landRaw = f.datetime_landed ?? f.datetimeLanded;
  const landedIso = typeof landRaw === 'string' ? toUtcIsoAssumeUtc(landRaw) : undefined;
  const patch: Record<string, unknown> = {};
  if (depIso && arrIso && t1 > t0) {
    patch.fr24_progress_dep_utc = depIso;
    patch.fr24_progress_eta_utc = arrIso;
  }
  if (landedIso) patch.fr24_datetime_landed_utc = landedIso;
  const reg = fr24AircraftRegistrationFromFlight(f);
  if (reg) patch.aircraft_registration = reg;
  return patch;
}

/** `flight_status` güncellenince `internal_status` aynı hizada kalsın (mobil/cron drift önlemi). */
function internalStatusMirrorForDbFlightStatus(flightStatus: string): string {
  const s = String(flightStatus ?? '').toLowerCase();
  if (s === 'parked') return 'landed';
  if (s === 'departed') return 'en_route';
  if (['scheduled', 'taxi_out', 'en_route', 'landed', 'cancelled'].includes(s)) return s;
  if (s === 'canceled') return 'cancelled';
  return 'scheduled';
}

function delayBucket30(delayMin: number | null | undefined): number | null {
  if (typeof delayMin !== 'number' || !Number.isFinite(delayMin)) return null;
  if (delayMin < 30) return null;
  return Math.floor(delayMin / 30);
}

function fr24FlightEnded(f: Fr24Flight): boolean {
  return f.flight_ended === true || f.flightEnded === true;
}

/** rosterPollEdge ile aynı: iniş yoksa flight_ended iken last_seen → landed UTC. */
function fr24LandedUtcFromFlight(f: Fr24Flight): string | undefined {
  const landed = toUtcIsoAssumeUtc((f.datetime_landed ?? f.datetimeLanded) as string | undefined);
  if (landed) return landed;
  if (fr24FlightEnded(f)) {
    return toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined) ?? undefined;
  }
  return undefined;
}

function deriveFr24LiveStatus(
  nowMs: number,
  firstSeenUtc: string | undefined,
  datetimeTakeoffUtc: string | undefined,
  datetimeLandedUtc: string | undefined,
): DbFlightStatus {
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

function hasStrongLandedEvidence(args: {
  fr24LandedUtc?: string | null;
  aeroActualInUtc?: string | null;
  actualArrivalDb?: string | null;
  includeDbActualArrival?: boolean;
}): boolean {
  const useDb = args.includeDbActualArrival !== false;
  return Boolean(
    toUtcIsoAssumeUtc(args.fr24LandedUtc ?? null) ??
      toUtcIsoAssumeUtc(args.aeroActualInUtc ?? null) ??
      (useDb ? toUtcIsoAssumeUtc(args.actualArrivalDb ?? null) : null),
  );
}

/**
 * Provider `actualIn` bazen komşu bacağı (önceki/sonraki leg) döndürebilir.
 * Active fazda yanlış "landed" kilidini önlemek için mevcut satır zamanlarıyla tutarlılık kontrolü.
 */
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
  // Gelecekten gelen actualIn geçersiz.
  if (inMs > args.nowMs + 30 * 60 * 1000) return false;

  const outIso = toUtcIsoAssumeUtc(args.actualOutUtc ?? null);
  const outMs = outIso ? new Date(outIso).getTime() : NaN;
  if (Number.isFinite(outMs) && inMs < outMs - 5 * 60 * 1000) return false;

  const stdIso = toUtcIsoAssumeUtc(args.scheduledDepUtc ?? null);
  const stdMs = stdIso ? new Date(stdIso).getTime() : NaN;
  // İnişin, planlı kalkıştan çok önce olması genelde yanlış bacaktır.
  if (Number.isFinite(stdMs) && inMs < stdMs - 90 * 60 * 1000) return false;

  const staIso = toUtcIsoAssumeUtc(args.scheduledArrUtc ?? null);
  const staMs = staIso ? new Date(staIso).getTime() : NaN;
  // Çok eski iniş aktif faz uçuşu için güvenilmez.
  if (Number.isFinite(staMs) && inMs < staMs - 24 * 60 * 60 * 1000) return false;

  return true;
}

async function selectFr24Flight(
  flightNumber: string,
  date: string,
  token: string,
): Promise<Fr24Flight | null> {
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(',');
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);
  const url = `${FR24_URL}?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Version': 'v1',
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data || !Array.isArray(json.data) || json.data.length === 0) {
    return null;
  }
  const list = json.data as Fr24Flight[];
  const candidates = list.filter((f) => fr24LegMatchesRosterDate(f as unknown as Record<string, unknown>, date));
  if (candidates.length === 0) return null;
  const live = candidates.find((x) => x.flight_ended === false || x.flightEnded === false);
  const f = live ?? candidates.sort((a, b) => {
    const ta = fr24PrimaryDepUtcIsoForSort(a as unknown as Record<string, unknown>, date) ?? '';
    const tb = fr24PrimaryDepUtcIsoForSort(b as unknown as Record<string, unknown>, date) ?? '';
    return tb.localeCompare(ta);
  })[0];
  return f ?? null;
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

function airlabsBestDepArrEstimated(o: Record<string, unknown>): { dep: string | null; arr: string | null } {
  const origin = String(o.dep_iata ?? o.dep_icao ?? '').replace(/\s/g, '').toUpperCase();
  const destination = String(o.arr_iata ?? o.arr_icao ?? '').replace(/\s/g, '').toUpperCase();
  const depTs =
    (typeof o.dep_estimated_ts === 'number' && o.dep_estimated_ts > 1e9
      ? new Date(o.dep_estimated_ts * 1000).toISOString()
      : null) ??
    (typeof o.dep_time_ts === 'number' && o.dep_time_ts > 1e9
      ? new Date(o.dep_time_ts * 1000).toISOString()
      : null);
  const arrTs =
    (typeof o.arr_estimated_ts === 'number' && o.arr_estimated_ts > 1e9
      ? new Date(o.arr_estimated_ts * 1000).toISOString()
      : null) ??
    (typeof o.arr_time_ts === 'number' && o.arr_time_ts > 1e9
      ? new Date(o.arr_time_ts * 1000).toISOString()
      : null);
  const dep =
    utcFieldOrAirportLocalToUtcIso(
      (o.dep_estimated_utc ?? o.dep_time_utc) as string | undefined,
      (o.dep_estimated ?? o.dep_time ?? o.dep_scheduled) as string | undefined,
      origin,
    ) ??
    depTs ??
    null;
  const arr =
    utcFieldOrAirportLocalToUtcIso(
      (o.arr_estimated_utc ?? o.arr_time_utc) as string | undefined,
      (o.arr_estimated ?? o.arr_time ?? o.arr_scheduled) as string | undefined,
      destination,
    ) ??
    arrTs ??
    null;
  const depN = dep ?? null;
  const arrN = arr ?? null;
  const arrAdj = depN && arrN ? (normalizeOvernightEta(depN, arrN) ?? arrN) : arrN;
  return { dep: depN, arr: arrAdj };
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

function airlabsDivertAirport(o: Record<string, unknown>): string | null {
  const a = o.arr_iata ?? o.arrIata;
  const b = o.arr_icao ?? o.arrIcao;
  const v = (typeof a === 'string' && a.trim()) ? a.trim() : (typeof b === 'string' && b.trim()) ? b.trim() : '';
  return v ? v.toUpperCase().slice(0, 4) : null;
}

/** AirLabs + AeroDataBox (ve birleşik `merged.status`) kısa metinleri. */
function mapAirLabsStatus(s: string | undefined): DbFlightStatus | null {
  if (!s) return null;
  const x = s.toLowerCase().replace(/_/g, '-');
  if (x === 'landed' || x.includes('arrived')) return 'landed';
  if (x === 'scheduled') return 'scheduled';
  if (x === 'active' || x === 'en-route' || x.includes('en route') || x.includes('airborne')) return 'en_route';
  return null;
}

function firstDefinedString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
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
  actualOut: string | null;
  actualIn: string | null;
  source: 'airlabs' | 'aerodatabox' | 'aeroapi' | 'aviationstack' | 'merged';
};

async function fetchAeroDataBoxFlight(
  flightNumber: string,
  flightDate: string,
  supabase: Parameters<typeof loadCooldownUntilByProvider>[0],
  cooldownMap: Map<string, number>,
): Promise<PollTimetableRow | null> {
  const rapidKey =
    Deno.env.get('AERODATABOX_RAPIDAPI_KEY') ??
    Deno.env.get('RAPIDAPI_KEY') ??
    Deno.env.get('EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY') ??
    AERODATABOX_RAPIDAPI_FALLBACK;

  // ADB 429 risk: semi/active zincirde fan-out'u sınırlıyoruz.
  const variants = flightNumberVariants(flightNumber).slice(0, 3);
  const sources = buildAerodataboxFlightNumberSources(variants, flightDate, rapidKey, {
    includeT00: false,
  });
  if (!sources.length) return null;
  for (const src of sources) {
    if (isBlockedUntil(cooldownMap, src.cooldownKey)) continue;
    for (const url of src.urls) {
      try {
        const res = await fetch(url, { headers: src.headers });
        if (res.status === 429) {
          await apply429ToCooldown(supabase as any, cooldownMap, src.cooldownKey, res.headers);
          continue;
        }
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        const root = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
        if (!root || typeof root !== 'object') continue;
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
          aeroCoerceTimeString(dep.revisedTimeUtc) ??
            aeroCoerceTimeString(dep.revisedTime) ??
            aeroCoerceTimeString(dep.revisedTimeLocal) ??
          aeroCoerceTimeString(dep.predictedTimeUtc) ??
            aeroCoerceTimeString(dep.predictedTime) ??
            aeroCoerceTimeString(dep.estimatedTimeUtc) ??
            aeroCoerceTimeString(dep.estimatedTime) ??
            undefined,
        ) ?? null;
      const arrExp =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(arr.revisedTimeUtc) ??
            aeroCoerceTimeString(arr.revisedTime) ??
            aeroCoerceTimeString(arr.revisedTimeLocal) ??
          aeroCoerceTimeString(arr.predictedTimeUtc) ??
            aeroCoerceTimeString(arr.predictedTime) ??
            aeroCoerceTimeString(arr.estimatedTimeUtc) ??
            aeroCoerceTimeString(arr.estimatedTime) ??
            undefined,
        ) ?? null;
      const depIso = depExp ?? depSched;
      const arrIso = arrExp ?? arrSched;
      if (!depIso && !arrIso) continue;
      const actualOutRaw =
        aeroCoerceTimeString(dep.actualTimeUtc) ??
        aeroCoerceTimeString(dep.actualTime) ??
        aeroCoerceTimeString(dep.runwayTimeUtc) ??
        aeroCoerceTimeString(dep.outTimeUtc);
      const actualInRaw =
        aeroCoerceTimeString(arr.actualTimeUtc) ??
        aeroCoerceTimeString(arr.actualTime) ??
        aeroCoerceTimeString(arr.runwayTimeUtc) ??
        aeroCoerceTimeString(arr.inTimeUtc);
      const actualOut = actualOutRaw ? toUtcIsoAssumeUtc(actualOutRaw) ?? null : null;
      const actualIn = actualInRaw ? toUtcIsoAssumeUtc(actualInRaw) ?? null : null;
      const status = firstDefinedString((root.status as Record<string, unknown> | undefined)?.text, root.status)?.toLowerCase() ?? null;
      const divertedTo = status?.includes('divert') ? aeroLegAirportCode(arr) : null;
      const delayDepMin = calcDelayMinutes(depIso, depSched);
      const delayArrMin = calcDelayMinutes(arrIso, arrSched);
      return {
        scheduledDep: depIso,
        scheduledArr: arrIso,
        status,
        divertedTo,
        delayDepMin,
        delayArrMin,
        progressPercent: null,
        actualOut,
        actualIn,
        source: 'aerodatabox',
      };
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function fetchAirLabsFlight(
  flightNumber: string,
  flightDate: string,
  apiKey: string,
  supabase: Parameters<typeof loadCooldownUntilByProvider>[0],
  cooldownMap: Map<string, number>,
): Promise<PollTimetableRow | null> {
  if (isBlockedUntil(cooldownMap, COOLDOWN_PROVIDER_AIRLABS)) return null;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const match = raw.match(/^([A-Z]{2,3})(\d+)$/);
  const flightIata = match ? `${match[1]}${match[2]}` : raw;
  const flightIcaoVariants = flightNumberVariants(flightNumber).filter((v) => v.length >= 5 && /^[A-Z]{3}\d+/.test(v));
  const tryUrls: string[] = [
    `${AIRLABS_BASE}/flight?api_key=${encodeURIComponent(apiKey)}&flight_iata=${encodeURIComponent(flightIata)}`,
  ];
  for (const icaoNum of flightIcaoVariants.slice(0, 2)) {
    tryUrls.push(`${AIRLABS_BASE}/flight?api_key=${encodeURIComponent(apiKey)}&flight_icao=${encodeURIComponent(icaoNum)}`);
  }
  for (const url of tryUrls) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await apply429ToCooldown(supabase as any, cooldownMap, COOLDOWN_PROVIDER_AIRLABS, res.headers);
        break;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) continue;
      const fr = json?.response;
      if (!fr || typeof fr !== 'object') continue;
      const o = fr as Record<string, unknown>;
      const { dep: depIso, arr: arrIso } = airlabsBestDepArrEstimated(o);
      const depDay = depIso ? depIso.slice(0, 10) : '';
      if (depDay && depDay !== flightDate) {
        const y = parseInt(flightDate.slice(0, 4), 10);
        const m = parseInt(flightDate.slice(5, 7), 10) - 1;
        const d = parseInt(flightDate.slice(8, 10), 10);
        const prev = new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10);
        const next = new Date(Date.UTC(y, m, d + 1)).toISOString().slice(0, 10);
        if (depDay !== prev && depDay !== next) continue;
      }
      const st = typeof o.status === 'string' ? o.status : null;
      const sl = st?.toLowerCase();
      const divertedTo = sl === 'diverted' ? airlabsDivertAirport(o) : null;
      const delayDepMin = airlabsNumField(o, 'dep_delayed');
      const delayArrMin = airlabsNumField(o, 'arr_delayed');
      const progressPercent = airlabsProgressPercentParsed(o);
      if (
        !depIso && !arrIso && !st && delayDepMin == null && delayArrMin == null && progressPercent == null
      ) continue;
      return {
        scheduledDep: depIso,
        scheduledArr: arrIso,
        status: st,
        divertedTo,
        delayDepMin,
        delayArrMin,
        progressPercent,
        actualOut: null,
        actualIn: null,
        source: 'airlabs',
      };
    } catch {
      continue;
    }
  }
  return null;
}

function firstArrayObject<T>(x: unknown): T | null {
  return Array.isArray(x) && x.length > 0 && x[0] && typeof x[0] === 'object' ? (x[0] as T) : null;
}

function isDateNearby(iso: string | null, flightDate: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  if (d === flightDate) return true;
  const y = parseInt(flightDate.slice(0, 4), 10);
  const m = parseInt(flightDate.slice(5, 7), 10) - 1;
  const day = parseInt(flightDate.slice(8, 10), 10);
  const prev = new Date(Date.UTC(y, m, day - 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(y, m, day + 1)).toISOString().slice(0, 10);
  return d === prev || d === next;
}

async function fetchAeroApiFlight(
  flightNumber: string,
  flightDate: string,
  supabase: Parameters<typeof loadCooldownUntilByProvider>[0],
  cooldownMap: Map<string, number>,
): Promise<PollTimetableRow | null> {
  if (isBlockedUntil(cooldownMap, COOLDOWN_PROVIDER_AEROAPI)) return null;
  const apiKey = Deno.env.get('AEROAPI_API_KEY') ?? Deno.env.get('FLIGHTAWARE_AEROAPI_KEY') ?? null;
  if (!apiKey) return null;
  const variants = flightNumberVariants(flightNumber).slice(0, 6);
  const from = new Date(`${flightDate}T00:00:00Z`).toISOString();
  const to = new Date(`${flightDate}T23:59:59Z`).toISOString();
  for (const ident of variants) {
    const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&max_pages=1`;
    try {
      const res = await fetch(url, {
        headers: {
          'x-apikey': apiKey,
          Accept: 'application/json',
        },
      });
      if (res.status === 429) {
        await apply429ToCooldown(supabase as any, cooldownMap, COOLDOWN_PROVIDER_AEROAPI, res.headers);
        continue;
      }
      if (!res.ok) continue;
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!json || typeof json !== 'object') continue;
      const flights = (json.flights as unknown[]) ?? [];
      const row = firstArrayObject<Record<string, unknown>>(flights);
      if (!row) continue;
      const scheduledOut = toUtcIsoAssumeUtc((row.scheduled_out as string | undefined) ?? null) ?? null; // STD
      const estimatedOut = toUtcIsoAssumeUtc((row.estimated_out as string | undefined) ?? null) ?? null; // ETD
      const actualOut = toUtcIsoAssumeUtc((row.actual_out as string | undefined) ?? null) ?? null; // ATD
      const scheduledIn = toUtcIsoAssumeUtc((row.scheduled_in as string | undefined) ?? null) ?? null; // STA
      const estimatedIn = toUtcIsoAssumeUtc((row.estimated_in as string | undefined) ?? null) ?? null; // ETA
      const actualIn = toUtcIsoAssumeUtc((row.actual_in as string | undefined) ?? null) ?? null; // ATA
      const dep = estimatedOut ?? scheduledOut;
      const arrRaw = estimatedIn ?? scheduledIn;
      const arr = dep && arrRaw ? (normalizeOvernightEta(dep, arrRaw) ?? arrRaw) : arrRaw;
      const sanityRef = dep ?? scheduledOut ?? actualOut;
      if (!isDateNearby(sanityRef, flightDate)) continue;
      const statusRaw = typeof row.status === 'string' ? row.status.toLowerCase() : null;
      const delayDepMin = calcDelayMinutes(dep, scheduledOut);
      const delayArrMin = calcDelayMinutes(arr, scheduledIn);
      return {
        scheduledDep: dep,
        scheduledArr: arr,
        status: statusRaw,
        divertedTo: statusRaw?.includes('divert') ? (firstDefinedString(row.diverted_airport as string | undefined) ?? null) : null,
        delayDepMin,
        delayArrMin,
        progressPercent: null,
        actualOut,
        actualIn,
        source: 'aeroapi',
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** AirLabs → ADB → AeroAPI; ilk yeterli yanıtta dur, değilse AirLabs öncelikli birleştir. */
async function fetchTimetableWaterfall(
  flightNumber: string,
  flightDate: string,
  airlabsApiKey: string | null,
  supabase: Parameters<typeof loadCooldownUntilByProvider>[0],
  cooldownMap: Map<string, number>,
): Promise<PollTimetableRow | null> {
  const al = airlabsApiKey
    ? await fetchAirLabsFlight(flightNumber, flightDate, airlabsApiKey, supabase, cooldownMap)
    : null;
  if (timetableRowIsSufficient(al)) return al;
  const adb = await fetchAeroDataBoxFlight(flightNumber, flightDate, supabase, cooldownMap);
  if (timetableRowIsSufficient(adb)) return adb;

  const aero = await fetchAeroApiFlight(flightNumber, flightDate, supabase, cooldownMap);
  if (timetableRowIsSufficient(aero)) return aero;

  const m1 = mergeTimetableRowsPreferFirst(al, adb) as PollTimetableRow | null;
  return mergeTimetableRowsPreferFirst(m1, aero) as PollTimetableRow | null;
}

function airLabsIsCancelled(status: string | null | undefined): boolean {
  const s = status?.toLowerCase();
  return s === 'cancelled' || s === 'canceled';
}

function airLabsIsDiverted(status: string | null | undefined): boolean {
  return status?.toLowerCase() === 'diverted';
}

/** Adaptive polling: satır şeması check-flight-status listesi ile uyumlu alanlar. */
type FlightPollRow = {
  id: string;
  scheduled_departure: string | null;
  estimated_departure: string | null;
  estimated_arrival: string | null;
  scheduled_arrival: string | null;
  actual_departure: string | null;
  fr24_datetime_takeoff_utc: string | null;
  flight_status: string | null;
  internal_status: string | null;
  api_refresh_phase: string;
  last_poll_at: string | null;
};

function parseTimeMs(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return NaN;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function isAirborneFlightRow(row: { flight_status: string | null; internal_status: string | null }): boolean {
  const st = (row.flight_status ?? '').toLowerCase();
  if (st === 'en_route') return true;
  const intr = (row.internal_status ?? '').toLowerCase();
  if (intr === 'en_route') return true;
  return false;
}

const MIN_POLL_MS = 5 * 60 * 1000;
const POLL_SEMI_MS = 60 * 60 * 1000;
const POLL_CRITICAL_MS = 5 * 60 * 1000;
const POLL_CRUISE_MS = 25 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

/** FR24 datetime_takeoff → DB alanı (polling kalkış referansı birinci öncelik). */
function fr24DatetimeTakeoffUtcPatch(f: Fr24Flight): Record<string, unknown> {
  const takeoff = toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined);
  return takeoff ? { fr24_datetime_takeoff_utc: takeoff } : {};
}

/** FR24 first_seen → DB (STD ile kıyaslı kalkış gecikmesi için). */
function fr24FirstSeenUtcPatch(f: Fr24Flight): Record<string, unknown> {
  const first = toUtcIsoAssumeUtc((f.first_seen ?? f.firstSeen) as string | undefined);
  return first ? { fr24_first_seen_utc: first } : {};
}

/**
 * Alt pencereye göre harici API aralığı. null = Passive Future (STD−3h öncesi) → API yok.
 * Kalkış referansı: fr24_datetime_takeoff_utc → actual_departure → ETD.
 * Kısa uçuşlarda pencereler üst üste binebilir; eşleşen kuralların minimum aralığı (en sık) seçilir.
 */
function getAdaptivePollIntervalMs(row: FlightPollRow, nowMs: number): number | null {
  const stdMs = parseTimeMs(row.scheduled_departure);
  if (Number.isFinite(stdMs) && nowMs < stdMs - 3 * 60 * MINUTE_MS) {
    return null;
  }

  const etdParsed = parseTimeMs(row.estimated_departure);
  const etdMs = Number.isFinite(etdParsed) ? etdParsed : stdMs;
  const depIsoForEta =
    toUtcIsoAssumeUtc(row.estimated_departure ?? undefined) ??
    toUtcIsoAssumeUtc(row.scheduled_departure ?? undefined);
  const etaIsoRaw = toUtcIsoAssumeUtc((row.estimated_arrival ?? row.scheduled_arrival) ?? undefined);
  const etaIso = normalizeOvernightEta(depIsoForEta ?? '', etaIsoRaw ?? '') ?? etaIsoRaw;
  const etaMs = etaIso ? new Date(etaIso).getTime() : NaN;
  const etaFallbackMs = parseTimeMs(row.scheduled_arrival);
  const etaEffectiveMs = Number.isFinite(etaMs) ? etaMs : etaFallbackMs;

  const takeoffMs = parseTimeMs(row.fr24_datetime_takeoff_utc);
  const actualDepMs = parseTimeMs(row.actual_departure);
  const depRefMs = Number.isFinite(takeoffMs)
    ? takeoffMs
    : Number.isFinite(actualDepMs)
      ? actualDepMs
      : etdMs;

  const airborne = isAirborneFlightRow(row);

  if (!airborne) {
    if (Number.isFinite(etdMs) && nowMs < etdMs - 30 * MINUTE_MS) {
      return POLL_SEMI_MS;
    }
    return POLL_CRITICAL_MS;
  }

  const candidates: number[] = [];
  const etaApproachStart = Number.isFinite(etaEffectiveMs) ? etaEffectiveMs - 30 * MINUTE_MS : NaN;

  if (Number.isFinite(depRefMs)) {
    const earlyEnd = depRefMs + 20 * MINUTE_MS;
    if (nowMs >= depRefMs && nowMs < earlyEnd) {
      candidates.push(POLL_CRITICAL_MS);
    }
    if (
      Number.isFinite(etaEffectiveMs) &&
      nowMs >= depRefMs + 20 * MINUTE_MS &&
      nowMs < etaEffectiveMs - 30 * MINUTE_MS
    ) {
      candidates.push(POLL_CRUISE_MS);
    }
  }

  if (Number.isFinite(etaApproachStart) && nowMs >= etaApproachStart) {
    candidates.push(POLL_CRITICAL_MS);
  }

  if (candidates.length === 0) {
    return POLL_CRITICAL_MS;
  }
  return Math.min(...candidates);
}

function shouldRunExternalPoll(row: FlightPollRow, nowMs: number): boolean {
  const intervalMs = getAdaptivePollIntervalMs(row, nowMs);
  if (intervalMs === null) return false;
  if (intervalMs < MIN_POLL_MS) return false;
  const lastMs = parseTimeMs(row.last_poll_at);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalMs;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const fr24Token = Deno.env.get('FR24_API_TOKEN') ?? null;
  const airlabsKey = Deno.env.get('AIRLABS_API_KEY') ?? Deno.env.get('EXPO_PUBLIC_AIRLABS_API_KEY') ?? null;
  const aeroApiKey = Deno.env.get('AEROAPI_API_KEY') ?? Deno.env.get('FLIGHTAWARE_AEROAPI_KEY') ?? null;

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid or missing x-cron-secret' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const nowMs = Date.now();
  const cooldownMap = await loadCooldownUntilByProvider(supabase);

  let selectCols = [
    'id',
    'flight_number',
    'flight_date',
    'flight_status',
    'scheduled_departure',
    'scheduled_arrival',
    'estimated_departure',
    'estimated_arrival',
    'actual_departure',
    'actual_arrival',
    'fr24_datetime_takeoff_utc',
    'roster_entry_kind',
    'api_refresh_phase',
    'internal_status',
    'review_flag',
    'delay_dep_min',
    'delay_arr_min',
    'dep_delay_notified_bucket',
    'arr_delay_notified_bucket',
    'last_poll_at',
  ];
  let flights: unknown[] | null = null;
  let listError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const q = await supabase
      .from('flights')
      .select(selectCols.join(', '))
      .eq('roster_entry_kind', 'flight')
      .not('scheduled_departure', 'is', null)
      .in('api_refresh_phase', ['semi_active', 'active']);
    if (!q.error) {
      flights = q.data ?? [];
      listError = null;
      break;
    }
    const missing = extractMissingColumn(String(q.error.message ?? ''));
    if (!missing || !selectCols.includes(missing)) {
      flights = q.data ?? [];
      listError = q.error;
      break;
    }
    selectCols = selectCols.filter((c) => c !== missing);
    console.warn(`[check-flight-status] flights.${missing} missing; retrying without it`);
    flights = q.data ?? [];
    listError = q.error;
  }

  if (listError) {
    console.error('[check-flight-status] list error', listError.message);
    return new Response(JSON.stringify({ error: listError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const hasLastPollAtColumn = selectCols.includes('last_poll_at');

  const list = flights ?? [];
  const needSemi = list.some((r) => r.api_refresh_phase === 'semi_active');
  const needActive = list.some((r) => r.api_refresh_phase === 'active');
  if ((needSemi || needActive) && !airlabsKey) {
    console.warn('[check-flight-status] AIRLABS_API_KEY missing — AirLabs yolları atlanır (iptal/divert/plan yok)');
  }
  if (needActive && !fr24Token) {
    console.warn('[check-flight-status] FR24_API_TOKEN missing — active fazda önce FR24; yoksa ADB→AirLabs→AeroAPI zinciri');
  }
  if ((needSemi || needActive) && !aeroApiKey) {
    console.warn('[check-flight-status] AEROAPI_API_KEY missing — FlightAPI (AeroAPI) yedeği devre dışı');
  }

  let updated = 0;
  let tookOffSent = 0;
  let landedSent = 0;
  let landedBackfillSent = 0;
  let cancelledSent = 0;
  let divertedSent = 0;
  let delaySent = 0;
  let semiScheduleUpdates = 0;
  let reconciledTerminal = 0;
  let adaptivePollSkipped = 0;

  const notifyUrl = `${supabaseUrl}/functions/v1/notify-family`;
  const cronHeader = req.headers.get('x-cron-secret') ?? cronSecret;

  for (const row of list) {
    const oldStatus = (row.flight_status as string | null) ?? null;
    const todayUtc = new Date().toISOString().slice(0, 10);
    const isFutureFlightDate = typeof row.flight_date === 'string' && row.flight_date > todayUtc;
    // If a future-dated flight was wrongly marked landed earlier, do not freeze it.
    if ((oldStatus === 'landed' || oldStatus === 'parked') && isFutureFlightDate) {
      // continue processing to allow correction.
    } else if (oldStatus === 'landed' || oldStatus === 'parked' || oldStatus === 'cancelled' || oldStatus === 'diverted') {
      // DB often becomes terminal before cron runs (crew app / flight-lookup). Old behavior: `continue`
      // here skipped notify-family entirely, so aile never got landed/cancelled/diverted. Backfill when
      // notification_log has no row yet (notify-family remains idempotent).
      const phaseEarly = row.api_refresh_phase as string;
      const skipLandedBackfill = isFutureFlightDate && (oldStatus === 'landed' || oldStatus === 'parked');
      // semi_active rows can already be terminal (crew app / provider); only `active` used to run backfill and missed pushes.
      if (['active', 'semi_active'].includes(phaseEarly) && !skipLandedBackfill) {
        const notifType: 'landed' | 'cancelled' | 'diverted' =
          oldStatus === 'cancelled' ? 'cancelled' : oldStatus === 'diverted' ? 'diverted' : 'landed';
        const { data: logHit } = await supabase
          .from('notification_log')
          .select('id')
          .eq('flight_id', row.id)
          .eq('type', notifType)
          .limit(1);
        if (!logHit?.length) {
          const notifRes = await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronHeader },
            body: JSON.stringify({ type: notifType, flightId: row.id }),
          });
          if (notifRes.ok) {
            if (notifType === 'landed') landedSent++;
            else if (notifType === 'cancelled') cancelledSent++;
            else divertedSent++;
          } else {
            console.error(
              '[check-flight-status] notify-family terminal backfill failed',
              notifType,
              row.id,
              notifRes.status,
            );
          }
        }
      }
      continue;
    }

    const phase = row.api_refresh_phase as string;

    if (phase === 'semi_active') {
      const rosterKey = rosterPollCacheKey('semi_active', row.flight_number as string, row.flight_date as string);
      const cachedPoll = await getCachedPayload(supabase, rosterKey);
      if (cachedPoll) {
        const cachePatch = semiActivePatchFromCachedRosterPoll(cachedPoll);
        if (Object.keys(cachePatch).length > 0) {
          const { error: upErr } = await supabase.from('flights').update(cachePatch).eq('id', row.id);
          if (!upErr) semiScheduleUpdates++;
          continue;
        }
      }

      const pollRowSemi = row as unknown as FlightPollRow;
      if (!shouldRunExternalPoll(pollRowSemi, nowMs)) {
        adaptivePollSkipped++;
        continue;
      }

      const al = await fetchTimetableWaterfall(
        row.flight_number as string,
        row.flight_date as string,
        airlabsKey,
        supabase,
        cooldownMap,
      );

      const patch: Record<string, unknown> = {};
      if (al) {
        if (al.scheduledDep) patch.estimated_departure = al.scheduledDep;
        if (al.scheduledArr) patch.estimated_arrival = al.scheduledArr;
        if (al.delayDepMin != null) patch.delay_dep_min = al.delayDepMin;
        if (al.delayArrMin != null) patch.delay_arr_min = al.delayArrMin;
        if (al.progressPercent != null) patch.airlabs_progress_percent = al.progressPercent;
      }

      const semiApiUsed = true;
      const lastPollIso = new Date().toISOString();
      if (Object.keys(patch).length === 0) {
        if (semiApiUsed) {
          if (hasLastPollAtColumn) {
            await supabase.from('flights').update({ last_poll_at: lastPollIso }).eq('id', row.id);
          }
        }
        continue;
      }
      const semiPayload: Record<string, unknown> = { ...patch };
      if (semiApiUsed && hasLastPollAtColumn) semiPayload.last_poll_at = lastPollIso;
      const { error: upErr } = await supabase.from('flights').update(semiPayload).eq('id', row.id);
      if (!upErr) semiScheduleUpdates++;
      continue;
    }

    if (phase !== 'active') continue;

    const pollRowActive = row as unknown as FlightPollRow;
    if (!shouldRunExternalPoll(pollRowActive, nowMs)) {
      adaptivePollSkipped++;
      continue;
    }

    let pickedFr: Fr24Flight | null = null;
    let fr24Ended = false;
    let lastSeenIso: string | undefined;
    let fr24LandedTs: string | undefined;
    let frStatus: DbFlightStatus | null = null;

    if (fr24Token) {
      const f = await selectFr24Flight(
        row.flight_number as string,
        row.flight_date as string,
        fr24Token,
      );
      if (f) {
        pickedFr = f;
        fr24Ended = fr24FlightEnded(f);
        const barPatch = fr24ProgressBarPatch(f);
        Object.assign(barPatch, fr24DatetimeTakeoffUtcPatch(f), fr24FirstSeenUtcPatch(f));
        const landedTs = fr24LandedUtcFromFlight(f);
        if (landedTs) barPatch.fr24_datetime_landed_utc = landedTs;
        if (Object.keys(barPatch).length > 0) {
          await supabase.from('flights').update(barPatch).eq('id', row.id);
        }
        const firstSeen = toUtcIsoAssumeUtc((f.first_seen ?? f.firstSeen) as string | undefined);
        const takeoff = toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined);
        fr24LandedTs = landedTs;
        lastSeenIso = toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined);
        if (!fr24Ended) {
          frStatus = deriveFr24LiveStatus(nowMs, firstSeen, takeoff, landedTs);
        }
      }
    }

    let al: PollTimetableRow | null = null;
    // FR24 yoksa veya bacak bittiyse (flight_ended) timetable — rosterPollEdge ile aynı.
    if (!pickedFr || fr24Ended) {
      al = await fetchTimetableWaterfall(
        row.flight_number as string,
        row.flight_date as string,
        airlabsKey,
        supabase,
        cooldownMap,
      );
      if (al) {
        const alMeta: Record<string, unknown> = {};
        if (al.scheduledDep) alMeta.estimated_departure = al.scheduledDep;
        if (al.scheduledArr) alMeta.estimated_arrival = al.scheduledArr;
        if (al.delayDepMin != null) alMeta.delay_dep_min = al.delayDepMin;
        // İniş sonrası stale ETA/arr_delayed yazma — ATA−STA aşağıda hesaplanır.
        if (al.delayArrMin != null && !fr24LandedTs && !al.actualIn) {
          alMeta.delay_arr_min = al.delayArrMin;
        }
        if (al.progressPercent != null) alMeta.airlabs_progress_percent = al.progressPercent;
        if (Object.keys(alMeta).length > 0) {
          await supabase.from('flights').update(alMeta).eq('id', row.id);
        }
      }
    }

    let newStatus: string | null = null;
    let divertedTo: string | null = null;
    const staForArrDelay = row.scheduled_arrival as string | null | undefined;
    const landedForArrDelay = fr24LandedTs ?? al?.actualIn ?? null;
    const actualArrDelayFromLand =
      landedForArrDelay && staForArrDelay
        ? (() => {
            const d = calcDelayMinutes(landedForArrDelay, staForArrDelay);
            return d == null ? null : Math.max(0, d);
          })()
        : null;
    const currentDepDelay =
      calcDelayMinutes(al?.scheduledDep ?? (row.estimated_departure as string | null | undefined), row.scheduled_departure as string | null | undefined) ??
      al?.delayDepMin ??
      ((row as Record<string, unknown>).delay_dep_min as number | null | undefined) ??
      null;
    const currentArrDelay =
      actualArrDelayFromLand ??
      calcDelayMinutes(al?.scheduledArr ?? (row.estimated_arrival as string | null | undefined), row.scheduled_arrival as string | null | undefined) ??
      al?.delayArrMin ??
      ((row as Record<string, unknown>).delay_arr_min as number | null | undefined) ??
      null;

    const alStatusLower = (al?.status ?? '').toLowerCase();

    if (fr24Ended && pickedFr) {
      const endedPatch: Record<string, unknown> = {
        internal_status: 'landed',
        review_flag: false,
      };
      if (lastSeenIso) endedPatch.last_seen_utc = lastSeenIso;
      if (fr24LandedTs) endedPatch.fr24_datetime_landed_utc = fr24LandedTs;
      if (actualArrDelayFromLand != null) endedPatch.delay_arr_min = actualArrDelayFromLand;

      if (al && airLabsIsCancelled(al.status)) {
        newStatus = 'cancelled';
        endedPatch.internal_status = 'cancelled';
        await supabase.from('flights').update(endedPatch).eq('id', row.id);
      } else if (al && airLabsIsDiverted(al.status)) {
        newStatus = 'diverted';
        divertedTo = al.divertedTo;
        endedPatch.internal_status = 'diverted';
        await supabase.from('flights').update(endedPatch).eq('id', row.id);
      } else if (al?.actualIn && isActualInReliableForCurrentLeg({
        actualInUtc: al.actualIn,
        actualOutUtc: al.actualOut ?? null,
        scheduledDepUtc: (row.scheduled_departure as string | null | undefined) ?? null,
        scheduledArrUtc: (row.scheduled_arrival as string | null | undefined) ?? null,
        nowMs,
      })) {
        newStatus = 'landed';
        endedPatch.actual_arrival = al.actualIn;
        const fromActualIn = calcDelayMinutes(al.actualIn, staForArrDelay);
        if (fromActualIn != null) endedPatch.delay_arr_min = Math.max(0, fromActualIn);
        await supabase.from('flights').update(endedPatch).eq('id', row.id);
      } else {
        // flight_ended=true: datetime_landed yoksa bile landed (last_seen → fr24_datetime_landed_utc).
        newStatus = 'landed';
        if (!endedPatch.actual_arrival && al?.scheduledArr) {
          endedPatch.actual_arrival = al.scheduledArr;
        }
        await supabase.from('flights').update(endedPatch).eq('id', row.id);
      }
    } else if (frStatus != null) {
      newStatus = frStatus;
      const internalPatch: Record<string, unknown> = {
        internal_status: frStatus,
        review_flag: false,
      };
      if (lastSeenIso) internalPatch.last_seen_utc = lastSeenIso;
      await supabase.from('flights').update(internalPatch).eq('id', row.id);
    } else if (al && airLabsIsCancelled(al.status)) {
      newStatus = 'cancelled';
    } else if (al && airLabsIsDiverted(al.status)) {
      newStatus = 'diverted';
      divertedTo = al.divertedTo;
    } else if (al?.actualIn && isActualInReliableForCurrentLeg({
      actualInUtc: al.actualIn,
      actualOutUtc: al.actualOut ?? null,
      scheduledDepUtc: (row.scheduled_departure as string | null | undefined) ?? null,
      scheduledArrUtc: (row.scheduled_arrival as string | null | undefined) ?? null,
      nowMs,
    })) {
      // FR24 yokken iniş fallback'i: AeroAPI actual_in yüksek güven.
      newStatus = 'landed';
      await supabase.from('flights').update({ actual_arrival: al.actualIn, internal_status: 'landed' }).eq('id', row.id);
    } else if (al?.actualOut && mapAirLabsStatus(al.status ?? undefined) === 'scheduled') {
      // FR24 yokken provider lag düzeltmesi.
      newStatus = 'en_route';
      await supabase.from('flights').update({ internal_status: 'en_route', review_flag: false }).eq('id', row.id);
    } else if (al) {
      const st = mapAirLabsStatus(al.status ?? undefined);
      // Fallback landed accepted (AirLabs/ADB/AeroAPI) when FR24 datetime_landed is unavailable.
      if (st === 'landed') {
        newStatus = 'landed';
        const landedPatch: Record<string, unknown> = { internal_status: 'landed' };
        if (al.actualIn) landedPatch.actual_arrival = al.actualIn;
        else if (al.scheduledArr) landedPatch.actual_arrival = al.scheduledArr;
        await supabase.from('flights').update(landedPatch).eq('id', row.id);
      } else if (st) {
        newStatus = st;
        const reviewPatch: Record<string, unknown> = { internal_status: st };
        if (st === 'taxi_out') {
          const std = new Date((row.scheduled_departure as string | null | undefined) ?? '').getTime();
          if (Number.isFinite(std) && nowMs >= std + 90 * 60 * 1000) reviewPatch.review_flag = true;
        }
        await supabase.from('flights').update(reviewPatch).eq('id', row.id);
      }
    }

    // Safety net: planlanan varış +4h geçmişse active'te takılmayı önle.
    if (newStatus == null || newStatus === 'scheduled' || newStatus === 'taxi_out' || newStatus === 'en_route') {
      const schedArrMs = new Date((row.scheduled_arrival as string | null | undefined) ?? '').getTime();
      const schedDepMs = new Date((row.scheduled_departure as string | null | undefined) ?? '').getTime();
      const endMs = Number.isFinite(schedArrMs) ? schedArrMs : (Number.isFinite(schedDepMs) ? schedDepMs + 4 * 60 * 60 * 1000 : NaN);
      const staleBy4h = Number.isFinite(endMs) && nowMs > endMs + 4 * 60 * 60 * 1000;
      const landedEvidenceForStale = hasStrongLandedEvidence({
        fr24LandedUtc: fr24LandedTs ?? null,
        aeroActualInUtc: al?.actualIn ?? null,
        actualArrivalDb: (row.actual_arrival as string | null | undefined) ?? null,
        includeDbActualArrival: false,
      });
      if (staleBy4h && landedEvidenceForStale && (alStatusLower === 'landed' || alStatusLower === 'arrived')) {
        newStatus = 'landed';
      }
    }

    const strongLandedEvidence =
      hasStrongLandedEvidence({
        fr24LandedUtc: fr24LandedTs ?? null,
        aeroActualInUtc: al?.actualIn ?? null,
        actualArrivalDb: (row.actual_arrival as string | null | undefined) ?? null,
        includeDbActualArrival: false,
      }) ||
      (fr24Ended && pickedFr != null);

    // Hard guard: landed requires strong evidence. Prevent early false-landing locks.
    if (newStatus === 'landed' && !strongLandedEvidence) {
      const old = String(oldStatus ?? '').toLowerCase();
      newStatus = old === 'taxi_out' || old === 'departed' || old === 'en_route' ? 'en_route' : 'scheduled';
      console.warn('[check-flight-status] landed blocked (no strong evidence)', {
        flight: row.flight_number,
        flight_date: row.flight_date,
        oldStatus,
        fallback: newStatus,
        alStatus: al?.status ?? null,
        fr24LandedTs: fr24LandedTs ?? null,
        alActualIn: al?.actualIn ?? null,
      });
    }

    // Guardrail: a future roster date should never be finalized as landed.
    if (isFutureFlightDate && newStatus === 'landed') {
      newStatus = 'scheduled';
    }

    const activeApiUsed = Boolean(pickedFr) || Boolean(al) || Boolean(fr24Token) || Boolean(airlabsKey);
    if (activeApiUsed) {
      if (hasLastPollAtColumn) {
        await supabase.from('flights').update({ last_poll_at: new Date().toISOString() }).eq('id', row.id);
      }
    }

    if (newStatus == null) continue;

    // If we now have active-flight evidence, stale arrival must not pin row to landed.
    if ((newStatus === 'en_route' || newStatus === 'taxi_out')) {
      const staleActualArrivalIso = toUtcIsoAssumeUtc((row.actual_arrival as string | null | undefined) ?? null);
      if (staleActualArrivalIso) {
        await supabase.from('flights').update({ actual_arrival: null }).eq('id', row.id);
      }
    }

    if (newStatus !== oldStatus) {
      const updates: Record<string, unknown> = {
        flight_status: newStatus,
        internal_status: internalStatusMirrorForDbFlightStatus(newStatus),
      };
      if (newStatus === 'en_route' || newStatus === 'taxi_out') {
        updates.actual_arrival = null;
      }
      if (newStatus === 'diverted' && divertedTo != null) (updates as any).diverted_to = divertedTo;
      const { error: upErr } = await supabase.from('flights').update(updates).eq('id', row.id);
      if (!upErr) updated++;
    }

    // Auto notifications are only for active-phase flights.
    if (phase !== 'active') continue;

    const sendNotif = async (type: 'took_off' | 'landed' | 'cancelled' | 'diverted'): Promise<boolean> => {
      const { data: existing } = await supabase
        .from('notification_log')
        .select('id')
        .eq('flight_id', row.id)
        .eq('type', type)
        .limit(1);
      if (existing?.length) return false;
      const notifRes = await fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronHeader },
        body: JSON.stringify({ type, flightId: row.id }),
      });
      if (!notifRes.ok) {
        console.error('[check-flight-status] notify-family', type, 'failed', row.id, notifRes.status);
        return false;
      }
      return true;
    };

    const sendDelayNotif = async (
      delayPhase: 'departure' | 'arrival',
      delayMinutes: number,
    ): Promise<boolean> => {
      const notifRes = await fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronHeader },
        body: JSON.stringify({
          type: 'delayed',
          flightId: row.id,
          delayPhase,
          delayMinutes,
        }),
      });
      if (!notifRes.ok) {
        console.error('[check-flight-status] notify-family delayed failed', delayPhase, row.id, notifRes.status);
        return false;
      }
      return true;
    };

    // Delay notification policy:
    // - Only when revised/estimated signal exists (scheduled vs estimated differs >= 5 min).
    // - Threshold starts at 30 min.
    // - Send immediately when detected; dedupe by per-flight bucket columns.
    const depEstIso = (al?.scheduledDep ?? (row.estimated_departure as string | null | undefined) ?? null);
    const depSchIso = (row.scheduled_departure as string | null | undefined) ?? null;
    const arrEstIso = (al?.scheduledArr ?? (row.estimated_arrival as string | null | undefined) ?? null);
    const arrSchIso = (row.scheduled_arrival as string | null | undefined) ?? null;
    const depEstMs = depEstIso ? new Date(depEstIso).getTime() : NaN;
    const depSchMs = depSchIso ? new Date(depSchIso).getTime() : NaN;
    const arrEstMs = arrEstIso ? new Date(arrEstIso).getTime() : NaN;
    const arrSchMs = arrSchIso ? new Date(arrSchIso).getTime() : NaN;
    const depRevisedSignal = Number.isFinite(depEstMs) && Number.isFinite(depSchMs) && Math.abs(depEstMs - depSchMs) >= 5 * 60 * 1000;
    const arrRevisedSignal = Number.isFinite(arrEstMs) && Number.isFinite(arrSchMs) && Math.abs(arrEstMs - arrSchMs) >= 5 * 60 * 1000;

    const depBucketNow = depRevisedSignal ? delayBucket30(currentDepDelay) : null;
    const arrBucketNow = arrRevisedSignal ? delayBucket30(currentArrDelay) : null;
    const depBucketPrevRaw = Number((row as Record<string, unknown>).dep_delay_notified_bucket);
    const arrBucketPrevRaw = Number((row as Record<string, unknown>).arr_delay_notified_bucket);
    const depBucketPrev = Number.isFinite(depBucketPrevRaw) ? depBucketPrevRaw : null;
    const arrBucketPrev = Number.isFinite(arrBucketPrevRaw) ? arrBucketPrevRaw : null;
    const delayBucketPatch: Record<string, unknown> = {};

    if (depBucketNow != null && (depBucketPrev == null || depBucketNow > depBucketPrev)) {
      if (await sendDelayNotif('departure', Math.max(0, Math.round(currentDepDelay ?? 0)))) {
        delaySent++;
        delayBucketPatch.dep_delay_notified_bucket = depBucketNow;
      }
    }
    if (arrBucketNow != null && (arrBucketPrev == null || arrBucketNow > arrBucketPrev)) {
      if (await sendDelayNotif('arrival', Math.max(0, Math.round(currentArrDelay ?? 0)))) {
        delaySent++;
        delayBucketPatch.arr_delay_notified_bucket = arrBucketNow;
      }
    }
    if (Object.keys(delayBucketPatch).length > 0) {
      await supabase.from('flights').update(delayBucketPatch).eq('id', row.id);
    }

    if (newStatus === oldStatus) continue;

    if (newStatus === 'en_route') {
      if (await sendNotif('took_off')) tookOffSent++;
    } else if (newStatus === 'landed') {
      if (strongLandedEvidence && (await sendNotif('landed'))) landedSent++;
    } else if (newStatus === 'cancelled') {
      if (await sendNotif('cancelled')) cancelledSent++;
    } else if (newStatus === 'diverted') {
      if (await sendNotif('diverted')) divertedSent++;
    }
  }

  // Terminal reconcile safety-net:
  // Product rule: passive_past rows must always be landed in DB/UI.
  {
    const { data: passiveRows } = await supabase
      .from('flights')
      .select(
        'id, flight_date, flight_status, internal_status, api_refresh_phase, actual_arrival, fr24_datetime_landed_utc, last_seen_utc, scheduled_arrival, scheduled_departure',
      )
      .eq('api_refresh_phase', 'passive_past')
      .not('flight_status', 'eq', 'landed')
      .gte('flight_date', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .lte('flight_date', new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .limit(200);

    for (const r of passiveRows ?? []) {
      const todayUtc = new Date().toISOString().slice(0, 10);
      const flightDate = (r.flight_date as string | null) ?? null;
      if (flightDate && flightDate > todayUtc) continue;

      const landedIso = toUtcIsoAssumeUtc((r.fr24_datetime_landed_utc as string | null | undefined) ?? null);
      const lastSeenIso = toUtcIsoAssumeUtc((r.last_seen_utc as string | null | undefined) ?? null);
      const actualArrivalIso = toUtcIsoAssumeUtc((r.actual_arrival as string | null | undefined) ?? null);
      const landedEvidence = Boolean(landedIso || actualArrivalIso);
      if (!landedEvidence) {
        continue;
      }

      const patch: Record<string, unknown> = {
        flight_status: 'landed',
        internal_status: 'landed',
        review_flag: false,
      };
      if (landedIso) patch.fr24_datetime_landed_utc = landedIso;
      if (lastSeenIso) patch.last_seen_utc = lastSeenIso;
      const { error: recErr } = await supabase.from('flights').update(patch).eq('id', r.id);
      if (!recErr) reconciledTerminal++;
    }
  }

  // Notify backfill for terminal / en_route rows that are no longer on the poll list (e.g. passive_past) or
  // were never processed in the main loop. Idempotent via notification_log inside notify-family.
  let terminalNotifyBackfill = 0;
  {
    const minD = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const maxD = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayUtc = new Date().toISOString().slice(0, 10);

    const { data: termRows, error: termListErr } = await supabase
      .from('flights')
      .select('id, flight_date, flight_status, actual_arrival, fr24_datetime_landed_utc')
      .eq('roster_entry_kind', 'flight')
      .not('scheduled_departure', 'is', null)
      .in('flight_status', ['landed', 'parked', 'cancelled', 'diverted', 'en_route'])
      .gte('flight_date', minD)
      .lte('flight_date', maxD)
      .limit(200);

    if (termListErr) {
      console.error('[check-flight-status] terminal notify backfill list error', termListErr.message);
    } else {
      for (const tr of termRows ?? []) {
        const fd = (tr.flight_date as string | null) ?? '';
        const isFutureFlightDate = fd > todayUtc;
        const st = (tr.flight_status as string | null) ?? '';

        let notifType: 'took_off' | 'landed' | 'cancelled' | 'diverted' | null = null;
        if (st === 'cancelled') notifType = 'cancelled';
        else if (st === 'diverted') notifType = 'diverted';
        else if (st === 'landed' || st === 'parked') {
          if (isFutureFlightDate) continue;
          const landedEvidence = hasStrongLandedEvidence({
            fr24LandedUtc: (tr as Record<string, unknown>).fr24_datetime_landed_utc as string | null | undefined,
            actualArrivalDb: (tr as Record<string, unknown>).actual_arrival as string | null | undefined,
          });
          if (!landedEvidence) continue;
          notifType = 'landed';
        } else if (st === 'en_route') {
          if (isFutureFlightDate) continue;
          notifType = 'took_off';
        }

        if (!notifType) continue;

        const { data: logHit } = await supabase
          .from('notification_log')
          .select('id')
          .eq('flight_id', tr.id)
          .eq('type', notifType)
          .limit(1);
        if (logHit?.length) continue;

        const notifRes = await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronHeader },
          body: JSON.stringify({ type: notifType, flightId: tr.id }),
        });
        if (notifRes.ok) {
          terminalNotifyBackfill++;
          if (notifType === 'took_off') tookOffSent++;
          else if (notifType === 'landed') landedSent++;
          else if (notifType === 'cancelled') cancelledSent++;
          else if (notifType === 'diverted') divertedSent++;
        } else {
          console.error(
            '[check-flight-status] notify-family terminal backfill (passive list) failed',
            notifType,
            tr.id,
            notifRes.status,
          );
        }
      }
    }
  }

  // Backfill safety-net:
  // Some flights can transition to landed outside this active/semi_active loop (e.g. other updater paths),
  // then notify log stays empty. Try recently-updated passive_past landed rows once.
  const sixHoursAgoIso = new Date(nowMs - 6 * 60 * 60 * 1000).toISOString();
  const { data: recentLanded } = await supabase
    .from('flights')
    .select('id, flight_date, updated_at')
    .eq('roster_entry_kind', 'flight')
    .eq('flight_status', 'landed')
    .eq('api_refresh_phase', 'passive_past')
    .gte('updated_at', sixHoursAgoIso)
    .order('updated_at', { ascending: false })
    .limit(60);
  for (const r of recentLanded ?? []) {
    const flightId = (r as Record<string, unknown>).id as string | undefined;
    if (!flightId) continue;
    const { data: existing } = await supabase
      .from('notification_log')
      .select('id')
      .eq('flight_id', flightId)
      .eq('type', 'landed')
      .limit(1);
    if (existing?.length) continue;
    const notifRes = await fetch(notifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronHeader },
      body: JSON.stringify({ type: 'landed', flightId }),
    });
    if (notifRes.ok) {
      landedBackfillSent++;
    } else {
      console.error('[check-flight-status] notify-family landed backfill failed', flightId, notifRes.status);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: list.length,
      updated,
      semiScheduleUpdates,
      tookOffSent,
      landedSent,
      landedBackfillSent,
      cancelledSent,
      divertedSent,
      delaySent,
      reconciledTerminal,
      terminalNotifyBackfill,
      adaptivePollSkipped,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
