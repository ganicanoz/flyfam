/**
 * Offline: eski iniş → aile landed push yok.
 * Run: cd mobile && npx tsx scripts/test-landed-family-push-freshness.ts
 */
import assert from 'node:assert/strict';
import {
  isLandedEventFreshForFamilyPush,
  LANDED_FAMILY_PUSH_MAX_AGE_MS,
} from '../../supabase/functions/_shared/landedFamilyPushFreshness';

const now = Date.parse('2026-10-25T19:25:00.000Z');

assert.equal(
  isLandedEventFreshForFamilyPush({
    fr24LandedUtc: '2026-10-25T03:33:08.000Z',
    nowMs: now,
  }),
  false,
  'PC583 morning land must not notify at night',
);

assert.equal(
  isLandedEventFreshForFamilyPush({
    fr24LandedUtc: '2026-10-24T22:26:04.000Z',
    nowMs: now,
  }),
  false,
  'PC582 previous-day land must not notify',
);

assert.equal(
  isLandedEventFreshForFamilyPush({
    fr24LandedUtc: '2026-10-25T18:00:00.000Z',
    nowMs: now,
  }),
  true,
  'landing 85 min ago is fresh',
);

assert.equal(
  isLandedEventFreshForFamilyPush({
    fr24LandedUtc: new Date(now - LANDED_FAMILY_PUSH_MAX_AGE_MS - 60_000).toISOString(),
    nowMs: now,
  }),
  false,
);

assert.equal(
  isLandedEventFreshForFamilyPush({
    actualArrivalUtc: '2026-10-25T19:00:00.000Z',
    nowMs: now,
  }),
  true,
);

assert.equal(
  isLandedEventFreshForFamilyPush({
    scheduledArrivalUtc: '2026-10-24T22:29:00.000Z',
    nowMs: now,
  }),
  false,
  'STA-only old fallback suppresses',
);

assert.equal(isLandedEventFreshForFamilyPush({ nowMs: now }), false);

console.log('landed family push freshness: OK');
