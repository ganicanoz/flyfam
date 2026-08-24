/**
 * flight-lookup'un yazdığı roster poll payload'ından DB patch — check-flight semi_active ile uyumlu.
 */
export function semiActivePatchFromCachedRosterPoll(cached: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof cached.scheduled_departure_utc === 'string' && cached.scheduled_departure_utc.trim()) {
    patch.scheduled_departure = cached.scheduled_departure_utc;
  }
  if (typeof cached.scheduled_arrival_utc === 'string' && cached.scheduled_arrival_utc.trim()) {
    patch.scheduled_arrival = cached.scheduled_arrival_utc;
  }
  if (cached.delayDepMin != null) patch.delay_dep_min = cached.delayDepMin;
  if (cached.delayArrMin != null) patch.delay_arr_min = cached.delayArrMin;
  if (cached.airlabsProgressPercent != null) patch.airlabs_progress_percent = cached.airlabsProgressPercent;
  if (cached.fr24_progress_dep_utc != null) patch.fr24_progress_dep_utc = cached.fr24_progress_dep_utc;
  if (cached.fr24_progress_eta_utc != null) patch.fr24_progress_eta_utc = cached.fr24_progress_eta_utc;
  if (cached.fr24_datetime_landed_utc != null) patch.fr24_datetime_landed_utc = cached.fr24_datetime_landed_utc;
  const reg =
    typeof cached.aircraftRegistration === 'string' && cached.aircraftRegistration.trim()
      ? cached.aircraftRegistration.trim().toUpperCase()
      : null;
  if (reg) patch.aircraft_registration = reg;
  return patch;
}
