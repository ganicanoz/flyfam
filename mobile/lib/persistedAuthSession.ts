/**
 * Read the last Supabase auth session from AsyncStorage without calling getSession().
 *
 * Why: when the access token is expired (or inside the refresh margin), getSession()
 * tries to refresh. Offline that fails and returns { session: null }, even though
 * the refresh_token is still on disk — which bounces the UI to SignIn and hides
 * cached roster/profile. Airplane mode / cabin Wi‑Fi is the common case.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { parsePersistedAuthSessionRaw } from './persistedAuthSessionParse';
import { SUPABASE_URL } from './supabase';

export { parsePersistedAuthSessionRaw } from './persistedAuthSessionParse';

/** Mirrors supabase-js default: `sb-<projectRef>-auth-token`. */
export function getSupabaseAuthStorageKey(): string {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    if (ref) return `sb-${ref}-auth-token`;
  } catch {
    /* fall through */
  }
  return 'supabase.auth.token';
}

export async function readPersistedAuthSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(getSupabaseAuthStorageKey());
    return parsePersistedAuthSessionRaw(raw);
  } catch {
    return null;
  }
}
