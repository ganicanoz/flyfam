/**
 * Last successful roster flight list for offline cold start.
 * Keyed by viewer userId + roster subject (own crew / followed crew).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'flyfam.rosterLocalCache.v1:';
const INDEX_KEY = 'flyfam.rosterLocalCache.v1.index';

/** Keep roughly three months of roster rows. */
const MAX_AGE_DAYS = 90;
const MAX_ROWS = 400;

export type RosterLocalCachePayload = {
  userId: string;
  subjectKey: string;
  savedAt: number;
  flights: unknown[];
};

function storageKey(userId: string, subjectKey: string): string {
  return `${PREFIX}${userId}:${subjectKey}`;
}

function dayMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function flightDateYmd(f: unknown): string | null {
  if (!f || typeof f !== 'object') return null;
  const d = (f as { flight_date?: unknown }).flight_date;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

function trimFlights(flights: unknown[]): unknown[] {
  const cutoff = new Date(Date.now() - dayMs(MAX_AGE_DAYS)).toISOString().slice(0, 10);
  const filtered = flights.filter((f) => {
    const ymd = flightDateYmd(f);
    if (!ymd) return true;
    return ymd >= cutoff;
  });
  if (filtered.length <= MAX_ROWS) return filtered;
  return filtered
    .slice()
    .sort((a, b) => (flightDateYmd(a) || '').localeCompare(flightDateYmd(b) || ''))
    .slice(-MAX_ROWS);
}

async function rememberKey(userId: string, subjectKey: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const list = Array.isArray(map[userId]) ? map[userId]! : [];
    if (!list.includes(subjectKey)) {
      map[userId] = [...list, subjectKey];
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(map));
    }
  } catch {
    /* ignore */
  }
}

export async function saveRosterLocalCache(params: {
  userId: string;
  subjectKey: string;
  flights: unknown[];
}): Promise<void> {
  const payload: RosterLocalCachePayload = {
    userId: params.userId,
    subjectKey: params.subjectKey,
    savedAt: Date.now(),
    flights: trimFlights(params.flights),
  };
  try {
    await AsyncStorage.setItem(storageKey(params.userId, params.subjectKey), JSON.stringify(payload));
    await rememberKey(params.userId, params.subjectKey);
  } catch {
    /* ignore */
  }
}

export async function loadRosterLocalCache(
  userId: string,
  subjectKey: string,
): Promise<RosterLocalCachePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, subjectKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RosterLocalCachePayload;
    if (!parsed || parsed.userId !== userId || !Array.isArray(parsed.flights)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearRosterLocalCacheForUser(userId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const list = Array.isArray(map[userId]) ? map[userId]! : [];
    const keys = list.map((s) => storageKey(userId, s));
    if (keys.length) await AsyncStorage.multiRemove(keys);
    delete map[userId];
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
