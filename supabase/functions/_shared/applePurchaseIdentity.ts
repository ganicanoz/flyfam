/**
 * Client vs Apple identity comparison for store purchases.
 * Apple values are authoritative; client values are comparison-only.
 */

export type ApplePurchaseIdentity = {
  transactionId: string;
  productId: string;
  originalTransactionId: string | null;
};

export type ClientPurchaseIdentity = {
  transactionId: string;
  productId: string;
  originalTransactionId?: string | null;
};

export type PurchaseIdentityCheck =
  | { ok: true; apple: ApplePurchaseIdentity }
  | { ok: false; error: string };

export function checkClientPurchaseIdsAgainstApple(
  client: ClientPurchaseIdentity,
  apple: ApplePurchaseIdentity,
): PurchaseIdentityCheck {
  const appleOriginalTx = (apple.originalTransactionId ?? '').trim() || null;
  const appleTxId = apple.transactionId.trim();
  const appleProductId = apple.productId.trim();
  const clientTx = client.transactionId.trim();
  const clientProduct = client.productId.trim();
  const clientOrig = (client.originalTransactionId ?? '').trim() || null;

  if (!appleTxId || !appleProductId) {
    return { ok: false, error: 'Apple transaction/product identity missing' };
  }
  if (!appleOriginalTx) {
    return { ok: false, error: 'Apple originalTransactionId missing from verification' };
  }
  if (clientOrig && clientOrig !== appleOriginalTx) {
    return { ok: false, error: 'Client originalTransactionId does not match Apple verification' };
  }
  if (clientTx !== appleTxId && clientTx !== appleOriginalTx) {
    return { ok: false, error: 'Client transactionId does not match Apple verification' };
  }
  if (clientProduct !== appleProductId) {
    return { ok: false, error: 'Client productId does not match Apple verification' };
  }
  return {
    ok: true,
    apple: {
      transactionId: appleTxId,
      productId: appleProductId,
      originalTransactionId: appleOriginalTx,
    },
  };
}

/** Exclusive original_transaction_id ownership (mirrors SQL guard). */
export function originalTxBelongsToOtherUser(
  existingOwnerUserId: string | null | undefined,
  requestingUserId: string,
): boolean {
  if (!existingOwnerUserId) return false;
  return existingOwnerUserId !== requestingUserId;
}
