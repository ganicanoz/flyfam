/**
 * Apple satın alma kimliği güven testleri.
 * Çalıştır: npx tsx mobile/scripts/test-apple-purchase-identity.ts
 *
 * Not: Edge Function `_shared` Deno yolundan Node ile import edilemez;
 * aynı kurallar burada aynen doğrulanır (kaynak: applePurchaseIdentity.ts).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type ApplePurchaseIdentity = {
  transactionId: string;
  productId: string;
  originalTransactionId: string | null;
};

type ClientPurchaseIdentity = {
  transactionId: string;
  productId: string;
  originalTransactionId?: string | null;
};

type PurchaseIdentityCheck =
  | { ok: true; apple: ApplePurchaseIdentity }
  | { ok: false; error: string };

function checkClientPurchaseIdsAgainstApple(
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

function originalTxBelongsToOtherUser(
  existingOwnerUserId: string | null | undefined,
  requestingUserId: string,
): boolean {
  if (!existingOwnerUserId) return false;
  return existingOwnerUserId !== requestingUserId;
}

function run() {
  const apple: ApplePurchaseIdentity = {
    transactionId: 'tx-100',
    productId: 'flyfam.monthly',
    originalTransactionId: 'orig-1',
  };

  const match = checkClientPurchaseIdsAgainstApple(
    { transactionId: 'tx-100', productId: 'flyfam.monthly', originalTransactionId: 'orig-1' },
    apple,
  );
  assert.equal(match.ok, true);
  if (match.ok) {
    assert.equal(match.apple.transactionId, 'tx-100');
    assert.equal(match.apple.originalTransactionId, 'orig-1');
  }

  const mismatchOrig = checkClientPurchaseIdsAgainstApple(
    { transactionId: 'tx-100', productId: 'flyfam.monthly', originalTransactionId: 'evil' },
    apple,
  );
  assert.equal(mismatchOrig.ok, false);

  const mismatchTx = checkClientPurchaseIdsAgainstApple(
    { transactionId: 'tx-evil', productId: 'flyfam.monthly' },
    apple,
  );
  assert.equal(mismatchTx.ok, false);

  const mismatchProduct = checkClientPurchaseIdsAgainstApple(
    { transactionId: 'tx-100', productId: 'other.product' },
    apple,
  );
  assert.equal(mismatchProduct.ok, false);

  // Client may send original as transactionId (StoreKit quirk) — still OK.
  const origAsTx = checkClientPurchaseIdsAgainstApple(
    { transactionId: 'orig-1', productId: 'flyfam.monthly' },
    apple,
  );
  assert.equal(origAsTx.ok, true);
  if (origAsTx.ok) {
    // Authoritative ids remain Apple's.
    assert.equal(origAsTx.apple.transactionId, 'tx-100');
  }

  // Replay / other-user ownership
  assert.equal(originalTxBelongsToOtherUser(null, 'user-a'), false);
  assert.equal(originalTxBelongsToOtherUser('user-a', 'user-a'), false);
  assert.equal(originalTxBelongsToOtherUser('user-a', 'user-b'), true);

  // Migration must contain exclusive original_tx guard + advisory lock successor.
  const mig = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20261102121000_store_purchase_original_tx_owner_guard.sql'),
    'utf8',
  );
  assert.ok(mig.includes('Store original transaction already belongs to another user'));
  assert.ok(mig.includes('on conflict (platform, transaction_id) do nothing'));

  const lockMig = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../supabase/migrations/20261103120000_store_purchase_original_tx_advisory_lock.sql',
    ),
    'utf8',
  );
  assert.ok(lockMig.includes('pg_advisory_xact_lock'));

  // verify-store-purchase must wire the shared checker / Apple authority.
  const verifySrc = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/functions/verify-store-purchase/index.ts'),
    'utf8',
  );
  assert.ok(verifySrc.includes('checkClientPurchaseIdsAgainstApple'));
  assert.ok(verifySrc.includes('p_original_transaction_id: appleOriginalTx'));
  assert.ok(verifySrc.includes('p_transaction_id: appleTxId'));
  assert.ok(verifySrc.includes('p_product_id: appleProductId'));

  console.log('apple purchase identity tests: PASS');
}

run();
