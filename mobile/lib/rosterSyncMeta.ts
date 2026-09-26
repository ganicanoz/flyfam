import AsyncStorage from '@react-native-async-storage/async-storage';

/** Roster son senkron zamanı — ay başlığı yanındaki “Az önce güncellendi” için. */
const STORAGE_KEY = 'flyfam_roster_last_synced_at';

let lastSyncedAtMs: number | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setRosterLastSyncedAt(ms: number = Date.now()) {
  lastSyncedAtMs = ms;
  emit();
  void AsyncStorage.setItem(STORAGE_KEY, String(ms)).catch(() => {});
}

export function getRosterLastSyncedAt(): number | null {
  return lastSyncedAtMs;
}

export function subscribeRosterLastSyncedAt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cold start: restore last sync so label isn’t always “not synced yet”. */
export async function hydrateRosterLastSyncedAt(): Promise<number | null> {
  if (hydrated) return lastSyncedAtMs;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const n = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) {
      lastSyncedAtMs = n;
      emit();
    }
  } catch {
    /* ignore */
  }
  return lastSyncedAtMs;
}
