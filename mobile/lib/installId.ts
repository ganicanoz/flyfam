import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORE_KEY = 'flyfam.install_id.v1';

function randomInstallId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stable per-install id for single-device session binding.
 * SecureStore on native; AsyncStorage fallback is intentionally avoided.
 */
export async function getOrCreateInstallId(): Promise<string> {
  if (Platform.OS === 'web') {
    return `web-${randomInstallId()}`;
  }
  try {
    const existing = await SecureStore.getItemAsync(STORE_KEY);
    if (existing && existing.trim().length >= 8) return existing.trim();
    const created = randomInstallId();
    await SecureStore.setItemAsync(STORE_KEY, created);
    return created;
  } catch {
    return randomInstallId();
  }
}
