import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim() ?? '';
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() ?? '';

let configuredUserId: string | null = null;

export function hasRevenueCatKey(): boolean {
  return Platform.OS === 'ios' ? Boolean(IOS_API_KEY) : Boolean(ANDROID_API_KEY);
}

async function getPurchases() {
  if (Constants.appOwnership === 'expo') {
    throw new Error('Store purchases are not supported in Expo Go. Use a development build.');
  }
  return (await import('react-native-purchases')).default;
}

export async function configureRevenueCatForCurrentUser() {
  if (!hasRevenueCatKey()) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error('A signed-in user is required for store purchases.');

  const Purchases = await getPurchases();
  const apiKey = Platform.OS === 'ios' ? IOS_API_KEY : ANDROID_API_KEY;

  if (!(await Purchases.isConfigured())) {
    Purchases.configure({ apiKey, appUserID: userId });
    configuredUserId = userId;
  } else if (configuredUserId !== userId) {
    await Purchases.logIn(userId);
    configuredUserId = userId;
  }

  return Purchases;
}

export async function purchaseRevenueCatProduct(productId: string) {
  const Purchases = await configureRevenueCatForCurrentUser();
  if (!Purchases) return null;

  const products = await Purchases.getProducts(
    [productId],
    Purchases.PRODUCT_CATEGORY.SUBSCRIPTION,
  );
  const product = products.find((item) => item.identifier === productId);
  if (!product) {
    throw new Error(`Store product not found: ${productId}`);
  }

  return Purchases.purchaseStoreProduct(product);
}

export async function restoreRevenueCatPurchases() {
  const Purchases = await configureRevenueCatForCurrentUser();
  if (!Purchases) return null;
  return Purchases.restorePurchases();
}
