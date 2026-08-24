import Constants from 'expo-constants';
import { supabase } from './supabase';
import { IOS_IAP_PRODUCTS, getTierByCode } from '../constants/iapProducts';

export type IosDiscountOffer = {
  identifier: string;
  keyIdentifier: string;
  nonce: string;
  signature: string;
  timestamp: number;
};

function readPromoOfferId(): string {
  const fromEnv = String(process.env.EXPO_PUBLIC_IOS_MONTHLY_PROMO_OFFER_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { iosMonthlyPromoOfferId?: string } | undefined;
  return String(extra?.iosMonthlyPromoOfferId ?? '').trim();
}

/** App Store Connect → Promotional Offer → Reference Name (Offer Identifier). */
export function getIosMonthlyPromoOfferId(): string {
  return readPromoOfferId();
}

export function isIosMonthlyPromoOfferConfigured(): boolean {
  return getIosMonthlyPromoOfferId().length > 0;
}

export async function fetchSignedIosPromotionalOffer(
  productId: string = getTierByCode('duo')?.iosMonthlyProductId ?? IOS_IAP_PRODUCTS.MONTHLY,
): Promise<IosDiscountOffer | null> {
  const offerId = getIosMonthlyPromoOfferId();
  if (!offerId) return null;

  const { data, error } = await supabase.functions.invoke('sign-apple-promotional-offer', {
    body: { productId, offerId },
  });

  if (error) throw error;
  const payload = data as { ok?: boolean; offer?: IosDiscountOffer; error?: string };
  if (!payload?.ok || !payload.offer) {
    throw new Error(payload?.error || 'Failed to sign promotional offer');
  }
  return payload.offer;
}
