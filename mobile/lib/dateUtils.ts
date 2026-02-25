/**
 * Flight times are stored and received from APIs in UTC (ISO with Z or offset).
 * If the string has no timezone (e.g. "2025-02-14T10:00:00"), JS would parse it as local time.
 * We always treat such values as UTC so display and logic are correct.
 */

/** Today's date in the user's local timezone as YYYY-MM-DD (not UTC). */
export function getLocalDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Tomorrow's date in the user's local timezone as YYYY-MM-DD (not UTC). */
export function getLocalDateStringTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date in the user's local timezone offset by N days, as YYYY-MM-DD (not UTC). */
export function getLocalDateStringPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + (Number.isFinite(days) ? days : 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Normalize ISO string to end with Z when no offset, then parse. Returns null if invalid. */
export function parseFlightTimeAsUtc(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  let s = iso.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? s + ':00.000Z' : s + 'Z';
  }
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format flight time in device local time (for lists/dashboards). */
export function formatFlightTimeLocal(iso: string | null | undefined): string {
  const d = parseFlightTimeAsUtc(iso);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** Format flight time in UTC. */
export function formatFlightTimeUTC(iso: string | null | undefined): string {
  const d = parseFlightTimeAsUtc(iso);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—';
}

/** Format flight time in a specific IANA timezone (e.g. Europe/Istanbul). */
export function formatFlightTimeInTz(iso: string | null | undefined, tz: string | null): string {
  const d = parseFlightTimeAsUtc(iso);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz ?? 'UTC' }) : '—';
}

/** Get UTC HH:MM from stored flight datetime (for edit form). */
export function flightTimeToUtcHHMM(iso: string | null | undefined): string {
  const d = parseFlightTimeAsUtc(iso);
  if (!d) return '';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
