import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@flyfam_aircraft_reg_override_v1';

export type AircraftRegOverrideMap = Record<string, string>;

function normalizeReg(raw: string): string | null {
  const reg = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (reg.length < 3 || reg.length > 12) return null;
  if (!/^[A-Z0-9-]+$/.test(reg)) return null;
  return reg;
}

export function normalizeAircraftRegistrationInput(raw: string): string | null {
  return normalizeReg(raw);
}

export async function loadAircraftRegOverrides(): Promise<AircraftRegOverrideMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: AircraftRegOverrideMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = String(k || '').trim();
      const reg = typeof v === 'string' ? normalizeReg(v) : null;
      if (id && reg) out[id] = reg;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveAircraftRegOverride(flightId: string, registration: string): Promise<string | null> {
  const id = String(flightId || '').trim();
  const reg = normalizeReg(registration);
  if (!id || !reg) return null;
  const map = await loadAircraftRegOverrides();
  map[id] = reg;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  return reg;
}

/** Drop override when API/system reg takes over (or aircraft assignment changed). */
export async function clearAircraftRegOverride(flightId: string): Promise<void> {
  const id = String(flightId || '').trim();
  if (!id) return;
  const map = await loadAircraftRegOverrides();
  if (!(id in map)) return;
  delete map[id];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Prefer crew override for Where-is-my-plane / FR24.
 * System/API reg is the fallback when the crew has not set a manual value.
 */
export function pickAircraftRegistration(opts: {
  systemReg?: string | null;
  overrideReg?: string | null;
}): string | null {
  const override = normalizeReg(String(opts.overrideReg ?? ''));
  if (override) return override;
  return normalizeReg(String(opts.systemReg ?? ''));
}

/** Crew can always open the reg modal while Where-is-my-plane is shown. */
export function canEditAircraftRegOverride(_opts?: {
  systemReg?: string | null;
  overrideReg?: string | null;
}): boolean {
  return true;
}

/**
 * Drop manual override only when the assigned aircraft itself changes
 * (system reg A→B) or clears after a swap (A→empty). First API arrival
 * must not wipe a crew correction.
 */
export function shouldClearAircraftRegOverride(opts: {
  previousSystemReg?: string | null;
  systemReg?: string | null;
  overrideReg?: string | null;
}): boolean {
  const prev = normalizeReg(String(opts.previousSystemReg ?? ''));
  const system = normalizeReg(String(opts.systemReg ?? ''));
  const override = normalizeReg(String(opts.overrideReg ?? ''));
  if (!override) return false;
  if (prev && system && prev !== system) return true;
  if (prev && !system) return true;
  return false;
}
