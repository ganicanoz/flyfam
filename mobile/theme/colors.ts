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

/** Açık tema — repodaki orijinal paletle aynı (cf5dbfb); koyu moda yalnızca `darkColors`. */
const lightColors: ThemeColors = {
  /** Saf beyaz — floating tab altında gri “şerit” görünmesin. */
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F6FF',
  primary: '#5AA6FF',
  primaryLight: '#EEF6FF',
  // Eski dosyada yoktu; tip için gerekli, rozet/ikon vurgusu accent ile aynı lacivert.
  secondary: '#1D4FA3',
  accent: '#1D4FA3',
  text: '#0B1220',
  textSecondary: '#22324C',
  textMuted: '#6B7A90',
  border: '#E1EAF5',
  success: '#2E7D32',
  error: '#C62828',
  white: '#FFFFFF',
  onPrimary: '#FFFFFF',
};

/**
 * Koyu tema — opak zemin, yüksek kontrast metin, link/CTA için parlak primary.
 * (Eski yarı saydam background + soluk #356899 primary okunaksızdı.)
 */
const darkColors: ThemeColors = {
  background: '#0B0D11',
  surface: '#151A22',
  surfaceAlt: '#1C2330',
  primary: '#6BB3FF',
  primaryLight: '#1A2740',
  secondary: '#9EC5FF',
  accent: '#9EC5FF',
  text: '#F2F6FC',
  textSecondary: '#C8D4E6',
  textMuted: '#9AA8BC',
  border: '#2E3748',
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
