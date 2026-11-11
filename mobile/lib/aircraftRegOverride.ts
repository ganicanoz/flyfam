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

/** Prefer system/API reg; else keep crew-entered override until it changes. */
export function pickAircraftRegistration(opts: {
  systemReg?: string | null;
  overrideReg?: string | null;
}): string | null {
  const system = normalizeReg(String(opts.systemReg ?? ''));
  if (system) return system;
  const override = normalizeReg(String(opts.overrideReg ?? ''));
  return override;
}

/**
 * Manual override is editable until a system/API reg is present without an override.
 * Once API assigns a reg and clears override, crew cannot overwrite it from the modal.
 */
export function canEditAircraftRegOverride(opts: {
  systemReg?: string | null;
  overrideReg?: string | null;
}): boolean {
  const system = normalizeReg(String(opts.systemReg ?? ''));
  const override = normalizeReg(String(opts.overrideReg ?? ''));
  if (!system) return true;
  return !!override;
}

/**
 * When system/API reg appears or changes, drop a conflicting/stale manual override.
 * If system had a value and becomes empty (swap pending), also drop override so crew re-enters.
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
  if (system && system !== override) return true;
  if (prev && !system) return true;
  return false;
}
