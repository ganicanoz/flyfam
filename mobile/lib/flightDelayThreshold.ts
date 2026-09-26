/** Planlı varıştan bu kadar dk ve sonrası iniş = gecikme. 1–14 dk normal sayılır. */
export const ARRIVAL_LATE_THRESHOLD_MIN = 15;

/**
 * Pozitif (geç) sapmayı yalnızca eşik ve üzerinde gecikme sayar.
 * Erken (negatif) sapma aynen korunur; 0 / NaN → null.
 */
export function significantArrivalSkewMins(mins: number | null | undefined): number | null {
  if (mins == null || !Number.isFinite(mins)) return null;
  const m = Math.round(mins);
  if (m === 0) return null;
  if (m > 0 && m < ARRIVAL_LATE_THRESHOLD_MIN) return null;
  return m;
}
