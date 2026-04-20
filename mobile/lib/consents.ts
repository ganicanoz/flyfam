import { supabase } from '@/lib/supabase';

export const CONSENT_VERSION = '2026-04-v1';
export const REQUIRED_CONSENT_TYPES = ['privacy_notice', 'terms_disclaimer'] as const;

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

