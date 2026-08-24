/**
 * FR24 bacaklarında crew `flight_date` eşlemesi: kalkış meydanı **yerel** takvim günü (UTC günü değil).
 * Yaz/kış saati: sabit offset yerine IANA + Intl; yedek olarak eski dakika tablosu.
 */
import { airportIanaForCode } from './airportIanaByCode.ts';

/** Eski sabit tablo — yalnızca IANA yoksa veya Intl başarısızsa. */
const AIRPORT_UTC_OFFSET_MINUTES_FALLBACK: Record<string, number> = {
  IST: 180,
  LTFM: 180,
  SAW: 180,
  LTFJ: 180,
  COV: 180,
  LTDB: 180,
  ADB: 180,
  LTAF: 180,
  LTBJ: 180,
  AYT: 180,
  LTAI: 180,
  ESB: 180,
  LTFB: 180,
  BJV: 180,
  DLM: 180,
  LTBS: 180,
  IZM: 180,
  TZX: 180,
  ADA: 180,
  GZP: 180,
  LTGP: 180,
  ASR: 180,
  LTAU: 180,
  KYA: 180,
  LTAN: 180,
  GZT: 180,
  LTAJ: 180,
  VAN: 180,
  LTCI: 180,
  ERZ: 180,
  LTCE: 180,
  DIY: 180,
  LTCC: 180,
  SZF: 180,
  EDO: 180,
  LTFD: 180,
  ECN: 120,
  LCEN: 120,
  LCA: 120,
  LCLK: 120,
  PFO: 120,
  LHR: 0,
  EGLL: 0,
  LGW: 0,
  EGKK: 0,
  STN: 0,
  EGSS: 0,
  MAN: 0,
  EGCC: 0,
  EDI: 0,
  EGPH: 0,
  BHX: 0,
  EGBB: 0,
  BRS: 0,
  EGGD: 0,
  NCL: 0,
  EGNT: 0,
  LPL: 0,
  EGGP: 0,
  BFS: 0,
  EGAA: 0,
  FRA: 60,
  EDDF: 60,
  MUC: 60,
  EDDM: 60,
  DUS: 60,
  EDDL: 60,
  BER: 60,
  EDDB: 60,
  CDG: 60,
  LFPG: 60,
  ORY: 60,
  LFPO: 60,
  LYS: 60,
  MRS: 60,
  MAD: 60,
  LEMD: 60,
  BCN: 60,
  LEBL: 60,
  SVQ: 60,
  LEZL: 60,
  AMS: 60,
  EHAM: 60,
  BRU: 60,
  EBBR: 60,
  ZRH: 60,
  LSZH: 60,
  VIE: 60,
  LOWW: 60,
  PRG: 60,
  LKPR: 60,
  CPH: 60,
  EKCH: 60,
  HEL: 60,
  EFHK: 60,
  ATH: 60,
  LGAV: 60,
  LIS: 60,
  LPPT: 60,
  OPO: 60,
  DUB: 60,
  EIDW: 60,
  WAW: 60,
  EPWA: 60,
  KRK: 60,
  EPKK: 60,
  OSL: 60,
  ENGM: 60,
  ARN: 60,
  ESSA: 60,
  GVA: 60,
  LSGG: 60,
  BSL: 60,
  LFSB: 60,
  CGN: 60,
  EDDK: 60,
  HAM: 60,
  EDDH: 60,
  STR: 60,
  EDDS: 60,
  NUE: 60,
  EDDN: 60,
  LEJ: 60,
  EDDP: 60,
  EIN: 60,
  EHEH: 60,
  RTM: 60,
  EHRD: 60,
  BLQ: 60,
  LIPE: 60,
  BUD: 60,
  LHBP: 60,
  BEG: 60,
  LYBE: 60,
  BTS: 60,
  LZIB: 60,
  RHO: 120,
  HER: 120,
  CHQ: 120,
  SKG: 120,
  LGTS: 120,
  TIA: 120,
  LATI: 120,
  ZAG: 120,
  LDZA: 120,
  SJJ: 120,
  LQSA: 120,
  SOF: 120,
  LBSF: 120,
  OTP: 120,
  LROP: 120,
  SKP: 120,
  LWSK: 120,
  PRN: 120,
  BKPR: 120,
  KIV: 120,
  LUKK: 120,
  LCRA: 120,
  DXB: 240,
  OMDB: 240,
  SHJ: 240,
  AUH: 240,
  OMAA: 240,
  DOH: 180,
  OTHH: 180,
  OTBD: 180,
  BAH: 180,
  OBBI: 180,
  KWI: 180,
  OKBK: 180,
  MCT: 240,
  OOMS: 240,
  KHI: 300,
  OPKC: 300,
  ISB: 300,
  LHE: 300,
  BGW: 180,
  ORBI: 180,
  SVO: 180,
  UUEE: 180,
  DME: 180,
  UUDD: 180,
  LED: 180,
  ULLI: 180,
};

