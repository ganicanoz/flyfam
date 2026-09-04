/**
 * Relative “updated X ago” for roster sync meta.
 */
export function formatRelativeSyncedAt(
  syncedAtMs: number | null,
  nowMs: number,
  t: (key: string, opts?: Record<string, string | number>) => string,
): string {
  if (syncedAtMs == null || !Number.isFinite(syncedAtMs)) {
    return t('nav.lastUpdatedPending');
  }
  const diffSec = Math.max(0, Math.floor((nowMs - syncedAtMs) / 1000));
  if (diffSec < 45) return t('nav.lastUpdatedJustNow');
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return t('nav.lastUpdatedMinutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('nav.lastUpdatedHoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('nav.lastUpdatedDaysAgo', { count: days });
}
