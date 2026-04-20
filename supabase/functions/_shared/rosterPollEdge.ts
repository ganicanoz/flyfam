/**
 * Roster poll (semi_active | active) — mobile/lib/flightStatusPoll.ts ile aynı öncelik:
 * active: FR24 → ADB → AirLabs → AeroAPI; semi: ADB → AirLabs → AeroAPI (FR24 yok).
 * Cooldown: flight_provider_cooldown + apply429ToCooldown.
 */
import {
  fr24LegMatchesRosterDate,
  fr24PrimaryDepUtcIsoForSort,
  fr24ScheduledFieldToUtcIso,
} from './fr24FlightDateMatch.ts';
import { mergeTimetableRowsPreferFirst, timetableRowIsSufficient } from './flightTimetableWaterfall.ts';
import { apply429ToCooldown, isBlockedUntil } from './providerCooldown.ts';

/** Service-role Supabase client (cooldown + cache upserts). */
// deno-lint-ignore no-explicit-any
type SupabaseSvc = any;

const AIRLABS_BASE = 'https://airlabs.co/api/v9';
const AERODATABOX_BASE = 'https://aerodatabox.p.rapidapi.com';
const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';
const FR24_URL = 'https://fr24api.flightradar24.com/api/flight-summary/light';

const COOLDOWN_AIRLABS = 'airlabs';
const COOLDOWN_FR24 = 'fr24';
const COOLDOWN_AERODATABOX = 'aerodatabox';
const COOLDOWN_AERODATABOX_ALT = 'aerodatabox_alt';
const COOLDOWN_AEROAPI = 'aeroapi';

const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS' };

export type RosterPollPhase = 'semi_active' | 'active';

export type RosterPollInfo = Record<string, unknown>;

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
  altitude?: number;
  alt?: number;
  altitude_ft?: number;
  ground_speed?: number;
  groundSpeed?: number;
  speed?: number;
  fr24_id?: string;
  fr24Id?: string;
  id?: string;
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

function fr24ProgressAnchorsFromFr24(f: Fr24Flight): Partial<RosterPollInfo> {
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
  const takeoffIso = toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined);
  const fr24Id = fr24PickString(raw, ['fr24_id', 'fr24Id']) ?? (typeof raw.id === 'string' ? raw.id.trim() : undefined);
  const out: Partial<RosterPollInfo> = {};
  if (takeoffIso) out.fr24_datetime_takeoff_utc = takeoffIso;
  if (depIso && arrIso && t1 > t0) {
    out.fr24_progress_dep_utc = depIso;
    out.fr24_progress_eta_utc = arrIso;
  }
  if (landedIso) out.fr24_datetime_landed_utc = landedIso;
  if (fr24Id) out.fr24Id = fr24Id;
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
  const arrAdj = depN && arrN ? (normalizeOvernightEta(depN, arrN) ?? arrN) : arrN;
  return { dep: depN, arr: arrAdj };
}

function airlabsDivertAirport(o: Record<string, unknown>): string | null {
  const a = o.arr_iata ?? o.arrIata;
  const b = o.arr_icao ?? o.arrIcao;
  const v = (typeof a === 'string' && a.trim()) ? a.trim() : (typeof b === 'string' && b.trim()) ? b.trim() : '';
  return v ? v.toUpperCase().slice(0, 4) : null;
}

function pickAeroDateIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return toUtcIsoAssumeUtc(value) ?? null;
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
  if (depDirect && typeof depDirect === 'object' && arrDirect && typeof arrDirect === 'object') {
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
  actualOut?: string | null;
  actualIn?: string | null;
};

