/**
 * Havalimanı kodu → yerel takvim günü / offset (yaz-kış saati).
 * Önce `constants/airports` IANA haritası + Intl; yoksa sabit dakika tablosu (yedek).
 */
import { getAirportTimezone } from '../constants/airports';

/** Yedek: IANA bilinmiyorsa veya Intl hata verirse (CLI/script uyumu). */
const AIRPORT_UTC_OFFSET_MINUTES: Record<string, number> = {
  IST: 180,
  LTFM: 180,
  SAW: 180,
  LTFJ: 180,
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
  COV: 180,
  LTDB: 180,
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
  VKO: 180,
  UUWW: 180,
  DME: 180,
  UUDD: 180,
  LED: 180,
  ULLI: 180,
};

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

export function getAirportOffsetMinutes(icaoOrIata: string): number {
  if (!icaoOrIata) return 0;
  const key = icaoOrIata.toUpperCase().trim();
  return AIRPORT_UTC_OFFSET_MINUTES[key] ?? 0;
}

/**
 * Aviation Edge vb. yerel saat → UTC için: roster `flightYmd` günü öğlen anında IANA offset’i.
 * Türkiye (`Europe/Istanbul`) yıl boyu +180; AB/UK yaz saatinde otomatik güncellenir.
 */
export function getEffectiveUtcOffsetMinutesForAirportAtFlightDate(
  airportCode: string | null | undefined,
  flightYmd: string,
): number {
  if (!airportCode) return 0;
  const key = airportCode.toUpperCase().trim();
  const iana = getAirportTimezone(key);
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
  return getAirportOffsetMinutes(key);
}

export function utcIsoToLocalDateAtAirport(utcIso: string | undefined, airportCode: string | undefined): string | undefined {
  if (!utcIso || !airportCode) return undefined;
  const key = airportCode.toUpperCase().trim();
  const iana = getAirportTimezone(key);
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
  const offsetMin = getAirportOffsetMinutes(key);
  return new Date(d.getTime() + offsetMin * 60 * 1000).toISOString().slice(0, 10);
}
