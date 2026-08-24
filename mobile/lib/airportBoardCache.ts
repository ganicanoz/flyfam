/**
 * AeroDataBox hub tahtaları — AsyncStorage; sunucu `hub_airport_board_cache` (Edge sync-hub-airport-boards)
 * taze ise önce oradan hydrate edilir, ADB çağrısı atlanır. Gün/slot: Europe/Istanbul (Edge ile aynı).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  AERODATABOX_RAPIDAPI_BASE,
  fetchAerodataboxBoardMulti,
} from './aerodataboxHttp';
import { flightInfoFromAeroDataBoxRoot, type FlightInfo } from './flightApi';
import { utcIsoToLocalDateAtAirport } from './airportUtcOffset';
import {
  istanbulCalendarDate,
  istanbulSlotKey,
  nextCalendarDayYmd,
} from './hubBoardIstanbul';
import { supabase } from './supabase';

const STORAGE_KEY = 'flyfam_airport_board_cache_v2';
const REQUEST_GAP_MS = 2400;
/** Dep+Arr tahtaları en az bu kadar sürede bir yeniden yazılır (wall-clock). */
const MIN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';
const AERODATABOX_RAPIDAPI_KEY =
  (
    Constants.expoConfig?.extra?.aerodataboxRapidApiKey ??
    process.env.EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY ??
    process.env.EXPO_PUBLIC_RAPIDAPI_KEY ??
    ''
  ).trim() || AERODATABOX_RAPIDAPI_FALLBACK;
const BASE = AERODATABOX_RAPIDAPI_BASE;
const COMMON =
  'withLeg=true&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false';

/**
 * Türkiye / bölge hub’ları — her biri için bugün+yarın, Arr+Dep, 12+12 saatlik ADB pencereleri.
 * (Tek istek ≤12 saat; bacak verisi withLeg ile uçuş kartı için yeterli.)
 */
export const AIRPORT_BOARD_CACHE_HUBS_IATA = ['SAW', 'IST', 'AYT', 'ESB', 'ADB', 'ECN'] as const;

type CachePayload = {
  version: 1 | 2;
  lastSlotKey: string;
  lastFetchedAt: string;
  /** Europe/Istanbul takvim günü (önbellek ana günü). */
  anchorDay: string;
  /** Önbelleğe alınan uçuş satırları (AeroDataBox tahta öğesi şekli). */
  rows: Record<string, unknown>[];
};

export function normalizeBoardFlightNumber(s: unknown): string {
  return String(s ?? '')
    .replace(/\s/g, '')
    .toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rowCacheKey(row: Record<string, unknown>): string {
  const n = normalizeBoardFlightNumber(row.number);
  const dep = row.departure as Record<string, unknown> | undefined;
  const arr = row.arrival as Record<string, unknown> | undefined;
  const ds =
    typeof dep?.scheduledTimeUtc === 'string'
      ? dep.scheduledTimeUtc
      : typeof dep?.scheduledTime === 'string'
      ? dep.scheduledTime
      : '';
  const ar =
    typeof arr?.scheduledTimeUtc === 'string'
      ? arr.scheduledTimeUtc
      : typeof arr?.scheduledTime === 'string'
      ? arr.scheduledTime
      : '';
  return `${n}|${ds.slice(0, 19)}|${ar.slice(0, 19)}`;
}

function rowMatchesFlightDate(info: FlightInfo, flightDate: string): boolean {
  const depUtc = info.scheduled_departure_utc;
  const arrUtc = info.scheduled_arrival_utc;
  if (depUtc?.slice(0, 10) === flightDate || arrUtc?.slice(0, 10) === flightDate) return true;
  const depLocal = info.origin ? utcIsoToLocalDateAtAirport(depUtc, info.origin) : undefined;
  const arrLocal = info.destination ? utcIsoToLocalDateAtAirport(arrUtc, info.destination) : undefined;
  if (depLocal === flightDate || arrLocal === flightDate) return true;
  return false;
}

async function fetchBoard(url: string): Promise<Record<string, unknown>[]> {
  const { rows } = await fetchAerodataboxBoardMulti(url);
  return rows;
}

function buildJobsForDay(hub: string, day: string): { url: string }[] {
  const next = nextCalendarDayYmd(day);
  return [
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T00:00/${day}T12:00?direction=Arrival&${COMMON}`,
    },
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T12:00/${next}T00:00?direction=Arrival&${COMMON}`,
    },
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T00:00/${day}T12:00?direction=Departure&${COMMON}`,
    },
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T12:00/${next}T00:00?direction=Departure&${COMMON}`,
    },
  ];
}

let refreshInFlight: Promise<void> | null = null;

