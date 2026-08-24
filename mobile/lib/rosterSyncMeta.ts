/** Roster son senkron zamanı — floating tab altı meta satırı için. */
let lastSyncedAtMs: number | null = null;
const listeners = new Set<() => void>();

export function setRosterLastSyncedAt(ms: number = Date.now()) {
  lastSyncedAtMs = ms;
  listeners.forEach((l) => l());
}

export function getRosterLastSyncedAt(): number | null {
  return lastSyncedAtMs;
}

export function subscribeRosterLastSyncedAt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
