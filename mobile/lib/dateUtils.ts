/**
 * Flight times are stored and received from APIs in UTC (ISO with Z or offset).
 * If the string has no timezone (e.g. "2025-02-14T10:00:00"), JS would parse it as local time.
 * We always treat such values as UTC so display and logic are correct.
 */

import i18n from './i18n';

/** Today's calendar date in UTC as YYYY-MM-DD (operations / flight_date grouping). */
export function getUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** UTC calendar date offset by N days, as YYYY-MM-DD. */
export function getUtcDateStringPlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + (Number.isFinite(days) ? days : 0));
  return d.toISOString().slice(0, 10);
}

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

/** Cihaz yerel takviminde bugün veya yarın mı? (manuel uçuş + AirLabs en yakın bacak.) */
export function isLocalTodayOrTomorrow(dateIso: string): boolean {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  return dateIso === getLocalDateString() || dateIso === getLocalDateStringTomorrow();
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

/**
 * Cihazın IANA timezone’u (örn. Europe/Istanbul) — yalnızca işletim sistemi / takvim ayarı.
 * Önce `expo-localization` (`getCalendars`), yoksa `Intl`; GPS veya konum izni kullanılmaz.
 */
export function getDeviceIanaTimeZone(): string {
  try {
    // Üst seviye import yok: Node/tsx scriptleri `expo-localization` native modülünü yüklemesin.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCalendars } = require('expo-localization') as typeof import('expo-localization');
    const cals = getCalendars();
    const tz0 = cals[0]?.timeZone;
    if (typeof tz0 === 'string' && tz0.length > 0) return tz0;
  } catch {
    // expo-localization yok / Node / web sınırı
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
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

/** UTC takvim günü YYYY-MM-DD (roster crew UTC görünümü gruplama). */
export function utcCalendarDateFromIso(iso: string | null | undefined): string | null {
  const d = parseFlightTimeAsUtc(iso);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD etiketini UTC ızgarasında formatla (gün sınırı cihaz TZ’sinden bağımsız).
 * Roster UTC görünümünde gün ayırıcı ve kart tarihi için kullanılır.
 */
export function formatUtcCalendarDateLabel(dateYmd: string | null | undefined): string {
  if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return '—';
  const date = new Date(dateYmd + 'T12:00:00Z');
  if (Number.isNaN(date.getTime())) return '—';
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
  const weekday = date.toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
  const dayMonth = date.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${dayMonth} - ${weekday}`;
}

/** Verilen anın IANA TZ’deki takvim günü YYYY-MM-DD (aile roster gruplama / şerit). */
export function getCalendarDateStringInTimeZone(at: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
    let y = '';
    let m = '';
    let d = '';
    for (const p of parts) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value.padStart(2, '0');
      if (p.type === 'day') d = p.value.padStart(2, '0');
    }
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* ignore */
  }
  return getLocalDateString();
}

/** Civil YYYY-MM-DD üzerinde Gregoryen gün ekle (etiket / şerit aralığı). */
export function addCalendarDaysToYmd(ymd: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, mo, da] = ymd.split('-').map((x) => parseInt(x, 10));
  const ms = Date.UTC(y, mo - 1, da + deltaDays);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Planlı kalkış/varış anının aile üyesi TZ’sindeki takvim günü. */
export function calendarDateFromUtcIsoInTimeZone(iso: string | null | undefined, tz: string): string | null {
  const d = parseFlightTimeAsUtc(iso);
  if (!d) return null;
  try {
    return getCalendarDateStringInTimeZone(d, tz);
  } catch {
    return null;
  }
}

/**
 * TZ’de ymd ile eşleşen bir UTC anı (gün başlığı / chip kısa tarih için).
 * DST sınırında saat taraması ile yaklaşılır.
 */
export function utcInstantForCalendarYmdInTimeZone(ymd: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [Y, M, D] = ymd.split('-').map((x) => parseInt(x, 10));
  let t = Date.UTC(Y, M - 1, D, 12, 0, 0);
  for (let i = 0; i < 96; i++) {
    if (getCalendarDateStringInTimeZone(new Date(t), tz) === ymd) return new Date(t);
    t += 3600000;
  }
  t = Date.UTC(Y, M - 1, D, 12, 0, 0);
  for (let i = 0; i < 96; i++) {
    if (getCalendarDateStringInTimeZone(new Date(t), tz) === ymd) return new Date(t);
    t -= 3600000;
  }
  return new Date(Date.UTC(Y, M - 1, D, 12, 0, 0));
}

/** Aile roster: TZ’deki gün etiketi (hafta günü + ay). */
export function formatFlightDateYmdInIanaTz(dateYmd: string | null | undefined, tz: string): string {
  if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return '—';
  const rep = utcInstantForCalendarYmdInTimeZone(dateYmd, tz);
  if (!rep) return '—';
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
  const weekday = rep.toLocaleDateString(locale, { weekday: 'long', timeZone: tz });
  const dayMonth = rep.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: tz });
  return `${dayMonth} - ${weekday}`;
}

/** Format flight time in a specific IANA timezone (e.g. Europe/Istanbul). */
export function formatFlightTimeInTz(iso: string | null | undefined, tz: string | null): string {
  const d = parseFlightTimeAsUtc(iso);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz ?? 'UTC' }) : '—';
}

/**
 * Yerel takvim günü olarak yorumlanan YYYY-MM-DD için hafta günü (uzun).
 * Manuel tarih girişi (Add/Edit flight) ile `getLocalDateString()` uyumludur.
 */
export function formatLocalCalendarWeekdayLong(dateYmd: string | null | undefined): string | null {
  if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const [y, mo, d] = dateYmd.split('-').map((x) => parseInt(x, 10));
  const at = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(at.getTime())) return null;
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
  return at.toLocaleDateString(locale, { weekday: 'long' });
}

/**
 * Format flight date (YYYY-MM-DD) for lists. Turkish when app language is TR, else English.
 * Prefer storing `flight_date` as the UTC calendar day of scheduled departure once times exist.
 */
export function formatFlightDate(dateIso: string | null | undefined): string {
  if (!dateIso || typeof dateIso !== 'string') return '—';
  const date = new Date(dateIso + 'T12:00:00Z');
  if (Number.isNaN(date.getTime())) return '—';
  const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
  const weekday = date.toLocaleDateString(locale, { weekday: 'long' });
  const dayMonth = date.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  return `${dayMonth} - ${weekday}`;
}

/** @deprecated Use formatFlightDate (locale-aware). */
export function formatFlightDateTr(dateIso: string | null | undefined): string {
  return formatFlightDate(dateIso);
}

/** Get UTC HH:MM from stored flight datetime (for edit form). */
export function flightTimeToUtcHHMM(iso: string | null | undefined): string {
  const d = parseFlightTimeAsUtc(iso);
  if (!d) return '';
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