async function tryHydrateBoardCacheFromSupabase(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('hub_airport_board_cache')
      .select('version, anchor_day, slot_key, rows, fetched_at')
      .eq('id', 'singleton')
      .maybeSingle();
    if (error || !data) return false;
    const version = Number(data.version);
    const anchor_day =
      typeof data.anchor_day === 'string'
        ? data.anchor_day
        : String(data.anchor_day ?? '').slice(0, 10);
    const slot_key = String(data.slot_key ?? '');
    const rows = data.rows;
    const fetched_at = String(data.fetched_at ?? '');
    const today = istanbulCalendarDate();
    const slotWant = istanbulSlotKey();
    const fetchedMs = fetched_at ? new Date(fetched_at).getTime() : NaN;
    const olderThan12h =
      !Number.isFinite(fetchedMs) || Date.now() - fetchedMs >= MIN_REFRESH_INTERVAL_MS;
    if (
      version !== 2 ||
      slot_key !== slotWant ||
      anchor_day !== today ||
      !Array.isArray(rows) ||
      rows.length === 0 ||
      olderThan12h
    ) {
      return false;
    }
    const payload: CachePayload = {
      version: 2,
      lastSlotKey: slot_key,
      lastFetchedAt: fetched_at,
      anchorDay: anchor_day,
      rows: rows as Record<string, unknown>[],
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

async function runRefresh(): Promise<void> {
  if (!AERODATABOX_RAPIDAPI_KEY) return;
  const today = istanbulCalendarDate();
  const tomorrow = nextCalendarDayYmd(today);
  const slotKey = istanbulSlotKey();
  const jobs: string[] = [];
  for (const hub of AIRPORT_BOARD_CACHE_HUBS_IATA) {
    for (const day of [today, tomorrow]) {
      for (const j of buildJobsForDay(hub, day)) {
        jobs.push(j.url);
      }
    }
  }
  const merged = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < jobs.length; i++) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    const list = await fetchBoard(jobs[i]!);
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const key = rowCacheKey(row as Record<string, unknown>);
      merged.set(key, row as Record<string, unknown>);
    }
  }
  const payload: CachePayload = {
    version: 2,
    lastSlotKey: slotKey,
    lastFetchedAt: new Date().toISOString(),
    anchorDay: today,
    rows: [...merged.values()],
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Hub Dep+Arr tahtalarını (İstanbul bugün+yarın, 12+12 saat pencereler) AsyncStorage’a yazar.
 * Yenileme: İstanbul gün/slot değişimi veya son yazımdan ≥12 saat; önce DB’den hydrate dene.
 */
export async function refreshAirportBoardCacheIfDue(): Promise<void> {
  const today = istanbulCalendarDate();
  const slotKey = istanbulSlotKey();
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  let needs = true;
  if (raw) {
    try {
      const prev = JSON.parse(raw) as Partial<CachePayload>;
      const fetchedMs = prev.lastFetchedAt ? new Date(prev.lastFetchedAt).getTime() : NaN;
      const olderThan12h =
        !Number.isFinite(fetchedMs) || Date.now() - fetchedMs >= MIN_REFRESH_INTERVAL_MS;
      if (
        prev.version === 2 &&
        prev.lastSlotKey === slotKey &&
        prev.anchorDay === today &&
        Array.isArray(prev.rows) &&
        prev.rows.length > 0 &&
        !olderThan12h
      ) {
        needs = false;
      }
    } catch {
      needs = true;
    }
  }
  if (!needs) return;
  if (await tryHydrateBoardCacheFromSupabase()) return;
  if (!AERODATABOX_RAPIDAPI_KEY) return;
  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }
  refreshInFlight = runRefresh()
    .catch(() => {})
    .finally(() => {
      refreshInFlight = null;
    });
  await refreshInFlight;
}

export function triggerAirportBoardCacheRefreshIfDue(): void {
  void refreshAirportBoardCacheIfDue();
}

/**
 * Önbellekte uçuş numarası + tarih eşleşmesi (UTC veya meydan yerel günü).
 */
export async function findAirportBoardCacheFlight(
  flightNumber: string,
  flightDate: string
): Promise<FlightInfo | null> {
  if (!flightDate || flightDate.length !== 10) return null;
  const want = normalizeBoardFlightNumber(flightNumber);
  if (!want) return null;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    await tryHydrateBoardCacheFromSupabase();
    try {
      raw = await AsyncStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  let payload: CachePayload;
  try {
    payload = JSON.parse(raw) as CachePayload;
  } catch {
    return null;
  }
  if ((payload.version !== 2 && payload.version !== 1) || !Array.isArray(payload.rows)) return null;
  for (const row of payload.rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (normalizeBoardFlightNumber(r.number) !== want) continue;
    const info = flightInfoFromAeroDataBoxRoot(r);
    if (!info) continue;
    if (!rowMatchesFlightDate(info, flightDate)) continue;
    return { ...info };
  }
  return null;
}
