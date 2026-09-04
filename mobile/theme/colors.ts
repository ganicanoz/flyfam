import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { useSyncExternalStore } from 'react';

/** Uygulamanın gerçekte kullandığı palet (her zaman `lightColors` veya `darkColors`). */
export type ThemeMode = 'light' | 'dark';
/** Kullanıcı / depolama: `system` = cihazın açık-koyu ayarına uy. */
export type ThemePreference = 'system' | ThemeMode;

type ThemeColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  primaryLight: string;
  secondary: string;
  accent: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  success: string;
  error: string;
  white: string;
  /** Primary buton / header üzerindeki yazı-ikon rengi. */
  onPrimary: string;
};

const STORAGE_KEY = 'flyfam_theme_mode';

/** Açık tema — design tokens (Figma / tokens.ts). */
const lightColors: ThemeColors = {
  background: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#E8F0FE',
  primary: '#1A5CF5',
  primaryLight: '#E8F0FE',
  secondary: '#0F1B3D',
  accent: '#1A5CF5',
  text: '#0F1B3D',
  textSecondary: '#4B5563',
  textMuted: '#6B7280',
  border: '#E5E9F0',
  success: '#1B7F3B',
  error: '#B42318',
  white: '#FFFFFF',
  onPrimary: '#FFFFFF',
};

/**
 * Koyu tema — design tokens.
 */
const darkColors: ThemeColors = {
  background: '#0B1220',
  surface: '#141C2E',
  surfaceAlt: '#1A2740',
  primary: '#4D7FFF',
  primaryLight: '#1A2740',
  secondary: '#F3F6FB',
  accent: '#4D7FFF',
  text: '#F3F6FB',
  textSecondary: '#C5D0E0',
  textMuted: '#9AA8BC',
  border: '#243049',
  success: '#7BC47F',
  error: '#F07171',
  white: '#FFFFFF',
  onPrimary: '#0B1220',
};

let themePreference: ThemePreference = 'system';
let currentMode: ThemeMode = 'light';
let currentColors: ThemeColors = lightColors;
const listeners = new Set<() => void>();

let appearanceSub: { remove: () => void } | null = null;

function emitThemeChange() {
  listeners.forEach((listener) => listener());
}

function resolveMode(pref: ThemePreference): ThemeMode {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  const scheme = Appearance.getColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}

function applyResolved(mode: ThemeMode) {
  currentMode = mode;
  currentColors = mode === 'dark' ? darkColors : lightColors;
  emitThemeChange();
}

function syncFromPreference() {
  applyResolved(resolveMode(themePreference));
}

function detachAppearanceListener() {
  appearanceSub?.remove?.();
  appearanceSub = null;
}

function attachAppearanceListenerIfNeeded() {
  if (themePreference !== 'system') {
    detachAppearanceListener();
    return;
  }
  if (appearanceSub) return;
  appearanceSub = Appearance.addChangeListener(() => {
    if (themePreference === 'system') {
      syncFromPreference();
    }
  });
}

export async function loadStoredThemeMode(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      themePreference = stored;
    } else if (stored === 'system') {
      themePreference = 'system';
    } else {
      themePreference = 'system';
    }
  } catch {
    themePreference = 'system';
  }
  attachAppearanceListenerIfNeeded();
  syncFromPreference();
}

export function getThemePreference(): ThemePreference {
  return themePreference;
}

/** Cihaz ayarına göre otomatik veya sabit açık/koyu. */
export async function setThemePreference(pref: ThemePreference): Promise<void> {
  themePreference = pref;
  attachAppearanceListenerIfNeeded();
  syncFromPreference();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Ignore theme storage errors; in-memory preference still applies.
  }
}

/** Sabit açık veya koyu (sistem takibini kapatır). */
export async function setThemeMode(mode: ThemeMode): Promise<void> {
  return setThemePreference(mode);
}

const PREF_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

export async function cycleThemePreference(): Promise<void> {
  const i = PREF_CYCLE.indexOf(themePreference);
  const next = PREF_CYCLE[i === -1 ? 0 : (i + 1) % PREF_CYCLE.length];
  await setThemePreference(next);
}

/** Açık ↔ koyu zorunlu mod; `system` iken mevcut görünümün tersine geçer. */
export function toggleThemeMode(): Promise<void> {
  const next: ThemeMode = currentMode === 'light' ? 'dark' : 'light';
  return setThemePreference(next);
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentMode,
    () => currentMode,
  );
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => themePreference,
    () => themePreference,
  );
}

export const colors: ThemeColors = new Proxy({} as ThemeColors, {
  get: (_target, prop: keyof ThemeColors) => currentColors[prop],
});
