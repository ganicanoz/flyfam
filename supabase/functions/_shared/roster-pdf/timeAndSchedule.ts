/**
 * Takvim, TR duvar saati, IANA TZ ile UTC — tüm airline modülleri için ortak.
 */

import type { PdfFlightRow, RowScheduleZones } from './types.ts';

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(h)) return NaN;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

/** PDF görev / dinlenme sonu: Türkiye duvar saati → UTC ISO (DST yok, +3). */
export function trLocalDateTimeToUtcIso(dateYmd: string, hhmm: string, addDays = 0): string | null {
  const [yy, mo, dd] = dateYmd.split('-').map(Number);
  const [hs, ms] = hhmm.split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(yy) || !Number.isFinite(hs)) return null;
  const m = Number.isFinite(ms) ? ms : 0;
  const base = Date.UTC(yy, (mo || 1) - 1, (dd || 1) + addDays, hs, m, 0, 0);
  const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
  return new Date(base - TR_OFFSET_MS).toISOString();
}

/** IATA için timezone yoksa (DB’de eksik) uçuş yerelleri için yedek. */
export const ROSTER_FALLBACK_TIMEZONE = 'Europe/Istanbul';

/** `flight_date` üzerinden takvim günü kaydırma (UTC takvimi; roster günü ile uyumlu). */
export function addCalendarDays(dateYmd: string, deltaDays: number): string {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const u = Date.UTC(y, (mo || 1) - 1, (d || 1) + deltaDays);
  return new Date(u).toISOString().slice(0, 10);
}

/**
 * Pegasus ikinci slash = resting end.
 * 00:00–03:59 bitiş bir önceki takvim gününün görevini kapatır (layover dönüş günü o gün değil).
 */
export function restEndOperatingYmd(restYmd: string | null | undefined, restHhmm: string | null | undefined): string | null {
  const ymd = restYmd?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const clock = timeToMinutes(restHhmm ?? '');
  if (Number.isFinite(clock) && clock < 4 * 60) return addCalendarDays(ymd, -1);
  return ymd;
}

function getCalendarPartsInTimeZone(
  utcMs: number,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  return {
    year: parseInt(m.year || '0', 10),
    month: parseInt(m.month || '0', 10),
    day: parseInt(m.day || '0', 10),
    hour: parseInt(m.hour || '0', 10),
    minute: parseInt(m.minute || '0', 10),
  };
}

/** UTC anını verilen IANA bölgesindeki takvim günü `YYYY-MM-DD` olarak döndürür. */
export function utcIsoToLocalYmd(utcIso: string, timeZone: string): string | null {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return null;
  const tz = (timeZone && timeZone.trim()) || ROSTER_FALLBACK_TIMEZONE;
  const p = getCalendarPartsInTimeZone(ms, tz);
  if (!p.year || !p.month || !p.day) return null;
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Belirtilen IANA bölgesindeki takvim günü + HH:MM → UTC ISO.
 * ±72 saat pencerede dakika tarama (DST köşeleri için yeterli; performans: ~8k adım).
 */
export function localDateTimeInTimezoneToUtcIso(
  dateYmd: string,
  hhmm: string,
  timeZone: string | null | undefined,
  addDays = 0
): string | null {
  const tz = (timeZone && timeZone.trim()) || ROSTER_FALLBACK_TIMEZONE;
  const ymd = addDays !== 0 ? addCalendarDays(dateYmd, addDays) : dateYmd;
  const [yy, mo, dd] = ymd.split('-').map(Number);
  const [hs, ms] = hhmm.split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(yy) || !Number.isFinite(hs)) return null;
  const minute = Number.isFinite(ms) ? ms : 0;
  const target = { year: yy, month: mo || 1, day: dd || 1, hour: hs, minute };

  const center = Date.UTC(yy, (mo || 1) - 1, (dd || 1), 12, 0, 0);
  const start = center - 72 * 3600 * 1000;
  const end = center + 72 * 3600 * 1000;

  for (let utcMs = start; utcMs <= end; utcMs += 60 * 1000) {
    const p = getCalendarPartsInTimeZone(utcMs, tz);
    if (
      p.year === target.year &&
      p.month === target.month &&
      p.day === target.day &&
      p.hour === target.hour &&
      p.minute === target.minute
    ) {
      return new Date(utcMs).toISOString();
    }
  }
  return null;
}

