/** Public notification artwork files (optimized) in Storage bucket `notification-artwork`. */
export const NOTIFICATION_ARTWORK_BUCKET = 'notification-artwork';

export type NotificationArtworkKind = 'takeoff' | 'landing' | 'roster';

export const NOTIFICATION_ARTWORK_FILE: Record<NotificationArtworkKind, string> = {
  takeoff: 'flyfam-takeoff-v3-push.jpg',
  landing: 'flyfam-landing-v3-push.jpg',
  roster: 'flyfam-roster-v3-push.jpg',
};

/** Android monochrome status-bar icons (drawable resource names). */
export const NOTIFICATION_ANDROID_ICON: Record<NotificationArtworkKind | 'default', string> = {
  takeoff: 'notification_icon_takeoff',
  landing: 'notification_icon_landed',
  roster: 'notification_icon_roster',
  default: 'notification_icon',
};

export function artworkKindForPushType(
  type: string,
  opts?: { manualShare?: boolean },
): NotificationArtworkKind | null {
  if (type === 'took_off') return 'takeoff';
  if (type === 'landed') return 'landing';
  if (type === 'today_flights' && opts?.manualShare) return 'roster';
  return null;
}

/** Build public HTTPS URL for artwork; returns null if base URL missing. */
export function publicNotificationArtworkUrl(
  supabaseUrl: string | null | undefined,
  kind: NotificationArtworkKind,
): string | null {
  const base = String(supabaseUrl ?? '').replace(/\/$/, '');
  if (!base) return null;
  const file = NOTIFICATION_ARTWORK_FILE[kind];
  return `${base}/storage/v1/object/public/${NOTIFICATION_ARTWORK_BUCKET}/${file}`;
}
