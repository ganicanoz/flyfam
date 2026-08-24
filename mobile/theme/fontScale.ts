import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type FontSizePreset = 'small' | 'medium' | 'large';

const STORAGE_KEY = 'flyfam_font_size_preset';

/** Uçuş listesi düzenini bozmamak için sınırlı ölçekler. */
const MULTIPLIERS: Record<FontSizePreset, number> = {
  small: 0.9,
  medium: 1,
  large: 1.1,
};

let currentPreset: FontSizePreset = 'medium';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function applyPreset(p: FontSizePreset) {
  currentPreset = p;
  emit();
}

export async function loadStoredFontSizePreset(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'small' || stored === 'medium' || stored === 'large') {
      applyPreset(stored);
    }
  } catch {
    // ignore
  }
}

export async function setFontSizePreset(p: FontSizePreset): Promise<void> {
  applyPreset(p);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, p);
  } catch {
    // in-memory still applies
  }
}

export function getFontSizePreset(): FontSizePreset {
  return currentPreset;
}

export function useFontSizePreset(): FontSizePreset {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => currentPreset,
    () => currentPreset,
  );
}

export function getFontScaleMultiplier(): number {
  return MULTIPLIERS[currentPreset];
}

export function useFontScaleMultiplier(): number {
  const preset = useFontSizePreset();
  return MULTIPLIERS[preset];
}
