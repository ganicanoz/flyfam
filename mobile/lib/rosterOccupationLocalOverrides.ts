/**
 * Device-local occupation label overrides (user suggestions before admin Deploy).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'flyfam:roster_occupation_local_overrides_v1';

export type LocalOccupationOverride = {
  code: string;
  label_tr: string;
  label_en?: string | null;
  category?: string | null;
  airline_icao?: string | null;
  updatedAt: number;
};

let memory = new Map<string, LocalOccupationOverride>();
let hydrated = false;
const listeners = new Set<() => void>();

function normCode(code: string | null | undefined): string {
  return String(code || '')
    .replace(/\s/g, '')
    .toUpperCase();
}

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeLocalOccupationOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function hydrateLocalOccupationOverrides(): Promise<void> {
  if (hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalOccupationOverride[];
      memory = new Map();
      for (const row of Array.isArray(parsed) ? parsed : []) {
        const c = normCode(row.code);
        if (!c || !row.label_tr?.trim()) continue;
        memory.set(c, { ...row, code: c });
      }
    }
  } catch {
    /* ignore */
  }
  hydrated = true;
}

async function persist(): Promise<void> {
  const rows = [...memory.values()];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function lookupLocalOccupationOverride(
  code: string | null | undefined,
): LocalOccupationOverride | null {
  const c = normCode(code);
  if (!c) return null;
  return memory.get(c) ?? null;
}

export function lookupLocalOccupationLabel(
  code: string | null | undefined,
  lang: 'tr' | 'en',
): string | null {
  const row = lookupLocalOccupationOverride(code);
  if (!row) return null;
  if (lang === 'en') return (row.label_en || row.label_tr || '').trim() || null;
  return row.label_tr.trim() || null;
}

export async function setLocalOccupationOverride(
  input: Omit<LocalOccupationOverride, 'updatedAt'> & { updatedAt?: number },
): Promise<LocalOccupationOverride> {
  const code = normCode(input.code);
  const label_tr = String(input.label_tr || '').trim();
  if (!code || !label_tr) throw new Error('code and label_tr required');
  const row: LocalOccupationOverride = {
    code,
    label_tr,
    label_en: input.label_en?.trim() || label_tr,
    category: input.category ?? 'other',
    airline_icao: input.airline_icao?.trim().toUpperCase() || null,
    updatedAt: input.updatedAt ?? Date.now(),
  };
  memory.set(code, row);
  await persist();
  notify();
  return row;
}
