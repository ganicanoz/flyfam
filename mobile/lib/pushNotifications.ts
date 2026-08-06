/**
 * Push notification registration for family users.
 * Registers the device with Expo Push and saves the token to Supabase (device_tokens).
 */
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

// Optional: show notification when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Newer expo-notifications expects these on iOS to show foreground banners/lists.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function getEasProjectIdWithSource(): { projectId?: string; source?: string } {
  const fromEas = (Constants as any)?.easConfig?.projectId as string | undefined;
  if (fromEas?.toString()?.trim()) return { projectId: fromEas.toString().trim(), source: 'Constants.easConfig.projectId' };
  const fromExtra = (Constants as any)?.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (fromExtra?.toString()?.trim()) return { projectId: fromExtra.toString().trim(), source: 'Constants.expoConfig.extra.eas.projectId' };
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID as string | undefined;
  if (fromEnv?.toString()?.trim()) return { projectId: fromEnv.toString().trim(), source: 'process.env.EXPO_PUBLIC_EAS_PROJECT_ID' };
  return {};
}

function isUuid(v: string | undefined): boolean {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function getPushTokenWithReason(): Promise<{ token: string | null; reason?: string }> {
  if (!Device.isDevice) return { token: null, reason: 'This only works on a real phone (not simulator).' };

  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== 'granted') return { token: null, reason: 'Notification permission is not granted.' };

  const { projectId, source } = getEasProjectIdWithSource();
  if (!isUuid(projectId)) {
    return {
      token: null,
      reason:
        `Missing/invalid EAS Project ID (got: ${projectId ?? 'undefined'}${source ? ` from ${source}` : ''}). ` +
        'Set EXPO_PUBLIC_EAS_PROJECT_ID to the UUID from Expo dashboard, then fully restart Expo (`npx expo start --clear`).',
    };
  }

  try {
    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult?.data;
    if (!token || typeof token !== 'string') return { token: null, reason: 'Expo did not return a push token.' };
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'FlyFam',
        importance: Notifications.AndroidImportance.HIGH,
        enableVibrate: true,
        sound: 'default',
      });
    }
    return { token };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? 'unknown error');
    console.warn('[Push] getExpoPushTokenAsync failed:', msg);
    return { token: null, reason: msg };
  }
}

export async function scheduleLocalTestNotification(): Promise<void> {
  // This works on simulators and real devices (as a local notification).
  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== 'granted') {
    throw new Error('Notification permission is not granted.');
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'FlyFam',
      body: 'Local test notification',
      sound: 'default',
    },
    trigger: null,
  });
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  const res = await getPushTokenWithReason();
  return res.token;
}

/**
 * Save or update the push token for the current user.
 * Also updates the user's timezone_iana so notifications and roster day grouping are locale-aware.
 */
export async function savePushTokenToSupabase(userId: string, token: string): Promise<void> {
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
  if (!platform) return;
  const appVersion = String((Constants as any)?.expoConfig?.version ?? '').trim() || null;
  const appBuild = String((Constants as any)?.nativeBuildVersion ?? '').trim() || null;
  const osVersion = String((Device as any)?.osVersion ?? '').trim() || null;

  const { error } = await supabase.from('device_tokens').upsert(
    {
      user_id: userId,
      token,
      platform,
      app_version: appVersion,
      app_build: appBuild,
      os_version: osVersion,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,token', ignoreDuplicates: false }
  );
  if (error) console.warn('[Push] Failed to save token:', error.message);

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) {
      await supabase.from('profiles').update({ timezone_iana: tz }).eq('id', userId);
    }
  } catch {
    // Ignore if timezone or profiles update fails (e.g. column not yet migrated)
  }
}

/** Register for push and persist token for signed-in user (crew/family). */
export async function registerPushTokenForUser(userId: string): Promise<void> {
  const res = await getPushTokenWithReason();
  if (res.token) {
    await savePushTokenToSupabase(userId, res.token);
    if (__DEV__) console.log('[Push] Token registered and saved for user', userId.slice(0, 8) + '…');
  } else if (res.reason) {
    console.warn('[Push] Could not register token for user:', res.reason);
  }
}

function extractPushUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const url = (data as { url?: unknown }).url;
  if (typeof url !== 'string') return null;
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/** Open optional `data.url` from admin / deep-link pushes (TestFlight, APK, etc.). */
export function installPushUrlOpenHandler(): () => void {
  const open = (data: unknown) => {
    const url = extractPushUrl(data);
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  };

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    open(response.notification.request.content.data);
  });

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) open(response.notification.request.content.data);
  });

  return () => sub.remove();
}

// Backward-compatible alias.
export async function registerPushTokenForFamilyUser(userId: string): Promise<void> {
  return registerPushTokenForUser(userId);
}
