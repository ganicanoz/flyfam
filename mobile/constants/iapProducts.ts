/** App Store Connect subscription group for all FlyFam crew packages. */
export const IOS_SUBSCRIPTION_GROUP = 'flyfam_base' as const;

export type PackageCode =
  | 'duo'
  | 'trio'
  | 'family'
  | 'family_plus'
  | 'extended'
  | 'clan'
  | 'circle';

export type SubscriptionTier = {
  code: PackageCode;
  /** Family seats included (crew is always 1). */
  maxFamilyMembers: number;
  iosMonthlyProductId: string;
  iosYearlyProductId: string;
  /** Ascending service level for Apple subscription group ranking (1 = entry). */
  appleLevel: number;
  /** List prices (ASC matrix). Store sheet is authoritative at purchase. */
  listPriceMonthlyTry: number;
  listPriceYearlyTry: number;
  listPriceMonthlyUsd: number;
  listPriceYearlyUsd: number;
};

/**
 * Single source of truth: tiered auto-renewable packages (no consumable add-on).
 * Product IDs must match App Store Connect exactly.
 *
 * Legacy aliases still accepted on the backend:
 * - `01` → duo monthly
 * - `02` → duo yearly
 */
export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  {
    code: 'duo',
    maxFamilyMembers: 1,
    iosMonthlyProductId: 'flyfam.duo.monthly',
    iosYearlyProductId: 'flyfam.duo.yearly',
    appleLevel: 1,
    listPriceMonthlyTry: 99.99,
    listPriceYearlyTry: 999.99,
    listPriceMonthlyUsd: 1.49,
    listPriceYearlyUsd: 14.99,
  },
  {
    code: 'trio',
    maxFamilyMembers: 2,
    iosMonthlyProductId: 'flyfam.trio.monthly',
    iosYearlyProductId: 'flyfam.trio.yearly',
    appleLevel: 2,
    listPriceMonthlyTry: 129.99,
    listPriceYearlyTry: 1299.99,
    listPriceMonthlyUsd: 1.99,
    listPriceYearlyUsd: 19.99,
  },
  {
    code: 'family',
    maxFamilyMembers: 3,
    iosMonthlyProductId: 'flyfam.family.monthly',
    iosYearlyProductId: 'flyfam.family.yearly',
    appleLevel: 3,
    listPriceMonthlyTry: 149.99,
    listPriceYearlyTry: 1499.99,
    listPriceMonthlyUsd: 2.49,
    listPriceYearlyUsd: 24.99,
  },
  {
    code: 'family_plus',
    maxFamilyMembers: 4,
    iosMonthlyProductId: 'flyfam.family_plus.monthly',
    iosYearlyProductId: 'flyfam.family_plus.yearly',
    appleLevel: 4,
    listPriceMonthlyTry: 179.99,
    listPriceYearlyTry: 1799.99,
    listPriceMonthlyUsd: 2.99,
    listPriceYearlyUsd: 29.99,
  },
  {
    code: 'extended',
    maxFamilyMembers: 5,
    iosMonthlyProductId: 'flyfam.extended.monthly',
    iosYearlyProductId: 'flyfam.extended.yearly',
    appleLevel: 5,
    listPriceMonthlyTry: 199.99,
    listPriceYearlyTry: 1999.99,
    listPriceMonthlyUsd: 3.49,
    listPriceYearlyUsd: 34.99,
  },
  {
    code: 'clan',
    maxFamilyMembers: 6,
    iosMonthlyProductId: 'flyfam.clan.monthly',
    iosYearlyProductId: 'flyfam.clan.yearly',
    appleLevel: 6,
    listPriceMonthlyTry: 229.99,
    listPriceYearlyTry: 2299.99,
    listPriceMonthlyUsd: 3.99,
    listPriceYearlyUsd: 39.99,
  },
  {
    code: 'circle',
    maxFamilyMembers: 7,
    iosMonthlyProductId: 'flyfam.circle.monthly',
    iosYearlyProductId: 'flyfam.circle.yearly',
    appleLevel: 7,
    listPriceMonthlyTry: 249.99,
    listPriceYearlyTry: 2499.99,
    listPriceMonthlyUsd: 4.49,
    listPriceYearlyUsd: 44.99,
  },
] as const;

/** @deprecated Use SUBSCRIPTION_TIERS — kept for older call sites during transition. */
export const IOS_IAP_PRODUCTS = {
  MONTHLY: 'flyfam.duo.monthly',
  YEARLY: 'flyfam.duo.yearly',
  /** Discontinued consumable — do not sell. */
  FAMILY_ADDON: '03',
} as const;

export const IOS_FAMILY_ADDON_PRODUCT_IDS = [
  IOS_IAP_PRODUCTS.FAMILY_ADDON,
  'EFUC',
  'EFU',
  'flyfam.monthly.addon_family_slot',
  'com.flyfam.addon.familypack',
] as const;

export const IAP_PRODUCTS = {
  ios: {
    subscriptionGroup: IOS_SUBSCRIPTION_GROUP,
    subscriptions: SUBSCRIPTION_TIERS.flatMap((t) => [t.iosMonthlyProductId, t.iosYearlyProductId]),
    /** @deprecated add-on removed from product model */
    familyAddon: IOS_IAP_PRODUCTS.FAMILY_ADDON,
  },
} as const;

export type IosSubscriptionProductId = (typeof IAP_PRODUCTS.ios.subscriptions)[number];
export type IosFamilyAddonProductId = (typeof IOS_FAMILY_ADDON_PRODUCT_IDS)[number];

export function getTierByCode(code: string | null | undefined): SubscriptionTier | undefined {
  if (!code) return undefined;
  return SUBSCRIPTION_TIERS.find((t) => t.code === code);
}

export function getTierByIosProductId(productId: string): SubscriptionTier | undefined {
  const id = productId.trim();
  if (id === '01' || id === '02') return getTierByCode('duo');
  return SUBSCRIPTION_TIERS.find(
    (t) => t.iosMonthlyProductId === id || t.iosYearlyProductId === id,
  );
}

export function isIosFamilyAddonProductId(productId: string): boolean {
  const id = productId.trim();
  return (IOS_FAMILY_ADDON_PRODUCT_IDS as readonly string[]).includes(id);
}

/** @deprecated Add-on discontinued */
export function resolveIosFamilyAddonProductId(): string {
  return IOS_IAP_PRODUCTS.FAMILY_ADDON;
}

export const IOS_MONTHLY_PROMO_OFFER_ENV = 'EXPO_PUBLIC_IOS_MONTHLY_PROMO_OFFER_ID' as const;
