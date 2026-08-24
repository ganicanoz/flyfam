/** flight-lookup ile birebir aynı — cron cache paylaşımı için tek kaynak. */

export type RosterPollCachePhase = 'semi_active' | 'active';

export function rosterPollCacheKey(
  phase: RosterPollCachePhase,
  flightNumber: string,
  flightDate: string,
): string {
  const n = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  return `roster_poll:v2:${phase}:${n}:${flightDate}`;
}
