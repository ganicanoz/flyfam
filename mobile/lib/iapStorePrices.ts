/**
 * App Store / Play localized subscription prices for Plans UI.
 * Prefer StoreKit `displayPrice` (store account country currency), not app language.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Localization from 'expo-localization';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import {
  IAP_PRODUCTS,
  IOS_SUBSCRIPTION_GROUP_ID,
  SUBSCRIPTION_TIERS,
  type PackageCode,
} from '../constants/iapProducts';
import { supabase } from './supabase';
import { trackActivityEvent } from './userActivity';

export type TierStorePrices = {
  monthly: string;
  yearly: string;
  currency?: string | null;
  source: 'store' | 'list';
  monthlyAvailable?: boolean;
  yearlyAvailable?: boolean;
  introOfferAvailable?: boolean;
  introOfferEligible?: boolean;
};

function formatListPrice(amount: number, currency: 'TRY' | 'USD', locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    if (currency === 'TRY') return `₺${amount.toFixed(2).replace('.', ',')}`;
    return `$${amount.toFixed(2)}`;
  }
}

/** Fallback when StoreKit is unavailable: TUR storefront / TR region → TRY, else USD. */
export function listFallbackCurrency(storefrontCountry?: string | null): 'TRY' | 'USD' {
  const sf = (storefrontCountry || '').trim().toUpperCase();
  if (sf === 'TUR' || sf === 'TR') return 'TRY';
  try {
    const regions = Localization.getLocales?.()?.map((l) => (l.regionCode || '').toUpperCase()) ?? [];
    if (regions.some((r) => r === 'TR')) return 'TRY';
  } catch {
    // ignore
  }
  return 'USD';
}

function listFallbackPrices(currency: 'TRY' | 'USD'): Record<PackageCode, TierStorePrices> {
  const locale = currency === 'TRY' ? 'tr-TR' : 'en-US';
  const out = {} as Record<PackageCode, TierStorePrices>;
  for (const tier of SUBSCRIPTION_TIERS) {
    out[tier.code] = {
      monthly: formatListPrice(
        currency === 'TRY' ? tier.listPriceMonthlyTry : tier.listPriceMonthlyUsd,
        currency,
        locale,
      ),
      yearly: formatListPrice(
        currency === 'TRY' ? tier.listPriceYearlyTry : tier.listPriceYearlyUsd,
        currency,
        locale,
      ),
      currency,
      source: 'list',
      monthlyAvailable: true,
      yearlyAvailable: true,
    };
  }
  return out;
}

const STORE_PRICE_DIAG_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** StoreKit storefront vs returned currency, for admin diagnostics (no personal data). */
async function reportStorePriceDiagnostic(diag: {
  storefront: string | null;
  currency: string | null;
  productsReturned: number;
  sampleDisplayPrice: string | null;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return;
    const key = `flyfam_store_price_diag:${uid}:${diag.storefront ?? '-'}:${diag.currency ?? '-'}`;
    const prev = Number((await AsyncStorage.getItem(key)) ?? 0);
    if (Number.isFinite(prev) && Date.now() - prev < STORE_PRICE_DIAG_THROTTLE_MS) return;
    await AsyncStorage.setItem(key, String(Date.now()));
    let deviceRegion: string | null = null;
    try {
      deviceRegion = Localization.getLocales?.()?.[0]?.regionCode ?? null;
    } catch {
      deviceRegion = null;
    }
    await trackActivityEvent(uid, 'screen_view', {
      screen: 'Plans:store_prices',
      store_storefront: diag.storefront,
      store_currency: diag.currency,
      store_products_returned: diag.productsReturned,
      store_sample_display_price: diag.sampleDisplayPrice,
      device_region: deviceRegion,
      ota_update_id: Updates.updateId ?? null,
    });
  } catch {
    // diagnostics must never affect the Plans screen
  }
}

/**
 * Load localized subscription prices from the store.
 * On iOS uses StoreKit (user's Apple ID country). Falls back to list TRY/USD by storefront/region.
 */
export async function fetchSubscriptionTierDisplayPrices(): Promise<Record<PackageCode, TierStorePrices>> {
  if (Platform.OS !== 'ios' || Constants.appOwnership === 'expo') {
    return listFallbackPrices(listFallbackCurrency(null));
  }

  try {
    const iap = await import('react-native-iap');
    await iap.initConnection();
    let storefront: string | null = null;
    try {
      storefront = (await iap.getStorefront()) || null;
    } catch {
      storefront = null;
    }

    const skus = [...IAP_PRODUCTS.ios.subscriptions];
    const products = await iap.fetchProducts({ skus, type: 'subs' });
    const byId = new Map<string, {
      displayPrice: string;
      currency?: string | null;
      introOfferAvailable: boolean;
    }>();
    for (const p of (products ?? []) as Array<{
      id?: string;
      productId?: string;
      displayPrice?: string;
      localizedPrice?: string | null;
      currency?: string | null;
      introductoryPriceIOS?: string | null;
      subscriptionOffers?: Array<{ type?: string | null; offerType?: string | null }> | null;
    }>) {
      const id = String(p.id ?? p.productId ?? '').trim();
      const display = String(p.displayPrice ?? p.localizedPrice ?? '').trim();
      if (!id || !display) continue;
      const introOfferAvailable =
        !!String(p.introductoryPriceIOS ?? '').trim() ||
        (p.subscriptionOffers ?? []).some((offer) =>
          String(offer.type ?? offer.offerType ?? '').toLowerCase().includes('intro'),
        );
      byId.set(id, { displayPrice: display, currency: p.currency ?? null, introOfferAvailable });
    }

    const introOfferEligible = await iap
      .isEligibleForIntroOfferIOS(IOS_SUBSCRIPTION_GROUP_ID)
      .catch(() => false);

    const out = {} as Record<PackageCode, TierStorePrices>;

    for (const tier of SUBSCRIPTION_TIERS) {
      const monthly = byId.get(tier.iosMonthlyProductId);
      const yearly = byId.get(tier.iosYearlyProductId);
      out[tier.code] = {
        // Native iOS must never mix App Store prices with hard-coded list prices.
        // A missing product stays unavailable until StoreKit returns it.
        monthly: monthly?.displayPrice ?? '—',
        yearly: yearly?.displayPrice ?? '—',
        currency: monthly?.currency ?? yearly?.currency ?? null,
        source: 'store',
        monthlyAvailable: !!monthly,
        yearlyAvailable: !!yearly,
        introOfferAvailable: monthly?.introOfferAvailable ?? false,
        introOfferEligible,
      };
    }

    await iap.endConnection().catch(() => undefined);
    const sample = byId.get(SUBSCRIPTION_TIERS[0]?.iosMonthlyProductId ?? '') ?? byId.values().next().value;
    void reportStorePriceDiagnostic({
      storefront,
      currency: sample?.currency ?? null,
      productsReturned: byId.size,
      sampleDisplayPrice: sample?.displayPrice ?? null,
    });
    return out;
  } catch {
    // A native iOS StoreKit failure is not a license to show potentially wrong
    // prices. Keep every plan visible but unavailable until the store responds.
    return Object.fromEntries(
      SUBSCRIPTION_TIERS.map((tier) => [
        tier.code,
        {
          monthly: '—',
          yearly: '—',
          currency: null,
          source: 'store' as const,
          monthlyAvailable: false,
          yearlyAvailable: false,
        },
      ]),
    ) as Record<PackageCode, TierStorePrices>;
  }
}
