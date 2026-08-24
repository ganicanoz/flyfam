/**
 * Roster / aile paneli: mürettebat = kalkış/iniş meydanı yereli; aile = tek görüntüleme TZ’si + bölge etiketi.
 */

import { getAirportTimezone } from '../constants/airports';
import { formatFlightTimeInTz, getDeviceIanaTimeZone } from './dateUtils';

const IANA_TO_REGION: Record<string, string> = {
  'Europe/Istanbul': 'TR',
  'Asia/Istanbul': 'TR',
  'UTC': 'UTC',
  'Etc/UTC': 'UTC',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH',
  'Europe/Vienna': 'AT',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Athens': 'GR',
  'Europe/Lisbon': 'PT',
  'Europe/Moscow': 'RU',
  'Europe/Belgrade': 'RS',
  'Europe/Sofia': 'BG',
  'Europe/Zagreb': 'HR',
  'Europe/Tirane': 'AL',
  'Europe/Skopje': 'MK',
  'Europe/Sarajevo': 'BA',
  'Europe/Chisinau': 'MD',
  'Europe/Bratislava': 'SK',
  'Asia/Dubai': 'AE',
  'Asia/Qatar': 'QA',
  'Asia/Bahrain': 'BH',
  'Asia/Kuwait': 'KW',
  'Asia/Riyadh': 'SA',
  'Asia/Muscat': 'OM',
  'Asia/Baghdad': 'IQ',
  'Asia/Tehran': 'IR',
  'Asia/Jerusalem': 'IL',
  'Asia/Beirut': 'LB',
  'Asia/Amman': 'JO',
  'Asia/Nicosia': 'CY',
  'Asia/Tbilisi': 'GE',
  'Asia/Baku': 'AZ',
  'Asia/Yerevan': 'AM',
  'Asia/Almaty': 'KZ',
  'Asia/Karachi': 'PK',
  'Asia/Kolkata': 'IN',
  'Asia/Bangkok': 'TH',
  'Asia/Singapore': 'SG',
  'Asia/Hong_Kong': 'HK',
  'Asia/Shanghai': 'CN',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Australia/Sydney': 'AU',
  'Pacific/Auckland': 'NZ',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'Africa/Cairo': 'EG',
  'Africa/Casablanca': 'MA',
  'Africa/Algiers': 'DZ',
  'Africa/Tunis': 'TN',
  'Asia/Samarkand': 'UZ',
};

export function regionCodeForIanaTimeZone(tz: string | null | undefined): string {
  const t = (tz || '').trim();
  if (!t) return '—';
  const hit = IANA_TO_REGION[t];
  if (hit) return hit;
  const slash = t.indexOf('/');
  if (slash > 0) {
    const city = t.slice(slash + 1).replace(/_/g, ' ');
    if (city.length >= 2) return city.slice(0, 2).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export function resolveFamilyViewerTimeZone(profileTz: string | null | undefined): string {
  const p = profileTz?.trim();
  if (p) return p;
  return getDeviceIanaTimeZone();
}

/** Mürettebat kartı: kalkış = çıkış meydanı TZ, iniş = varış meydanı TZ. */
export function formatCrewFlightTimeRange(
  depIso: string | null | undefined,
  arrIso: string | null | undefined,
  originIata: string | null | undefined,
  destIata: string | null | undefined,
): string {
  const otz = getAirportTimezone(originIata) ?? 'UTC';
  const dtz = getAirportTimezone(destIata) ?? 'UTC';
  const dep = formatFlightTimeInTz(depIso, otz);
  const arr = formatFlightTimeInTz(arrIso, dtz);
  const ot = (originIata || '—').toUpperCase().slice(0, 3);
  const dt = (destIata || '—').toUpperCase().slice(0, 3);
  return `${dep} (${ot}) – ${arr} (${dt})`;
}

/** Aile: tek TZ (profil veya cihaz); yanında bölge kodu. */
export function formatFamilyFlightTimeRange(
  depIso: string | null | undefined,
  arrIso: string | null | undefined,
  viewerIanaTz: string | null | undefined,
): string {
  const tz = resolveFamilyViewerTimeZone(viewerIanaTz ?? null);
  const dep = formatFlightTimeInTz(depIso, tz);
  const arr = formatFlightTimeInTz(arrIso, tz);
  const tag = regionCodeForIanaTimeZone(tz);
  return `${dep} – ${arr} (${tag})`;
}
