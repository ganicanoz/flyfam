/**
 * original_transaction_id sahiplik yarışı + advisory lock semantiği.
 * Çalıştır: npx tsx mobile/scripts/test-store-original-tx-advisory-lock.ts
 *
 * Canlı Postgres olmadan: (1) migration kilidi doğrulanır,
 * (2) eşzamanlı iki kullanıcı senaryosu mutex modeli ile simüle edilir.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type Receipt = {
  userId: string;
  platform: string;
  transactionId: string;
  originalTransactionId: string;
};

type ClaimResult = { ok: true } | { ok: false; error: string };

class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(
      key,
      prev.then(() => gate).catch(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function findOrigOwner(store: Receipt[], platform: string, orig: string): string | undefined {
  return store.find(
    (r) =>
      r.platform === platform &&
      (r.originalTransactionId === orig || r.transactionId === orig),
  )?.userId;
}

/** Check-then-insert WITHOUT lock — demonstrates the race. */
async function claimWithoutLock(
  store: Receipt[],
  claim: Receipt,
  barrier: { arrive: () => Promise<void> },
): Promise<ClaimResult> {
  const owner = findOrigOwner(store, claim.platform, claim.originalTransactionId);
  await barrier.arrive();
  if (owner && owner !== claim.userId) {
    return { ok: false, error: 'Store original transaction already belongs to another user' };
  }
  store.push(claim);
  return { ok: true };
}

/** Ownership rules WITH a per-(platform,orig) mutex (pg_advisory_xact_lock model). */
async function claimWithAdvisoryLock(
  store: Receipt[],
  mutex: KeyedMutex,
  claim: Receipt,
): Promise<ClaimResult> {
  const key = `${claim.platform}|${claim.originalTransactionId}`;
  return mutex.runExclusive(key, () => {
    const owner = findOrigOwner(store, claim.platform, claim.originalTransactionId);
    if (owner && owner !== claim.userId) {
      return { ok: false, error: 'Store original transaction already belongs to another user' };
    }
    if (!store.some((r) => r.platform === claim.platform && r.transactionId === claim.transactionId)) {
      store.push(claim);
    }
    return { ok: true };
  });
}

function runMigrationAssertions() {
  const mig = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../supabase/migrations/20261103120000_store_purchase_original_tx_advisory_lock.sql',
    ),
    'utf8',
  );
  assert.ok(mig.includes('pg_advisory_xact_lock'));
  assert.ok(mig.includes("hashtext('flyfam.store_orig:' || v_platform)"));
  assert.ok(mig.includes('hashtext(v_orig)'));
  assert.ok(mig.includes('Store original transaction already belongs to another user'));
  const lockIdx = mig.indexOf('pg_advisory_xact_lock');
  const ownerIdx = mig.indexOf('select r.user_id into v_orig_owner');
  assert.ok(lockIdx >= 0 && ownerIdx > lockIdx, 'advisory lock must precede owner check');
}

function makeBarrier(n: number) {
  let count = 0;
  let release!: () => void;
  const opened = new Promise<void>((r) => {
    release = r;
  });
  return {
    arrive: async () => {
      count += 1;
      if (count >= n) release();
      await opened;
    },
  };
}

async function runConcurrentTwoUserRace() {
  // Without lock: both can succeed (race).
  {
    const store: Receipt[] = [];
    const barrier = makeBarrier(2);
    const [a, b] = await Promise.all([
      claimWithoutLock(
        store,
        {
          userId: 'user-a',
          platform: 'ios',
          transactionId: 'tx-a1',
          originalTransactionId: 'orig-shared',
        },
        barrier,
      ),
      claimWithoutLock(
        store,
        {
          userId: 'user-b',
          platform: 'ios',
          transactionId: 'tx-b1',
          originalTransactionId: 'orig-shared',
        },
        barrier,
      ),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(store.length, 2, 'race allows both users without lock');
  }

  // With advisory lock: exactly one user owns the original; the other is rejected.
  {
    const store: Receipt[] = [];
    const mutex = new KeyedMutex();
    const results = await Promise.all([
      claimWithAdvisoryLock(store, mutex, {
        userId: 'user-a',
        platform: 'ios',
        transactionId: 'tx-a1',
        originalTransactionId: 'orig-shared',
      }),
      claimWithAdvisoryLock(store, mutex, {
        userId: 'user-b',
        platform: 'ios',
        transactionId: 'tx-b1',
        originalTransactionId: 'orig-shared',
      }),
    ]);

    const oks = results.filter((r) => r.ok).length;
    const fails = results.filter((r) => !r.ok).length;
    assert.equal(oks, 1, 'exactly one concurrent claim succeeds');
    assert.equal(fails, 1, 'other user is rejected');
    assert.equal(store.length, 1);
    assert.equal(store[0]?.originalTransactionId, 'orig-shared');

    const winner = store[0]!.userId;
    const loser = winner === 'user-a' ? 'user-b' : 'user-a';
    const retry = await claimWithAdvisoryLock(store, mutex, {
      userId: loser,
      platform: 'ios',
      transactionId: 'tx-loser-2',
      originalTransactionId: 'orig-shared',
    });
    assert.equal(retry.ok, false);

    // Same-user renewal with a new Apple transaction_id is allowed.
    const renew = await claimWithAdvisoryLock(store, mutex, {
      userId: winner,
      platform: 'ios',
      transactionId: 'tx-renew-2',
      originalTransactionId: 'orig-shared',
    });
    assert.equal(renew.ok, true);
    assert.equal(store.length, 2);
    assert.ok(store.every((r) => r.userId === winner));
  }
}

async function main() {
  runMigrationAssertions();
  await runConcurrentTwoUserRace();
  console.log('store original_tx advisory lock tests: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
