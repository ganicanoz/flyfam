/**
 * Validates follower/subscription capacity scenarios (no DB).
 * Run: npx tsx scripts/test-follower-capacity.ts
 */
import assert from 'node:assert/strict';
import {
  canApproveNewFollower,
  canInviteMoreFollowers,
  countApprovedFollowers,
  followingAffectsOwnSubscription,
  pendingConsumesCapacity,
  rosterVisibleToFollower,
  type FollowerCapacityState,
} from '../lib/followerCapacity';

function state(partial: Partial<FollowerCapacityState> & Pick<FollowerCapacityState, 'maxFollowers'>): FollowerCapacityState {
  return {
    approvedFamilyFollowers: 0,
    approvedPeerFollowers: 0,
    pendingInvites: 0,
    ...partial,
  };
}

function run(): void {
  // 1–2: Family follows two crews; each crew counts the follower separately.
  const crewA = state({ maxFollowers: 3, approvedFamilyFollowers: 1 });
  const crewB = state({ maxFollowers: 2, approvedFamilyFollowers: 1 });
  assert.equal(countApprovedFollowers(crewA), 1);
  assert.equal(countApprovedFollowers(crewB), 1);

  // 3–5: Crew peer follow uses peer roster owner's capacity; mutual needs two entitlements.
  const crewBOwner = state({ maxFollowers: 1, approvedPeerFollowers: 1, rosterOwnerUserId: 'owner-b' });
  assert.equal(countApprovedFollowers(crewBOwner), 1);
  assert.equal(canApproveNewFollower(crewBOwner), false);
  const crewAOwner = state({ maxFollowers: 1, approvedPeerFollowers: 0 });
  assert.equal(canApproveNewFollower(crewAOwner), true);

  // 4: One-way follow — only roster-sharing crew needs subscription for visibility.
  assert.equal(rosterVisibleToFollower(true), true);
  assert.equal(rosterVisibleToFollower(false), false);

  // 6: Following does not change own subscription.
  assert.equal(followingAffectsOwnSubscription(3), false);

  // 7: Pending does not consume capacity.
  assert.equal(pendingConsumesCapacity(5), false);
  const withPending = state({ maxFollowers: 1, approvedFamilyFollowers: 0, pendingInvites: 3 });
  assert.equal(canInviteMoreFollowers(withPending), true);

  // 8: Full capacity blocks new approval.
  const full = state({ maxFollowers: 2, approvedFamilyFollowers: 1, approvedPeerFollowers: 1 });
  assert.equal(canApproveNewFollower(full), false);
  assert.equal(canInviteMoreFollowers(full), false);

  // 9–10: Lapsed owner hides roster; restore reopens with same links (visibility flag only).
  assert.equal(rosterVisibleToFollower(false), false);
  assert.equal(rosterVisibleToFollower(true), true);

  console.log('test-follower-capacity: all scenarios passed');
}

run();
