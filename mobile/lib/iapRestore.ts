/**
 * Step 2 skeleton:
 * Central restore entry-point for future App Store / Play Store SDK integration.
 */
import { supabase } from './supabase';
import { refreshMyEntitlements } from './subscriptionAccess';
import { fetchSignedIosPromotionalOffer, isIosMonthlyPromoOfferConfigured } from './applePromotionalOffer';
import Constants from 'expo-constants';

export type StorePurchaseVerificationInput = {
  platform: 'ios' | 'android';
  productId: string;
  transactionId: string;
  originalTransactionId?: string | null;
  purchaseAtMs?: number | null;
  receiptData?: string | null;
};

export type IosPurchaseCallbackPayload = {
  productId: string;
  transactionId: string;
  originalTransactionId?: string | null;
  transactionDateMs?: number | null;
  receiptData?: string | null;
};

type IapModule = typeof import('react-native-iap');

async function loadIapModule(): Promise<IapModule> {
  // Expo Go does not support Nitro modules (react-native-iap v15+).
  if (Constants.appOwnership === 'expo') {
    throw new Error('Store purchases are not supported in Expo Go. Use a development build.');
  }
  return import('react-native-iap');
}

export async function verifyStorePurchase(input: StorePurchaseVerificationInput): Promise<void> {
  const { error } = await supabase.functions.invoke('verify-store-purchase', {
    body: input,
  });
  if (error) throw error;
}

/**
 * Step 4 callback bridge:
 * Call this directly inside iOS purchase success callback/listener.
 */
export async function verifyIosPurchaseFromCallback(purchase: IosPurchaseCallbackPayload): Promise<void> {
  await verifyStorePurchase({
    platform: 'ios',
    productId: purchase.productId,
    transactionId: purchase.transactionId,
    originalTransactionId: purchase.originalTransactionId ?? null,
    purchaseAtMs: purchase.transactionDateMs ?? null,
    receiptData: purchase.receiptData ?? null,
  });
}

function mapIosPurchasePayload(purchase: any): IosPurchaseCallbackPayload {
  return {
    productId: String(purchase?.productId ?? ''),
    transactionId: String(
      purchase?.transactionId ??
      purchase?.transactionIdentifierIOS ??
      purchase?.originalTransactionIdentifierIOS ??
      '',
    ),
    originalTransactionId: String(
      purchase?.originalTransactionIdentifierIOS ??
      purchase?.originalTransactionId ??
      '',
    ) || null,
    transactionDateMs: Number(purchase?.transactionDate ?? Date.now()),
    receiptData: String(
      purchase?.transactionReceipt ??
      purchase?.transactionReceiptIOS ??
      '',
    ) || null,
  };
}

export async function purchaseBaseSubscriptionIos(productId: string): Promise<void> {
  const iap = await loadIapModule();
  await iap.initConnection();
  const fallbackReceipt = await iap.getReceiptIOS().catch(() => null);
  // Promotional offer is Duo monthly only (intro/promo configured on that SKU in ASC).
  const withOffer =
    isIosMonthlyPromoOfferConfigured() &&
    (productId === 'flyfam.duo.monthly' || productId === '01')
      ? await fetchSignedIosPromotionalOffer(productId)
      : null;
  await new Promise<void>((resolve, reject) => {
    let purchaseSub: { remove: () => void } | null = null;
    let errorSub: { remove: () => void } | null = null;
    let done = false;

    const cleanup = () => {
      purchaseSub?.remove();
      errorSub?.remove();
      void iap.endConnection();
    };
    const settle = (err?: unknown) => {
      if (done) return;
      done = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    purchaseSub = iap.purchaseUpdatedListener((purchase: any) => {
      void (async () => {
        try {
          const payload = mapIosPurchasePayload(purchase);
          payload.receiptData = payload.receiptData ?? fallbackReceipt ?? null;
          if (!payload.productId || !payload.transactionId) {
            throw new Error('Missing iOS purchase identifiers');
          }
          await verifyIosPurchaseFromCallback(payload);
          await iap.finishTransaction({
            purchase,
            isConsumable: false,
          });
          settle();
        } catch (e) {
          settle(e);
        }
      })();
    });

    errorSub = iap.purchaseErrorListener((err) => {
      settle(new Error(err.message || 'Purchase failed'));
    });

    void iap.requestPurchase({
      type: 'subs',
      request: {
        ios: {
          sku: productId,
          ...(withOffer ? { withOffer } : {}),
        },
      },
    }).catch((e) => settle(e));
  });
}

/**
 * @deprecated Family add-on consumable discontinued — use tier packages instead.
 */
export async function purchaseFamilyAddonIos(_productId: string): Promise<void> {
  throw new Error(
    'Family add-on is discontinued. Choose a larger subscription package (Duo → Circle) on the Plans screen.',
  );
}

export async function restorePurchases(): Promise<{ restored: boolean; source: string }> {
  const iap = await loadIapModule();
  await iap.initConnection();
  try {
    const purchases = await iap.getAvailablePurchases({
      onlyIncludeActiveItemsIOS: true,
      alsoPublishToEventListenerIOS: false,
    });
    const receipt = await iap.getReceiptIOS().catch(() => null);
    for (const purchase of purchases as any[]) {
      const payload = mapIosPurchasePayload(purchase);
      if (!payload.productId || !payload.transactionId) continue;
      payload.receiptData = payload.receiptData ?? receipt ?? null;
      await verifyIosPurchaseFromCallback(payload);
    }
  } finally {
    await iap.endConnection().catch(() => undefined);
  }
  const entitlement = await refreshMyEntitlements();
  return { restored: entitlement.premium_active, source: entitlement.source };
}