/** Dakika cinsinden UTC’nin doğusundaki offset (ör. TR +180). */
function timezoneOffsetMinutesEastOfUtc(instant: Date, iana: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const pt = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const y = Number(pt.year);
  const mo = Number(pt.month) - 1;
  const d = Number(pt.day);
  const h = Number(pt.hour);
  const mi = Number(pt.minute);
  const s = Number(pt.second);
  const asWallAsIfUtc = Date.UTC(y, mo, d, h, mi, s);
  return (asWallAsIfUtc - instant.getTime()) / 60000;
}

export function utcIsoToLocalDateAtAirport(utcIso: string | undefined, airportCode: string | undefined): string | undefined {
  if (!utcIso || !airportCode) return undefined;
  const u = airportCode.toUpperCase().trim();
  const iana = airportIanaForCode(u);
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return undefined;
  if (iana) {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit' });
      const s = fmt.format(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const fp = fmt.formatToParts(d);
      const y = fp.find((p) => p.type === 'year')?.value;
      const m = fp.find((p) => p.type === 'month')?.value;
      const day = fp.find((p) => p.type === 'day')?.value;
      if (y && m && day) return `${y}-${m}-${day}`;
    } catch {
      /* fall through */
    }
  }
  const offsetMin = AIRPORT_UTC_OFFSET_MINUTES_FALLBACK[u] ?? 0;
  return new Date(d.getTime() + offsetMin * 60 * 1000).toISOString().slice(0, 10);
}

/** Edge’de AE benzeri yerel→UTC için: `flightYmd` günü öğlen anında bölge offset’i. */
export function utcOffsetMinutesEastForAirportOnFlightDate(airportCode: string | undefined, flightYmd: string): number {
  if (!airportCode) return 0;
  const u = airportCode.toUpperCase().trim();
  const iana = airportIanaForCode(u);
  if (iana) {
    const [y, mo, da] = flightYmd.split('-').map(Number);
    if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(da)) {
      const probe = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
      try {
        return timezoneOffsetMinutesEastOfUtc(probe, iana);
      } catch {
        /* fall through */
      }
    }
  }
  return AIRPORT_UTC_OFFSET_MINUTES_FALLBACK[u] ?? 0;
}

function toUtcIsoAssumeUtc(dt: string | null | undefined): string | undefined {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? `${s}:00.000Z` : `${s}Z`;
  }
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function toUtcIsoStrict(dt: string | null | undefined): string | undefined {
  if (!dt || typeof dt !== 'string') return undefined;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) return undefined;
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function localIsoToUtcIso(iso: string, offsetMinutes: number): string | undefined {
  const s = iso.trim().replace(' ', 'T');
  const dateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = s.match(/T(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!dateMatch || !timeMatch) return undefined;
  const [, y, mo, d] = dateMatch;
  const [, h, min, sec] = timeMatch;
  const localAsUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(min), Number(sec ?? 0));
  const utcMs = localAsUtcMs - offsetMinutes * 60 * 1000;
  return new Date(utcMs).toISOString();
}

