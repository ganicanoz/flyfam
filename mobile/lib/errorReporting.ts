/**
 * Mobile JS error reporting → `client_error_events` (insert-only, own rows).
 * Never throws and never blocks UX. Signed-out errors are dropped (RLS needs a session).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { supabase } from './supabase';
import { appMeta } from './userActivity';
import { navigationRef } from '../navigationRef';

export type ClientErrorSource = 'boundary' | 'global' | 'promise';

type ClientErrorRow = {
  occurred_at: string;
  source: ClientErrorSource;
  is_fatal: boolean;
  error_name: string | null;
  message: string;
  stack: string | null;
  component_stack: string | null;
  screen: string | null;
  platform: string | null;
  app_version: string | null;
  app_build: string | null;
  ota_update_id: string | null;
};

const PENDING_KEY = 'flyfam_pending_client_errors';
const MAX_PENDING = 5;
const MAX_REPORTS_PER_SESSION = 10;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const FATAL_PERSIST_TIMEOUT_MS = 800;

let reportsThisSession = 0;
const recentKeys = new Map<string, number>();
let installed = false;

function clip(value: unknown, max: number): string | null {
  if (value == null) return null;
  const s = String(value);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function currentScreen(): string | null {
  try {
    return navigationRef.isReady() ? clip(navigationRef.getCurrentRoute()?.name, 80) : null;
  } catch {
    return null;
  }
}

function buildRow(
  error: unknown,
  source: ClientErrorSource,
  isFatal: boolean,
  componentStack?: string | null,
): ClientErrorRow {
  const err = error instanceof Error ? error : null;
  const meta = appMeta();
  return {
    occurred_at: new Date().toISOString(),
    source,
    is_fatal: isFatal,
    error_name: clip(err?.name, 120),
    message: clip(err ? err.message : error, 1000) ?? '(empty error)',
    stack: clip(err?.stack, 8000),
    component_stack: clip(componentStack, 4000),
    screen: currentScreen(),
    platform: clip(meta.platform, 16),
    app_version: clip(meta.app_version, 40),
    app_build: clip(meta.app_build, 40),
    ota_update_id: clip(Updates.updateId, 64),
  };
}

function shouldReport(row: ClientErrorRow): boolean {
  if (reportsThisSession >= MAX_REPORTS_PER_SESSION) return false;
  const key = `${row.source}|${row.error_name}|${row.message}`;
  const now = Date.now();
  const prev = recentKeys.get(key);
  if (prev != null && now - prev < DEDUPE_WINDOW_MS) return false;
  recentKeys.set(key, now);
  reportsThisSession += 1;
  return true;
}

async function insertRows(rows: ClientErrorRow[]): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return false;
  const { error } = await supabase
    .from('client_error_events')
    .insert(rows.map((r) => ({ ...r, user_id: uid })));
  return !error;
}

async function persistPending(row: ClientErrorRow): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const list: ClientErrorRow[] = raw ? JSON.parse(raw) : [];
    list.push(row);
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    // ignore
  }
}

/** Sends errors saved by a previous fatal crash. Keeps them if signed out or offline. */
export async function flushPendingClientErrors(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const list: ClientErrorRow[] = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) {
      await AsyncStorage.removeItem(PENDING_KEY);
      return;
    }
    if (await insertRows(list.slice(-MAX_PENDING))) await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export async function reportClientError(
  error: unknown,
  opts: { source: ClientErrorSource; isFatal?: boolean; componentStack?: string | null },
): Promise<void> {
  try {
    const row = buildRow(error, opts.source, opts.isFatal === true, opts.componentStack);
    if (!shouldReport(row)) return;
    if (row.is_fatal) {
      await persistPending(row);
      return;
    }
    await insertRows([row]);
  } catch {
    // ignore
  }
}

export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as { ErrorUtils?: {
    getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
    setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    const report = reportClientError(error, { source: 'global', isFatal: isFatal === true });
    if (isFatal && !__DEV__) {
      // A fatal handler terminates the app; give the pending write a short head start.
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, FATAL_PERSIST_TIMEOUT_MS));
      void Promise.race([report, timeout]).finally(() => previous?.(error, isFatal));
      return;
    }
    previous?.(error, isFatal);
  });

  if (!__DEV__) {
    // Dev keeps React Native's own LogBox rejection warnings.
    const hermes = (globalThis as {
      HermesInternal?: {
        enablePromiseRejectionTracker?: (opts: {
          allRejections: boolean;
          onUnhandled: (id: number, rejection: unknown) => void;
        }) => void;
      };
    }).HermesInternal;
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        void reportClientError(rejection, { source: 'promise' });
      },
    });
  }

  void flushPendingClientErrors();
}