/**
 * Yerel kalkış/iniş → UTC: kalkış **origin** TZ, iniş **destination** TZ (yoksa Istanbul).
 * `zones` verilmezse her iki bacak için `ROSTER_FALLBACK_TIMEZONE` (eski tek-Türkiye davranışı).
 */
export function rowToScheduleIso(
  row: PdfFlightRow,
  zones?: RowScheduleZones | null
): {
  depIso: string | null;
  arrIso: string | null;
} {
  const { dep_time_local: dep, arr_time_local: arr, flight_date: d0 } = row;
  if (!dep) return { depIso: null, arrIso: null };
  let arrDayOffset = 0;
  if (arr) {
    const dm = timeToMinutes(dep);
    const am = timeToMinutes(arr);
    if (Number.isFinite(dm) && Number.isFinite(am) && am < dm) arrDayOffset = 1;
  }
  const originTz = zones?.originTz?.trim() || ROSTER_FALLBACK_TIMEZONE;
  const destTz = zones?.destTz?.trim() || ROSTER_FALLBACK_TIMEZONE;
  const arrYmd = arrDayOffset > 0 ? addCalendarDays(d0, arrDayOffset) : d0;
  const depIso = localDateTimeInTimezoneToUtcIso(d0, dep, originTz, 0);
  const arrIso = arr ? localDateTimeInTimezoneToUtcIso(arrYmd, arr, destTz, 0) : null;
  return { depIso, arrIso };
}

function normalizeHhmmForUtc(hhmm: string): string | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

function utcIsoFromYmdAndHhmm(dateYmd: string, hhmm: string): string | null {
  const hm = normalizeHhmmForUtc(hhmm);
  if (!hm) return null;
  const [yy, mo, dd] = dateYmd.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(yy) || !Number.isFinite(mo) || !Number.isFinite(dd)) return null;
  const [hs, ms] = hm.split(':').map((x) => parseInt(x, 10));
  return new Date(Date.UTC(yy, mo - 1, dd, hs, ms, 0, 0)).toISOString();
}

/**
 * Pegasus crew PDF: tablo saatleri `(Z)` ile işaretliyse değerler UTC’dir (THY GMT yolu ile aynı RPC akışı).
 * `flight_date` = görev satırındaki roster günü; varış yerel geceyi UTC’de aşarsa iniş tarihi +1 gün.
 */
export function pegasusUtcSchedulePairFromFlightDate(
  flightDateYmd: string,
  depHhmm: string,
  arrHhmm: string
): { dep_schedule_utc_iso: string; arr_schedule_utc_iso: string } | null {
  const dep = normalizeHhmmForUtc(depHhmm);
  const arr = normalizeHhmmForUtc(arrHhmm);
  if (!dep || !arr) return null;
  const dm = timeToMinutes(dep);
  const am = timeToMinutes(arr);
  let arrDayOffset = 0;
  if (Number.isFinite(dm) && Number.isFinite(am) && am < dm) arrDayOffset = 1;
  const arrYmd = arrDayOffset > 0 ? addCalendarDays(flightDateYmd, arrDayOffset) : flightDateYmd;
  const depIso = utcIsoFromYmdAndHhmm(flightDateYmd, dep);
  const arrIso = utcIsoFromYmdAndHhmm(arrYmd, arr);
  if (!depIso || !arrIso) return null;
  return { dep_schedule_utc_iso: depIso, arr_schedule_utc_iso: arrIso };
}