function localTimeToUtcIso(dateYmd: string, time: string, offsetMinutes: number): string | undefined {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return undefined;
  const parts = time.trim().slice(0, 8).split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  const s = parseInt(parts[2] ?? '0', 10);
  const [y, mo, d] = dateYmd.split('-').map(Number);
  if (!y || !mo || !d) return undefined;
  const localAsUtcMs = Date.UTC(y, mo - 1, d, h, m, s);
  return new Date(localAsUtcMs - offsetMinutes * 60 * 1000).toISOString();
}

/**
 * Önce gerçek UTC (`*_utc` / Z / ±offset); yoksa havalimanı yerel duvar saati → UTC.
 * AirLabs `dep_time` / AeroDataBox `scheduledTimeLocal` asla Z sanılmamalı.
 *
 * Bazen *_utc offset’siz (veya yanlışlıkla Z’li) gelir ve yerel alanla aynı duvar saatini taşır —
 * bu durumda UTC sanılmaz, havalimanı yerelinden çevrilir (TR’de +3 kaymayı önler).
 */
export function utcFieldOrAirportLocalToUtcIso(
  utcRaw: string | null | undefined,
  localRaw: string | null | undefined,
  airportCode: string,
  fallbackDateYmd?: string,
): string | undefined {
  const localStr = localRaw && String(localRaw).trim() ? String(localRaw).trim() : '';
  const utcStr = utcRaw && String(utcRaw).trim() ? String(utcRaw).trim() : '';

  const parseLocal = (): string | undefined => {
    if (!localStr) return undefined;
    const s0 = localStr.replace(' ', 'T');
    // Yerel alan Z/offset taşıyorsa (nadir) gerçek UTC kabul.
    if (s0.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s0)) return toUtcIsoStrict(s0);
    const ymdInField = /^\d{4}-\d{2}-\d{2}/.test(s0) ? s0.slice(0, 10) : '';
    const code = airportCode.replace(/\s/g, '').toUpperCase();
    const offsetMin =
      (ymdInField ? utcOffsetMinutesEastForAirportOnFlightDate(code, ymdInField) : 0) ||
      (fallbackDateYmd ? utcOffsetMinutesEastForAirportOnFlightDate(code, fallbackDateYmd) : 0) ||
      0;
    if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(s0)) {
      return localIsoToUtcIso(s0, offsetMin);
    }
    if (ymdInField && /^\d{1,2}:\d{2}/.test(s0)) {
      return localTimeToUtcIso(ymdInField, s0, offsetMin);
    }
    if (fallbackDateYmd && /^\d{1,2}:\d{2}/.test(s0)) {
      return localTimeToUtcIso(fallbackDateYmd, s0, offsetMin);
    }
    return undefined;
  };

  const hhmmFromIsoLike = (raw: string): string | undefined => {
    const s = raw.trim().replace(' ', 'T');
    const isoMatch = s.match(/T(\d{1,2}):(\d{2})/);
    if (isoMatch) return `${isoMatch[1]!.padStart(2, '0')}:${isoMatch[2]}`;
    if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
    return undefined;
  };

  const localParsed = parseLocal();
  const utcStrict = utcStr ? toUtcIsoStrict(utcStr) : undefined;
  const utcOffsetless =
    utcStr && !toUtcIsoStrict(utcStr) && !utcStr.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(utcStr.replace(' ', 'T'))
      ? utcStr
      : '';

  // Aynı duvar saati → yerel yorum (yanlış Z veya offset’siz yerel kopya).
  if (localParsed && (utcStrict || utcOffsetless)) {
    const uClock = hhmmFromIsoLike(utcStrict ?? utcOffsetless);
    const lClock = hhmmFromIsoLike(localStr);
    if (uClock && lClock && uClock === lClock) return localParsed;
  }

  if (utcStrict) return utcStrict;
  if (utcOffsetless) {
    const assumed = toUtcIsoAssumeUtc(utcOffsetless);
    if (assumed && localParsed) {
      const uClock = hhmmFromIsoLike(utcOffsetless);
      const lClock = hhmmFromIsoLike(localStr);
      if (uClock && lClock && uClock === lClock) return localParsed;
      return assumed;
    }
    if (assumed) return assumed;
  }
  if (localParsed) return localParsed;
  return undefined;
}

