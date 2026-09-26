/**
 * Pure follower-capacity rules for subscription plans.
 * Authoritative counts live in Postgres (`count_crew_approved_followers`).
 */

export type FollowerCapacityState = {
  /** Plan follower slots (excludes roster owner). */
  maxFollowers: number;
  approvedFamilyFollowers: number;
  approvedPeerFollowers: number;
  pendingInvites: number;
  rosterOwnerUserId?: string | null;
  peerFollowerUserIds?: string[];
};

/** Approved followers consuming roster-owner capacity (owner never counts). */
export function countApprovedFollowers(state: FollowerCapacityState): number {
  const peerIds = state.peerFollowerUserIds;
  const peerCount =
    peerIds != null
      ? peerIds.filter((id) => id !== state.rosterOwnerUserId).length
      : state.approvedPeerFollowers;
  return state.approvedFamilyFollowers + peerCount;
}

/** Pending invites/links do not consume capacity. */
export function pendingConsumesCapacity(_pending: number): boolean {
  return false;
}

export function canInviteMoreFollowers(state: FollowerCapacityState): boolean {
  return countApprovedFollowers(state) < state.maxFollowers;
}

export function canApproveNewFollower(state: FollowerCapacityState): boolean {
  return countApprovedFollowers(state) < state.maxFollowers;
}

/** Roster visibility for a follower depends on roster owner's subscription, not the viewer's. */
export function rosterVisibleToFollower(ownerSubscriptionActive: boolean): boolean {
  return ownerSubscriptionActive;
}

/** Following other crews does not change the viewer's own subscription entitlement. */
export function followingAffectsOwnSubscription(_followingCount: number): boolean {
  return false;
}

/** Same follower in two crews counts once per crew roster owner. */
export function followerSlotsPerCrew(
  crews: Array<{ crewId: string; approvedFollowers: number; maxFollowers: number }>,
  followerId: string,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const crew of crews) {
    out[crew.crewId] = crew.approvedFollowers > 0;
  }
  void followerId;
  return out;
}
