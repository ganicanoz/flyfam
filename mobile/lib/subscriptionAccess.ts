import { supabase } from '@/lib/supabase';
import type { PackageCode } from '../constants/iapProducts';

export type { PackageCode };

export type SubscriptionAccess = {
  role: 'crew' | 'family' | null;
  crew_id: string | null;
  plan_code: PackageCode | string | null;
  plan_title: string | null;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | null;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  base_family_members: number | null;
  extra_family_slots: number;
  max_extra_family_members: number;
  extra_family_member_price_usd: number | null;
  max_family_members: number | null;
  used_family_approved: number;
  used_family_pending: number;
  available_family_slots: number;
  can_invite_more: boolean;
  has_access: boolean;
};

const emptyAccess: SubscriptionAccess = {
  role: null,
  crew_id: null,
  plan_code: null,
  plan_title: null,
  subscription_status: null,
  trial_ends_at: null,
  current_period_ends_at: null,
  base_family_members: null,
  extra_family_slots: 0,
  max_extra_family_members: 0,
  extra_family_member_price_usd: null,
  max_family_members: null,
  used_family_approved: 0,
  used_family_pending: 0,
  available_family_slots: 0,
  can_invite_more: false,
  has_access: false,
};

export async function fetchMySubscriptionAccess(): Promise<SubscriptionAccess> {
  const { data, error } = await supabase.rpc('get_my_subscription_access');
  if (error) {
    throw error;
  }
  if (!data || typeof data !== 'object') return emptyAccess;
  const row = data as Record<string, unknown>;
  return {
    role: (row.role as SubscriptionAccess['role']) ?? null,
    crew_id: (row.crew_id as string | null) ?? null,
    plan_code: (row.plan_code as string | null) ?? null,
    plan_title: (row.plan_title as string | null) ?? null,
    subscription_status: (row.subscription_status as SubscriptionAccess['subscription_status']) ?? null,
    trial_ends_at: (row.trial_ends_at as string | null) ?? null,
    current_period_ends_at: (row.current_period_ends_at as string | null) ?? null,
    base_family_members: typeof row.base_family_members === 'number' ? row.base_family_members : null,
    extra_family_slots: typeof row.extra_family_slots === 'number' ? row.extra_family_slots : 0,
    max_extra_family_members: typeof row.max_extra_family_members === 'number' ? row.max_extra_family_members : 0,
    extra_family_member_price_usd:
      typeof row.extra_family_member_price_usd === 'number' ? row.extra_family_member_price_usd : null,
    max_family_members: typeof row.max_family_members === 'number' ? row.max_family_members : null,
    used_family_approved: typeof row.used_family_approved === 'number' ? row.used_family_approved : 0,
    used_family_pending: typeof row.used_family_pending === 'number' ? row.used_family_pending : 0,
    available_family_slots: typeof row.available_family_slots === 'number' ? row.available_family_slots : 0,
    can_invite_more: !!row.can_invite_more,
    has_access: !!row.has_access,
  };
}

export async function chooseSubscriptionPlan(planCode: PackageCode): Promise<void> {
  const { error } = await supabase.rpc('select_subscription_plan', {
    p_plan_code: planCode,
  });
  if (error) throw error;
}

/** @deprecated Extra slots discontinued — capacity comes from plan tiers only. */
export async function setMyExtraFamilySlots(slots: number): Promise<void> {
  const { error } = await supabase.rpc('set_my_extra_family_slots', {
    p_slots: Math.max(0, Math.trunc(slots)),
  });
  if (error) throw error;
}

export type UserEntitlement = {
  user_id: string;
  premium_active: boolean;
  source: string;
  updated_at: string;
};

export async function refreshMyEntitlements(): Promise<UserEntitlement> {
  const { data, error } = await supabase.rpc('refresh_my_entitlements');
  if (error) throw error;
  if (!data || typeof data !== 'object') {
    throw new Error('Entitlement refresh returned empty data');
  }
  const row = data as Record<string, unknown>;
  return {
    user_id: String(row.user_id ?? ''),
    premium_active: !!row.premium_active,
    source: String(row.source ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}