/**
 * FR24 flight-summary: alan adında utc olsa da offset yoksa değer çoğunlukla o meydanın yerel duvar saatidir.
 * Z veya ±offset varsa gerçek anlık UTC parse edilir.
 */
export function fr24ScheduledFieldToUtcIso(
  raw: string | null | undefined,
  airportCode: string,
  rosterFlightDateYmd: string,
): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const s0 = raw.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s0)) return undefined;
  const hasOffset = s0.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s0);
  if (hasOffset) return toUtcIsoStrict(raw);
  const ymdInField = s0.slice(0, 10);
  const code = airportCode.replace(/\s/g, '').toUpperCase();
  const offsetMin =
    utcOffsetMinutesEastForAirportOnFlightDate(code, ymdInField) ||
    utcOffsetMinutesEastForAirportOnFlightDate(code, rosterFlightDateYmd);
  const fromLocal = localIsoToUtcIso(s0, offsetMin);
  return fromLocal ?? toUtcIsoAssumeUtc(raw);
}

/** Sıralama / skor: önce planlı kalkış (yerel-naive düzeltmeli), yoksa canlı alanlar (UTC). */
export function fr24PrimaryDepUtcIsoForSort(f: Record<string, unknown>, rosterYmd: string): string | undefined {
  const origin = String(f.orig_icao ?? f.origin_icao ?? '').toUpperCase();
  const depSched = f.scheduled_departure_utc ?? f.scheduled_departure;
  if (typeof depSched === 'string' && depSched.trim()) {
    const u = fr24ScheduledFieldToUtcIso(depSched, origin, rosterYmd);
    if (u) return u;
  }
  const fallback =
    f.datetime_landed ??
    f.datetimeLanded ??
    f.last_seen ??
    f.lastSeen ??
    f.first_seen ??
    f.firstSeen ??
    f.datetime_takeoff ??
    f.datetimeTakeoff;
  return toUtcIsoAssumeUtc(typeof fallback === 'string' ? fallback : undefined);
}

export function fr24LegMatchesRosterDate(
  f: Record<string, unknown>,
  rosterYmd: string,
): boolean {
  const origin = String(f.orig_icao ?? f.origin_icao ?? f.orig_iata ?? f.origin_iata ?? '').toUpperCase();
  const depScheduled = typeof f.scheduled_departure_utc === 'string' ? f.scheduled_departure_utc : undefined;
  const depLocal = typeof f.scheduled_departure === 'string' ? f.scheduled_departure : undefined;
  const depRaw = depScheduled ?? depLocal;
  const first = typeof f.first_seen === 'string' ? f.first_seen : typeof f.firstSeen === 'string' ? f.firstSeen : undefined;
  const takeoff =
    typeof f.datetime_takeoff === 'string' ? f.datetime_takeoff : typeof f.datetimeTakeoff === 'string' ? f.datetimeTakeoff : undefined;
  const depIso =
    (depRaw ? fr24ScheduledFieldToUtcIso(depRaw, origin, rosterYmd) : undefined) ??
    toUtcIsoAssumeUtc(takeoff) ??
    toUtcIsoAssumeUtc(first);
  const localDay = utcIsoToLocalDateAtAirport(depIso, origin) ?? (depIso ? depIso.slice(0, 10) : '');
  return localDay === rosterYmd;
}
