/**
 * fetchFlightByNumber — mobile/lib/flightApi.ts ile aynı akış (AirLabs nearest bugün/yarın + FR24 + AirLabs tamamlama).
 * Timetable zincirinde plan hâlâ zayıfsa FlightAPI Flight Tracking (`/airline/{key}`) yedek olarak devreye girer (`FLIGHTAPI_API_KEY`).
 * Yerel tarih: istemci local_today / local_tomorrow gönderir.
 */
import { buildAerodataboxFlightNumberSources } from './aerodataboxHttp.ts';
import { apply429ToCooldown, isBlockedUntil } from './providerCooldown.ts';
import { fr24TurkeyPakistanScheduleTooShort } from './fr24TurkeyPakistanSanity.ts';
import {
  fr24PrimaryDepUtcIsoForSort,
  fr24ScheduledFieldToUtcIso,
  utcFieldOrAirportLocalToUtcIso,
  utcIsoToLocalDateAtAirport,
} from './fr24FlightDateMatch.ts';

const AIRLABS_BASE = 'https://airlabs.co/api/v9';
const AERODATABOX_BASE = 'https://aerodatabox.p.rapidapi.com';
const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const AVIATIONSTACK_BASE = 'https://api.aviationstack.com/v1';
/** Env yoksa RapidAPI key (kullanıcı isteği); üretimde `AERODATABOX_RAPIDAPI_KEY` secret tercih edilir. */
const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';
const FR24_URL = 'https://fr24api.flightradar24.com/api/flight-summary/light';
const COOLDOWN_AIRLABS = 'airlabs';
const COOLDOWN_FR24 = 'fr24';
const COOLDOWN_AEROAPI = 'aeroapi';
const COOLDOWN_AVIATIONSTACK = 'aviationstack';
const COOLDOWN_AERODATABOX = 'aerodatabox';
const COOLDOWN_AERODATABOX_ALT = 'aerodatabox_alt';
const COOLDOWN_FLIGHTAPI = 'flightapi';

const IATA_TO_ICAO: Record<string, string> = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

// deno-lint-ignore no-explicit-any
export type FlightByNumberCtx = { supabase: any; cooldownMap: Map<string, number>; airlabsKey: string | null; fr24Token: string | null };

export type FlightInfoJson = Record<string, unknown>;

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

function parseTime(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string') return '';
  if (iso.includes('T')) {
    const part = iso.split('T')[1];
    return part ? part.slice(0, 5) : '';
  }
  if (/^\d{1,2}:\d{2}/.test(iso)) return iso.slice(0, 5);
  return '';
}

function mapAirLabsResponseStatus(status: string | undefined): string | undefined {
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

function firstDefinedString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function aeroCoerceUtcString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.utc === 'string' && o.utc.trim()) return o.utc.trim();
  }
  return undefined;
}

function aeroCoerceLocalString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.local === 'string' && o.local.trim()) return o.local.trim();
  }
  return undefined;
}

/** UTC alanı ayrı; Local asla assumeUtc ile Zulu yapılmaz. */
function aeroPickScheduledUtc(leg: Record<string, unknown>, airportCode: string): string | undefined {
  return utcFieldOrAirportLocalToUtcIso(
    aeroCoerceUtcString(leg.scheduledTimeUtc),
    aeroCoerceLocalString(leg.scheduledTimeLocal) ??
      (typeof leg.scheduledTime === 'string' ? leg.scheduledTime : aeroCoerceLocalString(leg.scheduledTime)),
    airportCode,
  );
}

function aeroPickExpectedUtc(leg: Record<string, unknown>, airportCode: string): string | undefined {
  return utcFieldOrAirportLocalToUtcIso(
    aeroCoerceUtcString(leg.predictedTimeUtc) ??
      aeroCoerceUtcString(leg.estimatedTimeUtc) ??
      aeroCoerceUtcString(leg.expectedTimeUtc),
    aeroCoerceLocalString(leg.predictedTimeLocal) ??
      aeroCoerceLocalString(leg.estimatedTimeLocal) ??
      aeroCoerceLocalString(leg.expectedTimeLocal) ??
      aeroCoerceLocalString(leg.predictedTime) ??
      aeroCoerceLocalString(leg.estimatedTime) ??
      aeroCoerceLocalString(leg.expectedTime) ??
      (typeof leg.predictedTime === 'string' ? leg.predictedTime : undefined) ??
      (typeof leg.estimatedTime === 'string' ? leg.estimatedTime : undefined) ??
      (typeof leg.expectedTime === 'string' ? leg.expectedTime : undefined),
    airportCode,
  );
}

function aeroPickActualUtc(leg: Record<string, unknown>, airportCode: string): string | undefined {
  return utcFieldOrAirportLocalToUtcIso(
    aeroCoerceUtcString(leg.actualTimeUtc) ??
      aeroCoerceUtcString(leg.runwayTimeUtc) ??
      aeroCoerceUtcString(leg.outTimeUtc),
    aeroCoerceLocalString(leg.actualTimeLocal) ??
      aeroCoerceLocalString(leg.runwayTimeLocal) ??
      (typeof leg.actualTime === 'string' ? leg.actualTime : undefined),
    airportCode,
  );
}

