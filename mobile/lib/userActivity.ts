/**
 * Lightweight product-activity logging for admin engagement (app opens, imports, pushes).
 * Failures are silent — never block UX.
 */
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from './supabase';

export type ActivityEventType = 'app_open' | 'roster_import' | 'family_push';

const APP_OPEN_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

function appMeta(): Record<string, unknown> {
  const version =
    Constants.nativeApplicationVersion?.trim() ||
    Constants.expoConfig?.version?.trim() ||
    null;
  const build =
    Constants.nativeBuildVersion?.trim() ||
    (Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber?.toString().trim()
      : Constants.expoConfig?.android?.versionCode != null
        ? String(Constants.expoConfig.android.versionCode)
        : null) ||
    null;
  return {
    platform: Platform.OS,
    app_version: version,
    app_build: build,
  };
}

export async function trackActivityEvent(
  userId: string,
  eventType: ActivityEventType,
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (!userId) return;
  try {
    const { error } = await supabase.from('user_activity_events').insert({
      user_id: userId,
      event_type: eventType,
      meta: { ...appMeta(), ...meta },
    });
    if (error) {
      console.warn('[userActivity]', eventType, error.message);
    }
  } catch (e) {
    console.warn('[userActivity]', eventType, e);
  }
}

/** Throttled app_open — call on sign-in and when app returns to foreground. */
export async function trackAppOpenThrottled(userId: string): Promise<void> {
  if (!userId) return;
  const key = `flyfam_activity_app_open:${userId}`;
  try {
    const prev = await AsyncStorage.getItem(key);
    const prevMs = prev ? Number(prev) : 0;
    const now = Date.now();
    if (Number.isFinite(prevMs) && now - prevMs < APP_OPEN_THROTTLE_MS) return;
    await AsyncStorage.setItem(key, String(now));
    await trackActivityEvent(userId, 'app_open', {
      app_state: AppState.currentState,
    });
  } catch {
    // ignore
  }
}
