import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@flyfam_locale';

import en from '../locales/en.json';
import tr from '../locales/tr.json';

export const SUPPORTED_LOCALES = ['en', 'tr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  tr: 'Türkçe',
};

export async function getStoredLocale(): Promise<Locale | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'tr') return stored;
    return null;
  } catch {
    return null;
  }
}

export async function setStoredLocale(locale: Locale): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, locale);
  } catch {}
}

let initDone = false;

export function initI18nSync(): void {
  if (initDone) return;
  initDone = true;
  i18n.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    resources: { en: { translation: en }, tr: { translation: tr } },
    lng: 'tr',
    fallbackLng: 'tr',
    interpolation: { escapeValue: false },
  });
}

export async function applyStoredOrProfileLocale(profileLocale?: Locale | null): Promise<void> {
  const toApply = profileLocale ?? (await getStoredLocale());
  if (toApply && toApply !== i18n.language) {
    await i18n.changeLanguage(toApply);
    await setStoredLocale(toApply as Locale);
  }
}

export async function changeAppLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  await setStoredLocale(locale);
}

initI18nSync();

/** Uygulama açılışında kayıtlı dili uygula (varsayılan Türkçe, kullanıcı English seçtiyse onu yükle). */
export async function applyStoredLocaleOnStartup(): Promise<void> {
  const stored = await getStoredLocale();
  if (stored && stored !== i18n.language) {
    await i18n.changeLanguage(stored);
  }
}

export default i18n;
