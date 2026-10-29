/**
 * Production OTA: check → fetch → deferred reload.
 *
 * Never reload synchronously during first React mount — that hard-crashed
 * TestFlight when a bad bundle was applied mid-boot. Reload only after a
 * short idle delay; skip emergency launches and throttle repeats.
 */
import { AppState, InteractionManager, Platform } from 'react-native';
import * as Updates from 'expo-updates';

const MIN_INTERVAL_MS = 60_000;
const DEFAULT_RELOAD_DELAY_MS = 2_000;
let lastAttemptMs = 0;
let reloadScheduled = false;
let inFlight: Promise<ApplyOtaResult> | null = null;

export type ApplyOtaResult =
  | { status: 'skipped'; reason: string }
  | { status: 'up_to_date' }
  | { status: 'downloaded' }
  | { status: 'reloading' }
  | { status: 'error'; message: string };

export function otaDiagnostics(): Record<string, unknown> {
  try {
    return {
      ota_update_id: Updates.updateId ?? null,
      ota_channel: Updates.channel ?? null,
      ota_runtime: Updates.runtimeVersion ?? null,
      ota_is_embedded: Updates.isEmbeddedLaunch === true,
      ota_is_emergency: Updates.isEmergencyLaunch === true,
      ota_created_at: Updates.createdAt ? Updates.createdAt.toISOString() : null,
    };
  } catch {
    return { ota_update_id: null, ota_is_embedded: null };
  }
}

function shouldSkipClient(): string | null {
  if (Platform.OS === 'web') return 'web';
  if (typeof __DEV__ !== 'undefined' && __DEV__) return 'dev';
  if (!Updates.isEnabled) return 'updates_disabled';
  try {
    if (Updates.isEmergencyLaunch) return 'emergency';
  } catch {
    /* ignore */
  }
  return null;
}

function scheduleReload(delayMs: number): void {
  if (reloadScheduled) return;
  reloadScheduled = true;
  const run = () => {
    void Updates.reloadAsync().catch(() => {
      reloadScheduled = false;
    });
  };
  InteractionManager.runAfterInteractions(() => {
    setTimeout(run, Math.max(0, delayMs));
  });
}

/**
 * Download a newer channel update if present. Reloads only after `reloadDelayMs`
 * so native/JS bootstrap can finish (avoids second-launch hard crash).
 */
export async function applyOtaUpdateIfAvailable(opts?: {
  force?: boolean;
  /** When false, only download — apply on next cold start. Default true. */
  reload?: boolean;
  reloadDelayMs?: number;
}): Promise<ApplyOtaResult> {
  const skip = shouldSkipClient();
  if (skip) return { status: 'skipped', reason: skip };
  if (reloadScheduled) return { status: 'skipped', reason: 'reload_scheduled' };

  const now = Date.now();
  if (!opts?.force && now - lastAttemptMs < MIN_INTERVAL_MS) {
    return { status: 'skipped', reason: 'throttled' };
  }
  if (inFlight) return inFlight;

  lastAttemptMs = now;
  const wantReload = opts?.reload !== false;
  const delayMs = opts?.reloadDelayMs ?? DEFAULT_RELOAD_DELAY_MS;

  inFlight = (async (): Promise<ApplyOtaResult> => {
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return { status: 'up_to_date' };
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) return { status: 'up_to_date' };
      if (!wantReload) return { status: 'downloaded' };
      scheduleReload(delayMs);
      return { status: 'reloading' };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { status: 'error', message };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Foreground: re-check when user returns (throttled; deferred reload). */
export function subscribeOtaOnForeground(): () => void {
  if (shouldSkipClient()) return () => {};
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') void applyOtaUpdateIfAvailable();
  });
  return () => sub.remove();
}