function aeroLegAirportAndCity(leg: Record<string, unknown>): { code: string; city: string | undefined } {
  const ap = leg.airport;
  if (ap && typeof ap === 'object') {
    const a = ap as Record<string, unknown>;
    const iata = typeof a.iata === 'string' ? a.iata.trim().toUpperCase() : '';
    const icao = typeof a.icao === 'string' ? a.icao.trim().toUpperCase() : '';
    const code = (iata || icao || '').slice(0, 4);
    const city =
      typeof a.municipalityName === 'string'
        ? a.municipalityName
        : typeof a.name === 'string'
        ? a.name
        : undefined;
    return { code, city: city?.trim() || undefined };
  }
  const flat =
    (typeof leg.iata === 'string' ? leg.iata : typeof leg.icao === 'string' ? leg.icao : '')?.trim().toUpperCase() ?? '';
  return { code: flat.slice(0, 4), city: undefined };
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

function parseAeroDataBoxFlightResponse(payload: unknown): FlightInfoJson | null {
  const obj = payload as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return null;
  const arr = Array.isArray(obj) ? obj : null;
  const root = (arr?.[0] ?? obj) as Record<string, unknown>;
  if (!root || typeof root !== 'object') return null;

  const { dep, arr: arrv } = aeroRootLegs(root);

  const depAp = aeroLegAirportAndCity(dep);
  const arrAp = aeroLegAirportAndCity(arrv);
  const origin = depAp.code || '';
  const destination = arrAp.code || '';

  const depSched = aeroPickScheduledUtc(dep, origin);
  const arrSched = aeroPickScheduledUtc(arrv, destination);
  const depExp = aeroPickExpectedUtc(dep, origin);
  const arrExp = aeroPickExpectedUtc(arrv, destination);
  const depIso = depSched ?? depExp;
  const arrIso = arrSched ?? arrExp;
  const depActual = aeroPickActualUtc(dep, origin);
  const arrActual = aeroPickActualUtc(arrv, destination);

  const statusRaw = firstDefinedString((root.status as Record<string, unknown> | undefined)?.text, root.status?.toString())?.toLowerCase();
  const mappedStatus =
    statusRaw?.includes('en-route') || statusRaw?.includes('en route') || statusRaw?.includes('airborne')
      ? 'en_route'
      : statusRaw?.includes('scheduled')
      ? 'scheduled'
      : statusRaw?.includes('landed') || statusRaw?.includes('arrived')
      ? 'landed'
      : statusRaw?.includes('cancel')
      ? 'cancelled'
      : statusRaw?.includes('divert')
      ? 'diverted'
      : undefined;

  if (!depIso && !arrIso && !origin && !destination) return null;
  return {
    origin: origin ?? '',
    destination: destination ?? '',
    originCity: depAp.city,
    destinationCity: arrAp.city,
    depTime: parseTime(depIso),
    arrTime: parseTime(arrIso),
    scheduled_departure_utc: depIso,
    scheduled_arrival_utc: arrIso,
    actual_departure_utc: depActual,
    actual_arrival_utc: arrActual,
    flightStatus: mappedStatus,
  };
}

function timetableNeedsAeroFill(al: FlightInfoJson | null | undefined): boolean {
  if (!al) return true;
  const noSched = !al.scheduled_departure_utc || !al.scheduled_arrival_utc;
  const o = String(al.origin ?? '').trim();
  const d = String(al.destination ?? '').trim();
  const noRoute = !o || !d;
  const noCity = !al.originCity || !al.destinationCity;
  return noSched || noRoute || noCity;
}

function mergeAirLabsWithAeroBackup(al: FlightInfoJson | null, adb: FlightInfoJson | null): FlightInfoJson | null {
  if (!al && !adb) return null;
  if (!al) return adb;
  if (!adb) return al;
  return {
    ...al,
    origin: String(al.origin ?? '').trim() || adb.origin,
    destination: String(al.destination ?? '').trim() || adb.destination,
    originCity: al.originCity ?? adb.originCity,
    destinationCity: al.destinationCity ?? adb.destinationCity,
    scheduled_departure_utc: al.scheduled_departure_utc ?? adb.scheduled_departure_utc,
    scheduled_arrival_utc: al.scheduled_arrival_utc ?? adb.scheduled_arrival_utc,
    actual_departure_utc: al.actual_departure_utc ?? adb.actual_departure_utc,
    actual_arrival_utc: al.actual_arrival_utc ?? adb.actual_arrival_utc,
    depTime: (al.depTime as string) || (adb.depTime as string) || '',
    arrTime: (al.arrTime as string) || (adb.arrTime as string) || '',
    flightStatus: al.flightStatus ?? adb.flightStatus,
    delayDepMin: al.delayDepMin ?? adb.delayDepMin,
    delayArrMin: al.delayArrMin ?? adb.delayArrMin,
    delayed: al.delayed ?? adb.delayed,
    airlabsProgressPercent: al.airlabsProgressPercent ?? adb.airlabsProgressPercent,
  };
}

async function fetchFromAeroDataBoxFlightEdge(
  ctx: FlightByNumberCtx,
  flightNumber: string,
  flightDate: string,
): Promise<FlightInfoJson | null> {
  // Per-provider cooldown is persisted by providerCooldown helper.
  const rapidKey =
    Deno.env.get('AERODATABOX_RAPIDAPI_KEY') ??
    Deno.env.get('RAPIDAPI_KEY') ??
    Deno.env.get('EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY') ??
    AERODATABOX_RAPIDAPI_FALLBACK;
  const variants = flightNumberVariants(flightNumber).slice(0, 6);
  const sources = buildAerodataboxFlightNumberSources(variants, flightDate, rapidKey);
  if (!sources.length) return null;
  for (const src of sources) {
    if (isBlockedUntil(ctx.cooldownMap, src.cooldownKey)) continue;
    for (const url of src.urls) {
      try {
        const res = await fetch(url, { headers: src.headers });
        if (res.status === 429) {
          await apply429ToCooldown(ctx.supabase, ctx.cooldownMap, src.cooldownKey, res.headers);
          continue;
        }
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        const parsed = parseAeroDataBoxFlightResponse(json);
        if (parsed && (parsed.scheduled_departure_utc || parsed.scheduled_arrival_utc || parsed.origin || parsed.destination)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

function isDateNearby(iso: string | null | undefined, flightDate: string): boolean {
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

/** AeroAPI / AviationStack / FlightAPI için gece taşan ETA düzeltmesi. */
function normalizeOvernightEta(depUtcIso: string | undefined, etaUtcIso: string | undefined): string | undefined {
  if (!depUtcIso || !etaUtcIso) return etaUtcIso;
  const depMs = new Date(depUtcIso).getTime();
  const etaMs = new Date(etaUtcIso).getTime();
  if (Number.isNaN(depMs) || Number.isNaN(etaMs)) return etaUtcIso;
  if (etaMs < depMs) return new Date(etaMs + 24 * 60 * 60 * 1000).toISOString();
  return etaUtcIso;
}

/** FlightAPI ve benzeri: offset’li ISO veya parse edilebilir string → UTC ISO. */
function parseAnyIsoToUtc(s: unknown): string | undefined {
  if (typeof s !== 'string' || !s.trim()) return undefined;
  const t = new Date(s.trim()).getTime();
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

function parseFlightApiAirlineResponse(payload: unknown, flightDate: string): FlightInfoJson | null {
  let rows: unknown[] = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === 'object') {
    const p = payload as { data?: unknown[]; departure?: unknown; arrival?: unknown; flights?: unknown[] };
    if (Array.isArray(p.data)) rows = p.data;
    else if (p.departure || p.arrival) rows = [payload];
    else if (Array.isArray(p.flights)) rows = p.flights;
  }
  if (!rows.length) return null;
  let depLeg: Record<string, unknown> | null = null;
  let arrLeg: Record<string, unknown> | null = null;
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const d = o.departure;
    const a = o.arrival;
    if (d && typeof d === 'object' && !depLeg) depLeg = d as Record<string, unknown>;
    if (a && typeof a === 'object' && !arrLeg) arrLeg = a as Record<string, unknown>;
  }
  if (!depLeg && !arrLeg) return null;
  const std = parseAnyIsoToUtc(depLeg?.departureDateTime) ?? parseAnyIsoToUtc(depLeg?.scheduledTime);
  const etd = parseAnyIsoToUtc(depLeg?.estimatedTime);
  const sta = parseAnyIsoToUtc(arrLeg?.arrivalDateTime) ?? parseAnyIsoToUtc(arrLeg?.scheduledTime);
  const eta = parseAnyIsoToUtc(arrLeg?.estimatedTime);
  const dep = etd ?? std;
  const arrRaw = eta ?? sta;
  const arr = dep && arrRaw ? (normalizeOvernightEta(dep, arrRaw) ?? arrRaw) : arrRaw;
  const dateAnchor = dep ?? std ?? arr ?? eta;
  if (dateAnchor && !isDateNearby(dateAnchor, flightDate)) return null;
  const origin = toIataCode(depLeg?.airportCode as string | undefined);
  const destination = toIataCode(arrLeg?.airportCode as string | undefined);
  if (!dep && !arr && !origin && !destination) return null;
  return {
    origin: origin ?? '',
    destination: destination ?? '',
    originCity: typeof depLeg?.airportCity === 'string' ? depLeg.airportCity : undefined,
    destinationCity: typeof arrLeg?.airportCity === 'string' ? arrLeg.airportCity : undefined,
    depTime: dep ? parseTime(dep) : '',
    arrTime: arr ? parseTime(arr) : '',
    scheduled_departure_utc: dep,
    scheduled_arrival_utc: arr,
    flightStatus: undefined,
  };
}

async function fetchFromFlightApiAirlineEdge(
  ctx: FlightByNumberCtx,
  flightNumber: string,
  flightDate: string,
): Promise<FlightInfoJson | null> {
  if (isBlockedUntil(ctx.cooldownMap, COOLDOWN_FLIGHTAPI)) return null;
  const apiKey =
    (Deno.env.get('FLIGHTAPI_API_KEY') ?? Deno.env.get('EXPO_PUBLIC_FLIGHTAPI_API_KEY') ?? Deno.env.get('FLIGHT_API_KEY') ?? '')
      .trim() || null;
  if (!apiKey) return null;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  const m = raw.match(/^([A-Z]{2})(\d+)$/);
  if (!m) return null;
  const airline = m[1];
  const numStr = String(Number.parseInt(m[2], 10));
  const dateCompact = flightDate.replace(/-/g, '');
  const base = `https://api.flightapi.io/airline/${encodeURIComponent(apiKey)}?num=${encodeURIComponent(numStr)}&name=${encodeURIComponent(airline)}&date=${encodeURIComponent(dateCompact)}`;
  const urls = [base];
  const icao = IATA_TO_ICAO[airline];
  if (icao) {
    urls.push(
      `https://api.flightapi.io/airline/${encodeURIComponent(apiKey)}?num=${encodeURIComponent(numStr)}&name=${encodeURIComponent(icao)}&date=${encodeURIComponent(dateCompact)}`,
    );
  }
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await apply429ToCooldown(ctx.supabase, ctx.cooldownMap, COOLDOWN_FLIGHTAPI, res.headers);
        return null;
      }
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      if (json && typeof json === 'object' && (json as { success?: boolean }).success === false) continue;
      const parsed = parseFlightApiAirlineResponse(json, flightDate);
      if (parsed && (parsed.scheduled_departure_utc || parsed.scheduled_arrival_utc || parsed.origin || parsed.destination)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchFromAeroApiFlightEdge(
  ctx: FlightByNumberCtx,
  flightNumber: string,
  flightDate: string,
): Promise<FlightInfoJson | null> {
  if (isBlockedUntil(ctx.cooldownMap, COOLDOWN_AEROAPI)) return null;
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
        await apply429ToCooldown(ctx.supabase, ctx.cooldownMap, COOLDOWN_AEROAPI, res.headers);
        continue;
      }
      if (!res.ok) continue;
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!json || !Array.isArray(json.flights) || json.flights.length === 0) continue;
      const f = json.flights[0] as Record<string, unknown>;
      const std = toUtcIsoAssumeUtc((f.scheduled_out as string | undefined) ?? null) ?? undefined;
      const etd = toUtcIsoAssumeUtc((f.estimated_out as string | undefined) ?? null) ?? undefined;
      const atd = toUtcIsoAssumeUtc((f.actual_out as string | undefined) ?? null) ?? undefined;
      const sta = toUtcIsoAssumeUtc((f.scheduled_in as string | undefined) ?? null) ?? undefined;
      const eta = toUtcIsoAssumeUtc((f.estimated_in as string | undefined) ?? null) ?? undefined;
      const ata = toUtcIsoAssumeUtc((f.actual_in as string | undefined) ?? null) ?? undefined;
      const dep = etd ?? std;
      const arrRaw = eta ?? sta;
      const arr = dep && arrRaw ? (normalizeOvernightEta(dep, arrRaw) ?? arrRaw) : arrRaw;
      if (!isDateNearby(dep ?? atd ?? std, flightDate)) continue;
      const status = typeof f.status === 'string' ? f.status.toLowerCase() : '';
      return {
        origin: toIataCode((f.origin?.code_iata as string | undefined) ?? (f.origin?.code as string | undefined)) ?? '',
        destination: toIataCode((f.destination?.code_iata as string | undefined) ?? (f.destination?.code as string | undefined)) ?? '',
        depTime: dep ? parseTime(dep) : '',
        arrTime: arr ? parseTime(arr) : '',
        scheduled_departure_utc: dep,
        scheduled_arrival_utc: arr,
        actual_departure_utc: atd,
        actual_arrival_utc: ata,
        flightStatus: ata ? 'landed' : atd ? 'en_route' : status.includes('cancel') ? 'cancelled' : status.includes('divert') ? 'diverted' : undefined,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchFromAviationstackFlightEdge(
  ctx: FlightByNumberCtx,
  flightNumber: string,
  flightDate: string,
): Promise<FlightInfoJson | null> {
  if (isBlockedUntil(ctx.cooldownMap, COOLDOWN_AVIATIONSTACK)) return null;
  const apiKey = Deno.env.get('AVIATIONSTACK_API_KEY') ?? Deno.env.get('EXPO_PUBLIC_AVIATIONSTACK_API_KEY') ?? null;
  if (!apiKey) return null;
  const variants = flightNumberVariants(flightNumber).slice(0, 6);
  for (const ident of variants) {
    try {
      const isIcao = /^[A-Z]{3}\d+/.test(ident);
      const q = isIcao ? `flight_icao=${encodeURIComponent(ident)}` : `flight_iata=${encodeURIComponent(ident)}`;
      const url = `${AVIATIONSTACK_BASE}/flights?access_key=${encodeURIComponent(apiKey)}&${q}&limit=5`;
      const res = await fetch(url);
      if (res.status === 429) {
        await apply429ToCooldown(ctx.supabase, ctx.cooldownMap, COOLDOWN_AVIATIONSTACK, res.headers);
        continue;
      }
      if (!res.ok) continue;
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      const list = Array.isArray(json?.data) ? (json?.data as Record<string, unknown>[]) : [];
      if (!list.length) continue;
      const row = list[0];
      const depObj = (row.departure as Record<string, unknown> | undefined) ?? {};
      const arrObj = (row.arrival as Record<string, unknown> | undefined) ?? {};
      const std = toUtcIsoAssumeUtc((depObj.scheduled as string | undefined) ?? null) ?? undefined;
      const etd = toUtcIsoAssumeUtc((depObj.estimated as string | undefined) ?? null) ?? undefined;
      const atd = toUtcIsoAssumeUtc((depObj.actual as string | undefined) ?? null) ?? undefined;
      const sta = toUtcIsoAssumeUtc((arrObj.scheduled as string | undefined) ?? null) ?? undefined;
      const eta = toUtcIsoAssumeUtc((arrObj.estimated as string | undefined) ?? null) ?? undefined;
      const ata = toUtcIsoAssumeUtc((arrObj.actual as string | undefined) ?? null) ?? undefined;
      const dep = etd ?? std;
      const arrRaw = eta ?? sta;
      const arr = dep && arrRaw ? (normalizeOvernightEta(dep, arrRaw) ?? arrRaw) : arrRaw;
      if (!isDateNearby(dep ?? atd ?? std, flightDate)) continue;
      const st = typeof row.flight_status === 'string' ? row.flight_status.toLowerCase() : '';
      return {
        origin: toIataCode((depObj.iata as string | undefined) ?? (depObj.icao as string | undefined)) ?? '',
        destination: toIataCode((arrObj.iata as string | undefined) ?? (arrObj.icao as string | undefined)) ?? '',
        depTime: dep ? parseTime(dep) : '',
        arrTime: arr ? parseTime(arr) : '',
        scheduled_departure_utc: dep,
        scheduled_arrival_utc: arr,
        actual_departure_utc: atd,
        actual_arrival_utc: ata,
        flightStatus: ata ? 'landed' : atd ? 'en_route' : st.includes('cancel') ? 'cancelled' : st.includes('divert') ? 'diverted' : undefined,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function toIataCode(code: string | null | undefined): string | undefined {
  if (!code || typeof code !== 'string') return undefined;
  return code.trim().toUpperCase() || undefined;
}

function deriveFr24LiveStatus(
  nowMs: number,
  firstSeenUtc: string | undefined,
  datetimeTakeoffUtc: string | undefined,
  datetimeLandedUtc: string | undefined,
): string {
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

function airlabsUnixTsToIso(ts: unknown): string | undefined {
  if (typeof ts === 'number' && ts > 1e9) {
    const ms = new Date(ts * 1000).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return undefined;
}

async function fetchFromAirLabsFlightEdge(
  ctx: FlightByNumberCtx,
  flightNumber: string,
  fallbackDateYmd?: string,
): Promise<FlightInfoJson | null> {
  const apiKey = ctx.airlabsKey;
  if (!apiKey) return null;
  if (isBlockedUntil(ctx.cooldownMap, COOLDOWN_AIRLABS)) return null;
  const raw = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (!raw) return null;
  const variants = flightNumberVariants(raw);
  for (const v of variants) {
    try {
      const useIcao = /^[A-Z]{3}\d+$/.test(v);
      const qs = useIcao ? `flight_icao=${encodeURIComponent(v)}` : `flight_iata=${encodeURIComponent(v)}`;
      const url = `${AIRLABS_BASE}/flight?${qs}&api_key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (res.status === 429) {
        await apply429ToCooldown(ctx.supabase, ctx.cooldownMap, COOLDOWN_AIRLABS, res.headers);
        break;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) continue;
      const f: Record<string, unknown> = json?.response ?? json;
      if (!f || typeof f !== 'object') continue;
      const origin = toIataCode((f.dep_iata ?? f.dep_icao) as string | undefined) ?? '';
      const destination = toIataCode((f.arr_iata ?? f.arr_icao) as string | undefined) ?? '';
      // AirLabs: scheduled için dep_time_ts (Unix) en güvenilir; estimated_ts gecikmeli olabilir.
      const depIso =
        airlabsUnixTsToIso(f.dep_time_ts) ??
        utcFieldOrAirportLocalToUtcIso(
          f.dep_time_utc as string | undefined,
          (f.dep_time ?? f.dep_estimated) as string | undefined,
          origin,
          fallbackDateYmd,
        );
      const arrIso =
        airlabsUnixTsToIso(f.arr_time_ts) ??
        utcFieldOrAirportLocalToUtcIso(
          f.arr_time_utc as string | undefined,
          (f.arr_time ?? f.arr_estimated) as string | undefined,
          destination,
          fallbackDateYmd,
        );
      const depActualIso = utcFieldOrAirportLocalToUtcIso(
        f.dep_actual_utc as string | undefined,
        f.dep_actual as string | undefined,
        origin,
        fallbackDateYmd,
      );
      const arrActualIso = utcFieldOrAirportLocalToUtcIso(
        f.arr_actual_utc as string | undefined,
        f.arr_actual as string | undefined,
        destination,
        fallbackDateYmd,
      );
      const mapped = mapAirLabsResponseStatus(typeof f.status === 'string' ? f.status : undefined);
      const out: FlightInfoJson = {
        origin,
        destination,
        originCity: typeof f.dep_city === 'string' ? f.dep_city : undefined,
        destinationCity: typeof f.arr_city === 'string' ? f.arr_city : undefined,
        depTime: parseTime(depIso),
        arrTime: parseTime(arrIso),
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

async function fetchFromTimetablePrimaryEdge(
  ctx: FlightByNumberCtx,
  flightNumber: string,
  flightDate: string,
): Promise<FlightInfoJson | null> {
  const al = await fetchFromAirLabsFlightEdge(ctx, flightNumber, flightDate);
  const adb = timetableNeedsAeroFill(al) ? await fetchFromAeroDataBoxFlightEdge(ctx, flightNumber, flightDate) : null;
  let merged = mergeAirLabsWithAeroBackup(al, adb);
  const uncertain = timetableNeedsAeroFill(merged) || String(merged?.flightStatus ?? '').toLowerCase() === 'landed';
  if (uncertain) {
    const aero = await fetchFromAeroApiFlightEdge(ctx, flightNumber, flightDate);
    if (aero) merged = mergeAirLabsWithAeroBackup(merged, aero);
    if (!aero) {
      const av = await fetchFromAviationstackFlightEdge(ctx, flightNumber, flightDate);
      if (av) merged = mergeAirLabsWithAeroBackup(merged, av);
    }
  }
  if (timetableNeedsAeroFill(merged)) {
    const fapi = await fetchFromFlightApiAirlineEdge(ctx, flightNumber, flightDate);
    if (fapi) merged = mergeAirLabsWithAeroBackup(merged, fapi);
  }
  return merged;
}

/** FR24 flight-summary/light — deep link ve by_number ile paylaşılır. */
export async function fetchFromFlightradar24Edge(
  ctx: FlightByNumberCtx,
  flightNumber: string,
  date: string,
): Promise<FlightInfoJson | null> {
  const token = ctx.fr24Token;
  if (!token) return null;
  if (isBlockedUntil(ctx.cooldownMap, COOLDOWN_FR24)) return null;
  const variants = flightNumberVariants(flightNumber);
  const flightsParam = variants.slice(0, 15).join(',');
  const [y, m, d] = date.split('-').map(Number);
  const fromDate = new Date(Date.UTC(y, m! - 1, d! - 2, 0, 0, 0));
  const toDate = new Date(Date.UTC(y, m! - 1, d! + 2, 23, 59, 59));
  const from = fromDate.toISOString().slice(0, 19);
  const to = toDate.toISOString().slice(0, 19);
  try {
    const url =
      `${FR24_URL}?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Version': 'v1',
      },
    });
    if (res.status === 429) {
      await apply429ToCooldown(ctx.supabase, ctx.cooldownMap, COOLDOWN_FR24, res.headers);
      return null;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.data || !Array.isArray(json.data) || json.data.length === 0) return null;
    const list = json.data as Record<string, unknown>[];
    const targetDay = date;
    const pickBest = (flights: Record<string, unknown>[]) => {
      const pickFrom = (candidates: Record<string, unknown>[]) => {
        if (!candidates.length) return null;
        const live = candidates.find((x) => x?.flight_ended === false || x?.flightEnded === false);
        if (live) return live;
        const score = (x: Record<string, unknown>) => {
          const iso = fr24PrimaryDepUtcIsoForSort(x, targetDay);
          const ms = iso ? new Date(iso).getTime() : 0;
          return Number.isNaN(ms) ? 0 : ms;
        };
        return [...candidates].sort((a, b) => score(b) - score(a))[0] ?? null;
      };
      const getOriginLocalDepDate = (x: Record<string, unknown>) => {
        const origin = String(x.orig_icao ?? x.origin_icao ?? x.orig_iata ?? x.origin_iata ?? '').toUpperCase();
        const depScheduled = x.scheduled_departure_utc ?? x.scheduled_departure;
        const firstSeen = x.first_seen ?? x.firstSeen;
        const takeoff = x.datetime_takeoff ?? x.datetimeTakeoff;
        const depIso =
          (depScheduled && String(depScheduled).trim()
            ? fr24ScheduledFieldToUtcIso(String(depScheduled), origin, targetDay)
            : undefined) ??
          toUtcIsoAssumeUtc(firstSeen as string) ??
          toUtcIsoAssumeUtc(takeoff as string);
        return utcIsoToLocalDateAtAirport(depIso, origin) ?? (depIso ? depIso.slice(0, 10) : '');
      };
      const exactMatches = flights.filter((x) => getOriginLocalDepDate(x) === targetDay);
      return pickFrom(exactMatches);
    };
    const f = pickBest(list);
    if (!f) return null;
    const origin = (f.orig_icao ?? f.origin_icao ?? '') as string;
    const destination = (f.dest_icao ?? f.destination_icao ?? f.destination_icao_actual ?? '') as string;
    if (!origin && !destination) return null;
    const depScheduled = (f.scheduled_departure_utc ?? f.scheduled_departure) as string | undefined;
    const arrScheduled = (f.scheduled_arrival_utc ?? f.scheduled_arrival) as string | undefined;
    let depIso = fr24ScheduledFieldToUtcIso(depScheduled, origin, targetDay);
    let arrIso = fr24ScheduledFieldToUtcIso(arrScheduled, destination, targetDay);
    if (fr24TurkeyPakistanScheduleTooShort(origin, destination, depIso, arrIso)) {
      console.warn(
        '[FR24 edge] Turkey↔Pakistan block too short — dropping FR24 schedule',
        origin,
        destination,
        depIso,
        arrIso,
      );
      depIso = undefined;
      arrIso = undefined;
    }
    const first_seen_utc = toUtcIsoAssumeUtc((f.first_seen ?? f.firstSeen) as string | undefined);
    const datetime_takeoff_utc = toUtcIsoAssumeUtc((f.datetime_takeoff ?? f.datetimeTakeoff) as string | undefined);
    const datetime_landed_utc = toUtcIsoAssumeUtc((f.datetime_landed ?? f.datetimeLanded) as string | undefined);
    const last_seen_utc = toUtcIsoAssumeUtc((f.last_seen ?? f.lastSeen) as string | undefined);
    const flightEnded = (f.flight_ended ?? f.flightEnded) as boolean | undefined;
    const base: FlightInfoJson = {
      origin,
      destination,
      depTime: depIso ? parseTime(depIso) : '',
      arrTime: arrIso ? parseTime(arrIso) : '',
      scheduled_departure_utc: depIso,
      scheduled_arrival_utc: arrIso,
      aircraftRegistration: f.reg as string | undefined,
      fr24Id: (f.fr24_id ?? f.fr24Id ?? f.id) as string | undefined,
      hex: (f.hex ?? f.icao24) as string | undefined,
      operatedAs: (f.operating_as ?? f.operated_as ?? f.painted_as) as string | undefined,
      callsign: (f.callsign ?? f.callSign) as string | undefined,
      flightEnded,
      delayed: false,
      first_seen_utc: first_seen_utc ?? undefined,
      datetime_takeoff_utc: datetime_takeoff_utc ?? undefined,
      datetime_landed_utc: datetime_landed_utc ?? undefined,
      last_seen_utc: last_seen_utc ?? undefined,
    };
    if (flightEnded === false && (first_seen_utc || datetime_takeoff_utc || datetime_landed_utc)) {
      base.flightStatus = deriveFr24LiveStatus(Date.now(), first_seen_utc, datetime_takeoff_utc, datetime_landed_utc);
    }
    const depForLegDate = depIso ?? first_seen_utc ?? datetime_takeoff_utc;
    const legOriginDate =
      utcIsoToLocalDateAtAirport(depForLegDate, origin) ?? (depForLegDate ? depForLegDate.slice(0, 10) : '');
    if (legOriginDate && legOriginDate < targetDay && (base.flightStatus === 'landed' || base.flightStatus === 'parked')) {
      return null;
    }
    return base;
  } catch {
    return null;
  }
}

function normalizeDestinationForFlight(flightNumber: string, info: FlightInfoJson | null): FlightInfoJson | null {
  if (!info) return null;
  const r = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  if (r !== 'PC2264') return info;
  return { ...info, destination: 'BJV', destinationCity: 'Bodrum' };
}

function isFlightInfoMatchingSelectedDateEdge(info: FlightInfoJson | null | undefined, selectedDate: string): boolean {
  if (!info || !selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return false;
  const origin = String(info.origin ?? '').trim().toUpperCase();
  const depAnchor = String(
    info.scheduled_departure_utc ??
      info.actual_departure_utc ??
      info.scheduled_arrival_utc ??
      info.actual_arrival_utc ??
      '',
  ).trim();
  if (!depAnchor) return false;
  const localDate = utcIsoToLocalDateAtAirport(depAnchor, origin) ?? depAnchor.slice(0, 10);
  return localDate === selectedDate;
}

export async function fetchFlightByNumberEdge(
  flightNumber: string,
  date: string,
  localToday: string,
  localTomorrow: string,
  ctx: FlightByNumberCtx,
): Promise<FlightInfoJson | null> {
  const raw = flightNumber.replace(/\s/g, '').trim();
  if (!raw || date.length !== 10) return null;

  const isLocalTodayOrTomorrow = date === localToday || date === localTomorrow;

  if (isLocalTodayOrTomorrow) {
    const alNearest = await fetchFromTimetablePrimaryEdge(ctx, raw, date);
    if (
      alNearest &&
      isFlightInfoMatchingSelectedDateEdge(alNearest, date) &&
      (alNearest.scheduled_departure_utc ||
        alNearest.scheduled_arrival_utc ||
        (alNearest.origin && alNearest.destination))
    ) {
      const { flightStatus: _fs, actual_departure_utc: _ad, actual_arrival_utc: _aa, ...restNearest } = alNearest as FlightInfoJson & {
        flightStatus?: unknown;
        actual_departure_utc?: unknown;
        actual_arrival_utc?: unknown;
      };
      return normalizeDestinationForFlight(raw, restNearest as FlightInfoJson);
    }
  }

  const fr = await fetchFromFlightradar24Edge(ctx, raw, date);

  async function fillScheduledFromAirLabs(info: FlightInfoJson): Promise<FlightInfoJson> {
    if (info.scheduled_departure_utc && info.scheduled_arrival_utc) return info;
    const al = await fetchFromTimetablePrimaryEdge(ctx, raw, date);
    if (!isFlightInfoMatchingSelectedDateEdge(al, date)) return info;
    if (!al?.scheduled_departure_utc && !al?.scheduled_arrival_utc) return info;
    return {
      ...info,
      scheduled_departure_utc: info.scheduled_departure_utc ?? al.scheduled_departure_utc,
      scheduled_arrival_utc: info.scheduled_arrival_utc ?? al.scheduled_arrival_utc,
      depTime: (info.depTime as string) ||
        (al.scheduled_departure_utc ? parseTime(String(al.scheduled_departure_utc)) : ''),
      arrTime: (info.arrTime as string) ||
        (al.scheduled_arrival_utc ? parseTime(String(al.scheduled_arrival_utc)) : ''),
      flightStatus: info.flightStatus ?? al.flightStatus,
      delayDepMin: info.delayDepMin ?? al.delayDepMin,
      delayArrMin: info.delayArrMin ?? al.delayArrMin,
      delayed: info.delayed ?? al.delayed,
      airlabsProgressPercent: info.airlabsProgressPercent ?? al.airlabsProgressPercent,
    };
  }

  if (fr && (fr.origin || fr.destination)) {
    if (fr.flightEnded === true) {
      const alResult = await fetchFromTimetablePrimaryEdge(ctx, raw, date);
      if (alResult && (alResult.origin || alResult.destination || alResult.scheduled_departure_utc || alResult.scheduled_arrival_utc)) {
        return normalizeDestinationForFlight(raw, alResult);
      }
      let out: FlightInfoJson = { ...fr };
      const isFutureSelectedDate = typeof date === 'string' && date > localToday;
      if (isFutureSelectedDate) {
        out = { ...fr, flightStatus: 'scheduled' };
        out = await fillScheduledFromAirLabs(out);
        return normalizeDestinationForFlight(raw, out);
      }
      const landedIso = (fr.datetime_landed_utc ?? fr.fr24_datetime_landed_utc) as string | undefined;
      const landedMs = landedIso ? new Date(landedIso).getTime() : 0;
      const nowMs = Date.now();
      if (Number.isFinite(landedMs) && landedMs > 0 && nowMs >= landedMs) {
        out = { ...fr, flightStatus: 'landed' };
      } else {
        out = { ...fr, flightStatus: 'scheduled' };
      }
      out = await fillScheduledFromAirLabs(out);
      return normalizeDestinationForFlight(raw, out);
    }
    if (fr.flightEnded === false) {
      let out: FlightInfoJson = { ...fr };
      out = await fillScheduledFromAirLabs(out);
      return normalizeDestinationForFlight(raw, out);
    }
  }

  const airlabsOnly = await fetchFromTimetablePrimaryEdge(ctx, raw, date);
  if (
    airlabsOnly &&
    isFlightInfoMatchingSelectedDateEdge(airlabsOnly, date) &&
    (airlabsOnly.origin || airlabsOnly.destination || airlabsOnly.scheduled_departure_utc || airlabsOnly.scheduled_arrival_utc)
  ) {
    return normalizeDestinationForFlight(raw, airlabsOnly);
  }

  return null;
}
