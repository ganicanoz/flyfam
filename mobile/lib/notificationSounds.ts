/**
 * Family push sound / Android channel mapping + notification artwork.
 * Sound files live in `assets/sounds/` and native bundles.
 * Channel IDs `_v2` must stay stable (Android locks channel sound on first create).
 */
export type FamilyPushSoundKind = 'took_off' | 'landed' | 'roster_share' | 'default';

export type FamilyPushArtworkKind = 'takeoff' | 'landing' | 'roster' | null;

export const FAMILY_PUSH_SOUND = {
  took_off: {
    channelId: 'flyfam_took_off_v2',
    channelName: 'Kalkış',
    soundFile: 'flyfam_took_off.wav',
    /** Android status-bar small icon (white silhouette drawable name). */
    androidIcon: 'notification_icon_takeoff',
    artwork: 'takeoff' as FamilyPushArtworkKind,
  },
  landed: {
    channelId: 'flyfam_landed_v2',
    channelName: 'İniş',
    soundFile: 'flyfam_landed.wav',
    androidIcon: 'notification_icon_landed',
    artwork: 'landing' as FamilyPushArtworkKind,
  },
  roster_share: {
    channelId: 'flyfam_roster_share_v2',
    channelName: 'Roster paylaşımı',
    soundFile: 'flyfam_roster_share.wav',
    androidIcon: 'notification_icon_roster',
    artwork: 'roster' as FamilyPushArtworkKind,
  },
  default: {
    channelId: 'default',
    channelName: 'FlyFam',
    soundFile: 'default' as const,
    androidIcon: 'notification_icon',
    artwork: null as FamilyPushArtworkKind,
  },
} as const;

/** Optimized public filenames under Supabase Storage bucket `notification-artwork`. */
export const FAMILY_PUSH_ARTWORK_FILE: Record<Exclude<FamilyPushArtworkKind, null>, string> = {
  takeoff: 'flyfam-takeoff-v3-push.jpg',
  landing: 'flyfam-landing-v3-push.jpg',
  roster: 'flyfam-roster-v3-push.jpg',
};

export function familyPushSoundKindFromType(
  type: string | null | undefined,
  opts?: { manualShare?: boolean },
): FamilyPushSoundKind {
  if (type === 'took_off') return 'took_off';
  if (type === 'landed') return 'landed';
  if (type === 'today_flights' && opts?.manualShare) return 'roster_share';
  return 'default';
}