async function fetchAeroDataBoxFlight(
  flightNumber: string,
  flightDate: string,
  supabase: SupabaseSvc,
  cooldownMap: Map<string, number>,
): Promise<PollTimetableRow | null> {
  const rapidKey =
    Deno.env.get('AERODATABOX_RAPIDAPI_KEY') ??
    Deno.env.get('RAPIDAPI_KEY') ??
    Deno.env.get('EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY') ??
    AERODATABOX_RAPIDAPI_FALLBACK;
  if (!rapidKey) return null;
  const apiMarketBase = (Deno.env.get('AERODATABOX_APIMARKET_BASE') ?? '').trim();
  const apiMarketKey = (Deno.env.get('AERODATABOX_APIMARKET_KEY') ?? '').trim();
  // ADB 429 risk: semi/active zincirde fan-out'u sınırlıyoruz.
  const variants = flightNumberVariants(flightNumber).slice(0, 3);
  const sources: Array<{ cooldownKey: string; urls: string[]; headers: Record<string, string> }> = [
    {
      cooldownKey: COOLDOWN_AERODATABOX,
      urls: variants.map((v) =>
        `${AERODATABOX_BASE}/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(flightDate)}?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`
      ),
      headers: {
        'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
        'x-rapidapi-key': rapidKey,
      },
    },
  ];
  if (apiMarketBase && apiMarketKey) {
    const b = apiMarketBase.replace(/\/$/, '');
    sources.push({
      cooldownKey: COOLDOWN_AERODATABOX_ALT,
      urls: variants.map((v) =>
        `${b}/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(flightDate)}?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`
      ),
      headers: {
        'x-api-key': apiMarketKey,
        Authorization: `Bearer ${apiMarketKey}`,
        'User-Agent': 'Mozilla/5.0 FlyFam/1.0',
      },
    });
  }
  for (const src of sources) {
    if (isBlockedUntil(cooldownMap, src.cooldownKey)) continue;
    for (const url of src.urls) {
      try {
        const res = await fetch(url, { headers: src.headers });
        if (res.status === 429) {
          await apply429ToCooldown(supabase, cooldownMap, src.cooldownKey, res.headers);
          continue;
        }
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        const node = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | null;
        if (!node || typeof node !== 'object') continue;
      const { dep, arr } = aeroRootLegs(node);
      const depSched = pickAeroDateIso(
        aeroCoerceTimeString(dep.scheduledTimeUtc) ?? aeroCoerceTimeString(dep.scheduledTime) ?? aeroCoerceTimeString(dep.scheduledTimeLocal),
      );
      const arrSched = pickAeroDateIso(
        aeroCoerceTimeString(arr.scheduledTimeUtc) ?? aeroCoerceTimeString(arr.scheduledTime) ?? aeroCoerceTimeString(arr.scheduledTimeLocal),
      );
      const depExp = pickAeroDateIso(
        aeroCoerceTimeString(dep.predictedTimeUtc) ??
          aeroCoerceTimeString(dep.predictedTime) ??
          aeroCoerceTimeString(dep.estimatedTimeUtc) ??
          aeroCoerceTimeString(dep.estimatedTime),
      );
      const arrExp = pickAeroDateIso(
        aeroCoerceTimeString(arr.predictedTimeUtc) ??
          aeroCoerceTimeString(arr.predictedTime) ??
          aeroCoerceTimeString(arr.estimatedTimeUtc) ??
          aeroCoerceTimeString(arr.estimatedTime),
      );
      const depIso = depSched ?? depExp;
      const arrIso = arrSched ?? arrExp;
      if (!depIso && !arrIso) continue;
      const status = firstDefinedString((node.status as Record<string, unknown> | undefined)?.text, node.status)?.toLowerCase() ?? null;
        return {
          scheduledDep: depIso,
          scheduledArr: arrIso,
          status,
          divertedTo: status?.includes('divert') ? aeroLegAirportCode(arr) : null,
          delayDepMin: null,
          delayArrMin: null,
          progressPercent: null,
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
  supabase: SupabaseSvc,
  cooldownMap: Map<string, number>,
): Promise<{
  scheduledDep: string | null;
  scheduledArr: string | null;
  status: string | null;
  divertedTo: string | null;
  delayDepMin: number | null;
  delayArrMin: number | null;
  progressPercent: number | null;
} | null> {
  if (isBlockedUntil(cooldownMap, COOLDOWN_AIRLABS)) return null;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const match = raw.match(/^([A-Z]{2,3})(\d+)$/);
  const flightIata = match ? `${match[1]}${match[2]}` : raw;
  const icaoVars = flightNumberVariants(flightNumber).filter((v) => v.length >= 5 && /^[A-Z]{3}\d+/.test(v));
  const urls: string[] = [
    `${AIRLABS_BASE}/flight?api_key=${encodeURIComponent(apiKey)}&flight_iata=${encodeURIComponent(flightIata)}`,
  ];
  for (const icaoNum of icaoVars.slice(0, 2)) {
    urls.push(`${AIRLABS_BASE}/flight?api_key=${encodeURIComponent(apiKey)}&flight_icao=${encodeURIComponent(icaoNum)}`);
  }
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await apply429ToCooldown(supabase, cooldownMap, COOLDOWN_AIRLABS, res.headers);
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
      const { delayDepMin, delayArrMin, progressPercent } = airlabsPollExtras(o);
      if (!depIso && !arrIso && !st && delayDepMin == null && delayArrMin == null && progressPercent == null) continue;
      return {
        scheduledDep: depIso,
        scheduledArr: arrIso,
        status: st,
        divertedTo,
        delayDepMin,
        delayArrMin,
        progressPercent,
      };
    } catch {
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

async function fetchAeroApiFlight(
  flightNumber: string,
  flightDate: string,
  supabase: SupabaseSvc,
  cooldownMap: Map<string, number>,
): Promise<PollTimetableRow | null> {
  if (isBlockedUntil(cooldownMap, COOLDOWN_AEROAPI)) return null;
  const apiKey = Deno.env.get('AEROAPI_API_KEY') ?? Deno.env.get('FLIGHTAWARE_AEROAPI_KEY') ?? null;
  if (!apiKey) return null;
  const variants = flightNumberVariants(flightNumber).slice(0, 6);
  const start = new Date(`${flightDate}T00:00:00Z`).toISOString();
  const end = new Date(`${flightDate}T23:59:59Z`).toISOString();
  for (const ident of variants) {
    try {
      const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max_pages=1`;
      const res = await fetch(url, {
        headers: { 'x-apikey': apiKey, Accept: 'application/json' },
      });
      if (res.status === 429) {
        await apply429ToCooldown(supabase, cooldownMap, COOLDOWN_AEROAPI, res.headers);
        continue;
      }
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
      const arr = dep && arrRaw ? (normalizeOvernightEta(dep, arrRaw) ?? arrRaw) : arrRaw;
      if (!isDateNearby(dep ?? actualOut ?? scheduledOut, flightDate)) continue;
      const status = typeof r.status === 'string' ? r.status.toLowerCase() : null;
      return {
        scheduledDep: dep,
        scheduledArr: arr,
        status,
        divertedTo: status?.includes('divert') ? firstDefinedString(r.diverted_airport) : null,
        delayDepMin: calcDelayMinutes(dep, scheduledOut),
        delayArrMin: calcDelayMinutes(arr, scheduledIn),
        progressPercent: null,
        actualOut,
        actualIn,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchTimetableWaterfallEdge(
  flightNumber: string,
  flightDate: string,
  airlabsKey: string | null,
  supabase: SupabaseSvc,
  cooldownMap: Map<string, number>,
): Promise<PollTimetableRow | null> {
  const al = airlabsKey
    ? await fetchAirLabsFlight(flightNumber, flightDate, airlabsKey, supabase, cooldownMap)
    : null;
  if (timetableRowIsSufficient(al)) return al;
  const adb = await fetchAeroDataBoxFlight(flightNumber, flightDate, supabase, cooldownMap);
  if (timetableRowIsSufficient(adb)) return adb;
  const aero = await fetchAeroApiFlight(flightNumber, flightDate, supabase, cooldownMap);
  if (timetableRowIsSufficient(aero)) return aero;
  const m1 = mergeTimetableRowsPreferFirst(al, adb) as PollTimetableRow | null;
  return mergeTimetableRowsPreferFirst(m1, aero) as PollTimetableRow;
}

function mapAirLabsStatus(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const x = s.toLowerCase().replace(/_/g, '-');
  if (x === 'scheduled') return 'scheduled';
  if (x === 'active' || x === 'en-route') return 'en_route';
  if (x === 'landed') return 'landed';
  return undefined;
}

async function selectFr24Flight(
  flightNumber: string,
  date: string,
  token: string,
  supabase: SupabaseSvc,
  cooldownMap: Map<string, number>,
): Promise<Fr24Flight | null> {
  if (isBlockedUntil(cooldownMap, COOLDOWN_FR24)) return null;
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(',');
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m! - 1, d! - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m! - 1, d! + 2, 23, 59, 59));
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
  if (res.status === 429) {
    await apply429ToCooldown(supabase, cooldownMap, COOLDOWN_FR24, res.headers);
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data || !Array.isArray(json.data) || json.data.length === 0) return null;
  const list = json.data as Fr24Flight[];
  const candidates = list.filter((f) =>
    fr24LegMatchesRosterDate(f as unknown as Record<string, unknown>, date)
  );
  if (candidates.length === 0) return null;
  const live = candidates.find((x) => x.flight_ended === false || x.flightEnded === false);
  return (
    live ??
    candidates.sort((a, b) => {
      const ta = fr24PrimaryDepUtcIsoForSort(a as unknown as Record<string, unknown>, date) ?? '';
      const tb = fr24PrimaryDepUtcIsoForSort(b as unknown as Record<string, unknown>, date) ?? '';
      return tb.localeCompare(ta);
    })[0] ??
    null
  );
}

type DbLive = 'scheduled' | 'taxi_out' | 'en_route' | 'landed';

function deriveFr24LiveStatus(
  nowMs: number,
  firstSeenUtc: string | undefined,
  datetimeTakeoffUtc: string | undefined,
  datetimeLandedUtc: string | undefined,
  altitudeFt?: number,
  groundSpeedKts?: number,
): DbLive {
  const first = firstSeenUtc ? new Date(firstSeenUtc).getTime() : 0;
  const takeoff = datetimeTakeoffUtc ? new Date(datetimeTakeoffUtc).getTime() : 0;
  const landed = datetimeLandedUtc ? new Date(datetimeLandedUtc).getTime() : 0;
  const strongAirborne = (altitudeFt ?? -1) > 2000 && (groundSpeedKts ?? -1) > 200;
  if (first > 0 && nowMs < first) return 'scheduled';
  if (first > 0 && (takeoff === 0 || nowMs < takeoff)) {
    if (takeoff === 0 && strongAirborne) return 'en_route';
    return 'taxi_out';
  }
  if (landed > 0 && nowMs >= landed) return 'landed';
  if (takeoff > 0 && (landed === 0 || nowMs < landed)) return 'en_route';
  if (first > 0 && nowMs >= first) return strongAirborne ? 'en_route' : 'taxi_out';
  return 'scheduled';
}

function dbLiveToFlightStatus(s: DbLive): string {
  if (s === 'taxi_out') return 'taxi_out';
  if (s === 'en_route') return 'en_route';
  if (s === 'landed') return 'landed';
  return 'scheduled';
}

function emptyBase(): RosterPollInfo {
  return {
    origin: '',
    destination: '',
    depTime: '',
    arrTime: '',
  };
}

function attachAirLabsTimingFields(
  info: RosterPollInfo,
  al: NonNullable<Awaited<ReturnType<typeof fetchAirLabsFlight>>>,
): void {
  if (al.delayDepMin != null) info.delayDepMin = al.delayDepMin;
  if (al.delayArrMin != null) info.delayArrMin = al.delayArrMin;
  if (al.progressPercent != null) info.airlabsProgressPercent = al.progressPercent;
}

export async function pollRosterFlightEdge(
  flightNumber: string,
  flightDate: string,
  phase: RosterPollPhase,
  ctx: {
    supabase: SupabaseSvc;
    cooldownMap: Map<string, number>;
    airlabsKey: string | null;
    fr24Token: string | null;
  },
): Promise<RosterPollInfo | null> {
  const { supabase, cooldownMap, airlabsKey, fr24Token } = ctx;
  const alKey = airlabsKey;

  if (phase === 'semi_active') {
    const al = await fetchTimetableWaterfallEdge(flightNumber, flightDate, alKey, supabase, cooldownMap);
    const o = { ...emptyBase() };
    if (al) {
      if (al.scheduledDep) o.scheduled_departure_utc = al.scheduledDep;
      if (al.scheduledArr) o.scheduled_arrival_utc = al.scheduledArr;
      attachAirLabsTimingFields(o, al);
    }
    if (
      !o.scheduled_departure_utc &&
      !o.scheduled_arrival_utc &&
      o.delayDepMin == null &&
      o.delayArrMin == null &&
      o.airlabsProgressPercent == null &&
      !o.fr24_progress_dep_utc
    ) {
      return null;
    }
    return o;
  }

  const nowMs = Date.now();
  if (fr24Token) {
    const f = await selectFr24Flight(flightNumber, flightDate, fr24Token, supabase, cooldownMap);
    if (f) {
      const bar = fr24ProgressAnchorsFromFr24(f);
      const ended = f.flight_ended === true || f.flightEnded === true;
      if (!ended) {
        const firstSeen = toUtcIsoAssumeUtc((f.first_seen ?? f.firstSeen) as string | undefined);
        const takeoff = toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined);
        const landedTs = toUtcIsoAssumeUtc((f.datetime_landed ?? f.datetimeLanded) as string | undefined);
        const lastSeen = toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined);
        const altitudeFtRaw = Number((f.altitude_ft ?? f.altitude ?? f.alt) as number | undefined);
        const groundSpeedKtsRaw = Number((f.ground_speed ?? f.groundSpeed ?? f.speed) as number | undefined);
        const altitudeFt = Number.isFinite(altitudeFtRaw) ? altitudeFtRaw : undefined;
        const groundSpeedKts = Number.isFinite(groundSpeedKtsRaw) ? groundSpeedKtsRaw : undefined;
        const live = deriveFr24LiveStatus(nowMs, firstSeen, takeoff, landedTs, altitudeFt, groundSpeedKts);
        return {
          ...emptyBase(),
          flightStatus: dbLiveToFlightStatus(live),
          lastTrackUtc: lastSeen,
          ...(firstSeen ? { first_seen_utc: firstSeen } : {}),
          ...bar,
        };
      }
      const endedLastSeen = toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined);
      const endedLastSeenMs = endedLastSeen ? new Date(endedLastSeen).getTime() : 0;
      const alEnded = await fetchTimetableWaterfallEdge(flightNumber, flightDate, alKey, supabase, cooldownMap);
      const slE = alEnded?.status?.toLowerCase();
      if (slE === 'cancelled' || slE === 'canceled') {
        const o = { ...emptyBase(), flightStatus: 'cancelled', ...bar };
        if (alEnded) attachAirLabsTimingFields(o, alEnded);
        return o;
      }
      if (slE === 'diverted') {
        const o = {
          ...emptyBase(),
          flightStatus: 'diverted',
          divertedTo: alEnded?.divertedTo ?? undefined,
          ...bar,
        };
        if (alEnded) attachAirLabsTimingFields(o, alEnded);
        return o;
      }
      if (alEnded?.actualIn) {
        const o = { ...emptyBase(), flightStatus: 'landed', ...bar };
        attachAirLabsTimingFields(o, alEnded);
        return o;
      }
      if (alEnded?.actualOut && (slE === 'scheduled' || !slE)) {
        // Sadece en_route kalacak akışta last_seen ile landed'a yükselt.
        if (Number.isFinite(endedLastSeenMs) && endedLastSeenMs > 0 && nowMs >= endedLastSeenMs) {
          const o = { ...emptyBase(), flightStatus: 'landed', ...bar, lastTrackUtc: endedLastSeen };
          attachAirLabsTimingFields(o, alEnded);
          return o;
        }
        const o = { ...emptyBase(), flightStatus: 'en_route', ...bar };
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
      return null;
    }
  }

  const al = await fetchTimetableWaterfallEdge(flightNumber, flightDate, alKey, supabase, cooldownMap);
  const sl = al?.status?.toLowerCase();
  if (sl === 'cancelled' || sl === 'canceled') {
    const o = { ...emptyBase(), flightStatus: 'cancelled' };
    if (al) attachAirLabsTimingFields(o, al);
    return o;
  }
  if (sl === 'diverted') {
    const o = { ...emptyBase(), flightStatus: 'diverted', divertedTo: al?.divertedTo ?? undefined };
    if (al) attachAirLabsTimingFields(o, al);
    return o;
  }
  if (al?.actualIn) {
    const o = { ...emptyBase(), flightStatus: 'landed' };
    attachAirLabsTimingFields(o, al);
    return o;
  }
  if (al?.actualOut && (sl === 'scheduled' || !sl)) {
    const o = { ...emptyBase(), flightStatus: 'en_route' };
    attachAirLabsTimingFields(o, al);
    return o;
  }

  if (al) {
    const st = mapAirLabsStatus(al.status ?? undefined);
    if (st && st !== 'landed') {
      const o = { ...emptyBase(), flightStatus: st };
      attachAirLabsTimingFields(o, al);
      return o;
    }
  }

  return null;
}
