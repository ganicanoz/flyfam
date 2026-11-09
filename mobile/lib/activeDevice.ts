import { Alert } from 'react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';
import i18n from './i18n';
import { getOrCreateInstallId } from './installId';
import { supabase } from './supabase';

export type ActiveDeviceAssertResult =
  | { ok: true; active: true; pending_register?: boolean }
  | { ok: false; code: 'other_device_active' | 'error' };

let registerInFlight: Promise<boolean> | null = null;
let lastRegisteredInstall: string | null = null;

async function readFunctionsErrorBody(error: unknown): Promise<{ status?: number; code?: string }> {
  if (!(error instanceof FunctionsHttpError)) return {};
  const context = error.context as Response | undefined;
  const status = context?.status;
  try {
    const body = (await context?.clone?.().json?.()) as { code?: string } | undefined;
    return { status, code: body?.code };
  } catch {
    return { status };
  }
}

export async function registerActiveDevice(): Promise<boolean> {
  if (registerInFlight) return registerInFlight;
  registerInFlight = (async () => {
    try {
      const install_id = await getOrCreateInstallId();
      if (lastRegisteredInstall === install_id) return true;
      const { data, error } = await supabase.functions.invoke('register-active-device', {
        body: { action: 'register', install_id },
      });
      if (error) {
        console.warn('[activeDevice] register', error.message);
        return false;
      }
      if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
        return false;
      }
      lastRegisteredInstall = install_id;
      return true;
    } catch (e) {
      console.warn('[activeDevice] register', e);
      return false;
    } finally {
      registerInFlight = null;
    }
  })();
  return registerInFlight;
}

export async function assertActiveDevice(): Promise<ActiveDeviceAssertResult> {
  try {
    const install_id = await getOrCreateInstallId();
    const { data, error } = await supabase.functions.invoke('register-active-device', {
      body: { action: 'assert', install_id },
    });
    if (error) {
      const parsed = await readFunctionsErrorBody(error);
      if (parsed.status === 409 || parsed.code === 'other_device_active') {
        return { ok: false, code: 'other_device_active' };
      }
      // Network / function missing: do not kick user offline.
      console.warn('[activeDevice] assert', error.message);
      return { ok: true, active: true };
    }
    const body = (data ?? {}) as {
      ok?: boolean;
      code?: string;
      pending_register?: boolean;
    };
    if (body.code === 'other_device_active') {
      return { ok: false, code: 'other_device_active' };
    }
    if (body.ok === false) {
      return { ok: false, code: 'error' };
    }
    if (body.pending_register) {
      void registerActiveDevice();
    }
    return { ok: true, active: true, pending_register: !!body.pending_register };
  } catch (e) {
    console.warn('[activeDevice] assert', e);
    return { ok: true, active: true };
  }
}

/** Sign out locally and show the other-device message (caller supplies signOut). */
export async function kickForOtherDevice(signOut: () => Promise<void>): Promise<void> {
  lastRegisteredInstall = null;
  await signOut();
  Alert.alert(i18n.t('auth.otherDeviceTitle'), i18n.t('auth.otherDeviceMessage'));
}

export function resetActiveDeviceCache(): void {
  lastRegisteredInstall = null;
}
