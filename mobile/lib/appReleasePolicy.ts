import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getNativeBuildNumber } from './appVersion';

export type AppReleasePolicy = {
  key: string;
  min_ios_build: number;
  min_android_build: number;
  force: boolean;
  title_tr: string;
  body_tr: string;
  title_en: string;
  body_en: string;
  ios_store_url: string;
  android_store_url: string;
  android_invite_email: string;
};

export async function fetchAppReleasePolicy(): Promise<AppReleasePolicy | null> {
  const { data, error } = await supabase
    .from('app_release_policy')
    .select(
      'key, min_ios_build, min_android_build, force, title_tr, body_tr, title_en, body_en, ios_store_url, android_store_url, android_invite_email',
    )
    .eq('key', 'default')
    .maybeSingle();
  if (error || !data) return null;
  return data as AppReleasePolicy;
}

export function isUpdateRequired(policy: AppReleasePolicy | null): boolean {
  // Dev client / simulator: native binary often lags store builds; don't block Metro work.
  if (typeof __DEV__ !== 'undefined' && __DEV__) return false;
  if (!policy?.force) return false;
  const build = getNativeBuildNumber();
  if (build == null) return false;
  const min =
    Platform.OS === 'ios' ? Number(policy.min_ios_build) : Number(policy.min_android_build);
  if (!Number.isFinite(min)) return false;
  return build < min;
}

export function policyTitle(policy: AppReleasePolicy, lang: string): string {
  return lang.startsWith('tr') ? policy.title_tr : policy.title_en;
}

export function policyBody(policy: AppReleasePolicy, lang: string): string {
  return lang.startsWith('tr') ? policy.body_tr : policy.body_en;
}
