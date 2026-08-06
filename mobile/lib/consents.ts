import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { LEGAL_TEXT_VERSION } from '@/lib/legalTexts';

/** Policy version stored in user_consents; must match legalTexts.ts */
export const CONSENT_VERSION = LEGAL_TEXT_VERSION;
export const REQUIRED_CONSENT_TYPES = ['privacy_notice', 'terms_disclaimer'] as const;

const PENDING_CONSENT_KEY = 'flyfam_pending_signup_consents_v1';

export type ConsentType = (typeof REQUIRED_CONSENT_TYPES)[number] | 'marketing_optional';

export type UserConsentRow = {
  id: string;
  consent_type: string;
  accepted: boolean;
  policy_version: string;
  locale: string | null;
  source: string;
  accepted_at: string;
  created_at: string;
};

type PendingSignupConsent = {
  email: string;
  locale: 'tr' | 'en';
  policy_version: string;
  accepted_at: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Signup with email-confirm: checkboxes accepted but no session yet — stash until first sign-in. */
export async function stashPendingSignupConsents(params: {
  email: string;
  locale: 'tr' | 'en';
}): Promise<void> {
  const payload: PendingSignupConsent = {
    email: normalizeEmail(params.email),
    locale: params.locale,
    policy_version: CONSENT_VERSION,
    accepted_at: new Date().toISOString(),
  };
  await AsyncStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify(payload));
}

export async function clearPendingSignupConsents(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CONSENT_KEY);
}

async function readPendingSignupConsents(): Promise<PendingSignupConsent | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSignupConsent;
    if (!parsed?.email || parsed.policy_version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * If user accepted consents on SignUp before email confirm, write them on first authenticated session
 * so Consent screen is not shown again for the same version.
 */
export async function flushPendingSignupConsents(params: {
  userId: string;
  email: string | null | undefined;
}): Promise<boolean> {
  const pending = await readPendingSignupConsents();
  if (!pending) return false;
  const email = normalizeEmail(params.email ?? '');
  if (!email || email !== pending.email) return false;
  await saveRequiredConsents({ userId: params.userId, locale: pending.locale, source: 'signup_pending' });
  await clearPendingSignupConsents();
  return true;
}

export async function hasRequiredConsents(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_consents')
    .select('consent_type, accepted')
    .eq('user_id', userId)
    .eq('policy_version', CONSENT_VERSION)
    .in('consent_type', [...REQUIRED_CONSENT_TYPES])
    .eq('accepted', true);

  if (error) return false;
  const types = new Set((data ?? []).map((x) => x.consent_type));
  return REQUIRED_CONSENT_TYPES.every((type) => types.has(type));
}

export async function saveRequiredConsents(params: { userId: string; locale: 'tr' | 'en'; source?: string }): Promise<void> {
  const rows = REQUIRED_CONSENT_TYPES.map((consentType) => ({
    user_id: params.userId,
    consent_type: consentType,
    accepted: true,
    policy_version: CONSENT_VERSION,
    locale: params.locale,
    source: params.source ?? 'reconsent',
  }));

  const { error } = await supabase
    .from('user_consents')
    .upsert(rows, { onConflict: 'user_id,consent_type,policy_version' });

  if (error) throw error;
}

