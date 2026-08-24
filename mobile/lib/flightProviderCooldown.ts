import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@flyfam/pcd/';

export const FLIGHT_PROVIDER_FR24 = 'fr24';
export const FLIGHT_PROVIDER_AIRLABS = 'airlabs';
export const FLIGHT_PROVIDER_AERODATABOX = 'aerodatabox';
export const FLIGHT_PROVIDER_AERODATABOX_ALT = 'aerodatabox_alt';
export const FLIGHT_PROVIDER_AEROAPI = 'aeroapi';
export const FLIGHT_PROVIDER_AVIATIONSTACK = 'aviationstack';

function storageKey(provider: string): string {
  return `${PREFIX}${provider}`;
}

function parseRetryAfterSecondsFromString(ra: string | null): number | null {
  if (!ra?.trim()) return null;
  const n = Number(ra.trim());
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), 900);
  const t = Date.parse(ra);
  if (!Number.isNaN(t)) {
    const sec = Math.ceil((t - Date.now()) / 1000);
    return sec > 0 ? Math.min(sec, 900) : null;
  }
  return null;
}

/** Seconds to wait after 429; clamp 15s–15m; default 45s if no Retry-After. */
export function cooldownSecondsFor429(retryAfterSeconds: number | null): number {
  const s = retryAfterSeconds != null ? retryAfterSeconds : 45;
  return Math.min(900, Math.max(15, Math.floor(s)));
}

export async function isFlightProviderInCooldown(provider: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(provider));
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

async function setFlightProviderCooldownUntilMs(provider: string, untilMs: number): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(provider), String(untilMs));
  } catch {
    /* ignore */
  }
}

/** Call when response status is 429 (reads Retry-After). */
export async function applyFlightProviderCooldownFromResponse(
  provider: string,
  res: Response,
): Promise<void> {
  const ra = res.headers.get('Retry-After') ?? res.headers.get('retry-after');
  const sec = cooldownSecondsFor429(parseRetryAfterSecondsFromString(ra));
  await setFlightProviderCooldownUntilMs(provider, Date.now() + sec * 1000);
}
