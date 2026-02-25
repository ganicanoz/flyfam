/**
 * Push notification registration for family users.
 * Registers the device with Expo Push and saves the token to Supabase (device_tokens).
 */
import { Platform } from 'react-native';
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
        importance: Notifications.AndroidImportance.DEFAULT,
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
 * Save or update the push token for the current user (family). Call when family user is signed in.
 */
export async function savePushTokenToSupabase(userId: string, token: string): Promise<void> {
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : null;
  if (!platform) return;

  const { error } = await supabase.from('device_tokens').upsert(
    {
      user_id: userId,
      token,
      platform,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,token', ignoreDuplicates: false }
  );
  if (error) console.warn('[Push] Failed to save token:', error.message);
}

/**
 * Register for push and persist token. Call only for family users when signed in.
 */
export async function registerPushTokenForFamilyUser(userId: string): Promise<void> {
  const token = await registerForPushNotificationsAsync();
  if (token) await savePushTokenToSupabase(userId, token);
}
