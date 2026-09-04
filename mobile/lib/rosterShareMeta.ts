/**
 * Crew → aile roster paylaşım zamanı (Aile ekranı “Son paylaşım” satırı).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'flyfam.rosterLastSharedAt.v1';

let lastSharedAtMs: number | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export async function hydrateRosterLastSharedAt(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) lastSharedAtMs = n;
    }
  } catch {
    /* ignore */
  }
  notify();
}

export function setRosterLastSharedAt(ms: number = Date.now()) {
  lastSharedAtMs = ms;
  notify();
  void AsyncStorage.setItem(STORAGE_KEY, String(ms)).catch(() => {});
}

export function getRosterLastSharedAt(): number | null {
  return lastSharedAtMs;
}

export function subscribeRosterLastSharedAt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
