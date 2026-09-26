/**
 * flight-lookup'un yazdığı roster poll payload'ından DB patch — check-flight semi_active ile uyumlu.
 * Roster STD/STA source of truth: provider times only fill estimated_* when within ±12h of roster.
 */

function toUtcMs(iso: unknown): number {
  if (typeof iso !== 'string' || !iso.trim()) return NaN;
  const ms = Date.parse(iso.trim());
  return Number.isFinite(ms) ? ms : NaN;
}

function withinHours(a: unknown, b: unknown, maxHours: number): boolean {
  const am = toUtcMs(a);
  const bm = toUtcMs(b);
  if (!Number.isFinite(am) || !Number.isFinite(bm)) return false;
  return Math.abs(am - bm) <= maxHours * 60 * 60 * 1000;
}

export function semiActivePatchFromCachedRosterPoll(
  cached: Record<string, unknown>,
  existing?: {
    scheduled_departure?: string | null;
    scheduled_arrival?: string | null;
  },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const std = existing?.scheduled_departure ?? null;
  const sta = existing?.scheduled_arrival ?? null;

  // Never clobber roster STD/STA with previous-day provider times.
  if (
    typeof cached.scheduled_departure_utc === 'string' &&
    cached.scheduled_departure_utc.trim() &&
    (!std || withinHours(cached.scheduled_departure_utc, std, 12))
  ) {
    patch.estimated_departure = cached.scheduled_departure_utc;
  }
  if (
    typeof cached.scheduled_arrival_utc === 'string' &&
    cached.scheduled_arrival_utc.trim() &&
    (!sta || withinHours(cached.scheduled_arrival_utc, sta, 12))
  ) {
    patch.estimated_arrival = cached.scheduled_arrival_utc;
  }
  if (cached.delayDepMin != null) patch.delay_dep_min = cached.delayDepMin;
  if (cached.delayArrMin != null) patch.delay_arr_min = cached.delayArrMin;
  if (cached.airlabsProgressPercent != null) patch.airlabs_progress_percent = cached.airlabsProgressPercent;
  if (
    cached.fr24_progress_dep_utc != null &&
    (!std || withinHours(cached.fr24_progress_dep_utc, std, 12))
  ) {
    patch.fr24_progress_dep_utc = cached.fr24_progress_dep_utc;
  }
  if (
    cached.fr24_progress_eta_utc != null &&
    (!sta || withinHours(cached.fr24_progress_eta_utc, sta, 18))
  ) {
    patch.fr24_progress_eta_utc = cached.fr24_progress_eta_utc;
  }
  if (
    cached.fr24_datetime_landed_utc != null &&
    (!sta || withinHours(cached.fr24_datetime_landed_utc, sta, 18)) &&
    (!std || withinHours(cached.fr24_datetime_landed_utc, std, 18))
  ) {
    patch.fr24_datetime_landed_utc = cached.fr24_datetime_landed_utc;
  }
  const reg =
    typeof cached.aircraftRegistration === 'string' && cached.aircraftRegistration.trim()
      ? cached.aircraftRegistration.trim().toUpperCase()
      : null;
  if (reg) patch.aircraft_registration = reg;
  const typ =
    typeof cached.aircraftType === 'string' && cached.aircraftType.trim()
      ? cached.aircraftType.trim().toUpperCase()
      : typeof cached.aircraft_type === 'string' && cached.aircraft_type.trim()
        ? cached.aircraft_type.trim().toUpperCase()
        : null;
  if (typ) patch.aircraft_type = typ;
  return patch;
}
