import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore, startTransition } from 'react';

export type FontSizePreset = 'small' | 'medium' | 'large';

const STORAGE_KEY = 'flyfam_font_size_preset';

/**
 * Liste gövde metni için sınırlı ölçekler.
 * Layout / rozet / takvim hücreleri ölçeklenmez — taşmayı önlemek için.
 */
const MULTIPLIERS: Record<FontSizePreset, number> = {
  small: 0.92,
  medium: 1,
  large: 1.06,
};

/** Snapshot visible to React subscribers (updated when we emit). */
let committedPreset: FontSizePreset = 'medium';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function commitPreset(p: FontSizePreset) {
  if (p === committedPreset) return;
  committedPreset = p;
  startTransition(() => {
    emit();
  });
}

/**
 * Persist + emit. UI can keep an optimistic preset; Roster/App subscribe via store.
 * No InteractionManager delay — that made toggles feel stuck.
 */
export async function setFontSizePreset(p: FontSizePreset): Promise<void> {
  if (p === committedPreset) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* ignore */
    }
    return;
  }
  commitPreset(p);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, p);
  } catch {
    /* ignore */
  }
}

export async function loadStoredFontSizePreset(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'small' || stored === 'medium' || stored === 'large') {
      if (stored === committedPreset) return;
      committedPreset = stored;
      emit();
    }
  } catch {
    // ignore
  }
}

export function getFontSizePreset(): FontSizePreset {
  return committedPreset;
}

export function useFontSizePreset(): FontSizePreset {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => committedPreset,
    () => committedPreset,
  );
}

export function getFontScaleMultiplier(): number {
  return MULTIPLIERS[committedPreset] ?? 1;
}

export function useFontScaleMultiplier(): number {
  const preset = useFontSizePreset();
  return MULTIPLIERS[preset] ?? 1;
}

/**
 * Liste gövde metni: hafif ölçek, üst sınır base+2pt (kutuya sığmayan parçalar şişmesin).
 * Rozet / chip / sabit UI için kullanma — orada düz `base` kullan.
 */
export function scaleListBodyText(base: number, scale: number): number {
  const safeBase = Number.isFinite(base) ? base : 14;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (safeScale === 1) return safeBase;
  const scaled = Math.round(safeBase * safeScale);
  if (safeScale < 1) return Math.max(scaled, safeBase - 1);
  return Math.min(scaled, safeBase + 2);
}
