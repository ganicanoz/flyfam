/**
 * ICAO/IATA → IATA + şehir. FR24 ICAO döndürür; IATA (şehir) gösteririz.
 * city_tr: dil tr iken Türkçe şehir.
 *
 * **Veri akışı:** `public.airports` (CSV veya FR24 sync) açılışta cache’lenir. Supabase satırında `city` boş
 * olabiliyor (kısmi sync); `getAirportDisplay` DB + statik `AIRPORTS` listesini **birleştirir** — boş şehirde
 * uygulama içi büyük fallback devreye girer (VKO, HBE vb. şehirsiz kalmaz).
 */
import i18n from '../lib/i18n';
import { resolveCityNameTr } from './cityNamesTr';

export type AirportDisplay = {
  iata: string;
  city: string;
  city_tr?: string;
  /** Supabase `public.airports.timezone_iana` — crew (L) saatleri için öncelikli. */
  timezone_iana?: string;
};

/** Cache from Supabase (airport-codes.csv). Key = ICAO or IATA (uppercase). */
let airportDisplayCache: Map<string, AirportDisplay> = new Map();

/** DB'den yüklenen havalimanı listesini cache'e yazar. Tek kaynak: docs/airport-codes.csv. */
export function setAirportDisplayCache(
  rows: { icao: string; iata: string | null; city: string | null; city_tr: string | null }[]
): void {
  const next = new Map<string, AirportDisplay>();
  for (const r of rows) {
    const icao = (r.icao || '').trim().toUpperCase();
    const iata = (r.iata || icao || '').trim().toUpperCase();
    const city = (r.city || '').trim() || '';
    const city_tr = (r.city_tr || '').trim() || undefined;
    const display: AirportDisplay = { iata: iata || icao, city, city_tr };
    if (icao) next.set(icao, display);
    if (iata && iata !== icao) next.set(iata, display);
  }
  airportDisplayCache = next;
}

/** Supabase public.airports tablosunu çeker ve cache'i doldurur (kaynak: airport-codes.csv). */
export async function loadAirportDisplayFromSupabase(supabase: {
  from: (table: string) => { select: (cols: string) => Promise<{ data: unknown[] | null }> };
}): Promise<void> {
  try {
    const { data } = await supabase.from('airports').select('icao,iata,city,city_tr,timezone_iana');
    const rows = (data || []) as {
      icao: string;
      iata: string | null;
      city: string | null;
      city_tr: string | null;
      timezone_iana: string | null;
    }[];
    if (rows.length > 0) setAirportDisplayCache(rows);
  } catch {
    // offline veya hata → static fallback kullanılır
  }
}

function cityForLocale(info: AirportDisplay | null): string | undefined {
  if (!info) return undefined;
  const lang = String(i18n.language ?? '').toLowerCase();
  if (lang.startsWith('tr')) {
    if (info.city_tr) return info.city_tr;
    const fromEn = resolveCityNameTr(info.city);
    if (fromEn) return fromEn;
  }
  return info.city;
}

/** Roster’dan gelen şehir (EN) + havalimanı cache; dil tr ise sözlükle Türkçeleştirir. */
function displayCityName(cityFromDb: string | null | undefined, info: AirportDisplay | null): string | undefined {
  const lang = String(i18n.language ?? '').toLowerCase();
  // Product rule: SAW and IST must always display as Istanbul.
  if (info?.iata === 'SAW' || info?.iata === 'IST') {
    return lang.startsWith('tr') ? 'İstanbul' : 'Istanbul';
  }
  // Hatay Airport (HTY) — show province city, not district (Antakya).
  if (info?.iata === 'HTY') {
    return 'Hatay';
  }
  // Prefer airport-code based city names to avoid district/sub-city values from DB (e.g. Pendik).
  const raw = cityForLocale(info) || info?.city || (cityFromDb && cityFromDb.trim());
  if (!raw) return undefined;
  if (lang.startsWith('tr')) {
    return resolveCityNameTr(raw) ?? raw;
  }
  return raw;
}

const AIRPORTS: Record<string, AirportDisplay> = {
  // Turkey (city_tr ile Türkçe gösterim)
  LTFJ: { iata: 'SAW', city: 'Istanbul', city_tr: 'İstanbul' },
  SAW: { iata: 'SAW', city: 'Istanbul', city_tr: 'İstanbul' },
  LTFM: { iata: 'IST', city: 'Istanbul', city_tr: 'İstanbul' },
  IST: { iata: 'IST', city: 'Istanbul', city_tr: 'İstanbul' },
  LTAI: { iata: 'AYT', city: 'Antalya' },
  AYT: { iata: 'AYT', city: 'Antalya' },
  LTBJ: { iata: 'ADB', city: 'İzmir' }, // İzmir Adnan Menderes (ADB) — not Bodrum
  BJV: { iata: 'BJV', city: 'Bodrum' }, // Milas-Bodrum (BJV)
  LTBS: { iata: 'DLM', city: 'Dalaman' },
  DLM: { iata: 'DLM', city: 'Dalaman' },
  // LTFB is Selçuk–Efes (İzmir). No standard IATA; keep ICAO for display.
  LTFB: { iata: 'LTFB', city: 'Selçuk (Efes)' },
  ESB: { iata: 'ESB', city: 'Ankara' },
  LTAF: { iata: 'ADB', city: 'İzmir' }, // İzmir Adnan Menderes
  ADB: { iata: 'ADB', city: 'İzmir' },
  IZM: { iata: 'ADB', city: 'İzmir' }, // city code alias
  LTCG: { iata: 'TZX', city: 'Trabzon' },
  TZX: { iata: 'TZX', city: 'Trabzon' },
  LTAH: { iata: 'ADA', city: 'Adana' },
  ADA: { iata: 'ADA', city: 'Adana' },
  LTDA: { iata: 'HTY', city: 'Hatay', city_tr: 'Hatay' },
  HTY: { iata: 'HTY', city: 'Hatay', city_tr: 'Hatay' },
  LTFE: { iata: 'BJV', city: 'Bodrum' }, // Milas-Bodrum (LTFE/BJV)
  LTDB: { iata: 'COV', city: 'Mersin' }, // Çukurova (Mersin)
  COV: { iata: 'COV', city: 'Mersin' },
  LTBH: { iata: 'CKZ', city: 'Çanakkale' },
  CKZ: { iata: 'CKZ', city: 'Çanakkale' },
  // LTAC is Ankara Esenboğa.
  LTAC: { iata: 'ESB', city: 'Ankara' },
  // Some APIs use metropolitan/city codes (e.g. ANK). Normalize to main airport for display.
  ANK: { iata: 'ESB', city: 'Ankara' },
  // Pakistan (e.g. OPKC)
  OPKC: { iata: 'KHI', city: 'Karachi', city_tr: 'Karaçi' },
  KHI: { iata: 'KHI', city: 'Karachi', city_tr: 'Karaçi' },
  OPRN: { iata: 'ISB', city: 'Islamabad', city_tr: 'İslamabad' },
  ISB: { iata: 'ISB', city: 'Islamabad', city_tr: 'İslamabad' },
  OPLA: { iata: 'LHE', city: 'Lahore', city_tr: 'Lahor' },
  LHE: { iata: 'LHE', city: 'Lahore', city_tr: 'Lahor' },
  // Germany
  EDDF: { iata: 'FRA', city: 'Frankfurt', city_tr: 'Frankfurt' },
  FRA: { iata: 'FRA', city: 'Frankfurt', city_tr: 'Frankfurt' },
  EDDM: { iata: 'MUC', city: 'Munich', city_tr: 'Münih' },
  MUC: { iata: 'MUC', city: 'Munich', city_tr: 'Münih' },
  EDDL: { iata: 'DUS', city: 'Düsseldorf', city_tr: 'Düsseldorf' },
  DUS: { iata: 'DUS', city: 'Düsseldorf', city_tr: 'Düsseldorf' },
  // UK
  EGLL: { iata: 'LHR', city: 'London', city_tr: 'Londra' },
  LHR: { iata: 'LHR', city: 'London', city_tr: 'Londra' },
  EGKK: { iata: 'LGW', city: 'London', city_tr: 'Londra' },
  LGW: { iata: 'LGW', city: 'London', city_tr: 'Londra' },
  // Netherlands
  EHAM: { iata: 'AMS', city: 'Amsterdam', city_tr: 'Amsterdam' },
  AMS: { iata: 'AMS', city: 'Amsterdam', city_tr: 'Amsterdam' },
  // France
  LFPG: { iata: 'CDG', city: 'Paris', city_tr: 'Paris' },
  CDG: { iata: 'CDG', city: 'Paris', city_tr: 'Paris' },
  LFLL: { iata: 'LYS', city: 'Lyon', city_tr: 'Lyon' },
  LYS: { iata: 'LYS', city: 'Lyon', city_tr: 'Lyon' },
  // Spain
  LEMD: { iata: 'MAD', city: 'Madrid', city_tr: 'Madrid' },
  MAD: { iata: 'MAD', city: 'Madrid', city_tr: 'Madrid' },
  LEBL: { iata: 'BCN', city: 'Barcelona', city_tr: 'Barselona' },
  BCN: { iata: 'BCN', city: 'Barcelona', city_tr: 'Barselona' },
  // Austria
  LOWW: { iata: 'VIE', city: 'Vienna', city_tr: 'Viyana' },
  VIE: { iata: 'VIE', city: 'Vienna', city_tr: 'Viyana' },
  LOWG: { iata: 'GRZ', city: 'Graz', city_tr: 'Graz' },
  GRZ: { iata: 'GRZ', city: 'Graz', city_tr: 'Graz' },
  // Switzerland
  LSZH: { iata: 'ZRH', city: 'Zurich', city_tr: 'Zürih' },
  ZRH: { iata: 'ZRH', city: 'Zurich', city_tr: 'Zürih' },
  // UAE
  OMDB: { iata: 'DXB', city: 'Dubai', city_tr: 'Dubai' },
  DXB: { iata: 'DXB', city: 'Dubai', city_tr: 'Dubai' },
  OMSJ: { iata: 'SHJ', city: 'Sharjah', city_tr: 'Şarika' },
  SHJ: { iata: 'SHJ', city: 'Sharjah', city_tr: 'Şarika' },
  // Qatar
  OTBD: { iata: 'DOH', city: 'Doha', city_tr: 'Doha' },
  OTHH: { iata: 'DOH', city: 'Doha', city_tr: 'Doha' },
  DOH: { iata: 'DOH', city: 'Doha', city_tr: 'Doha' },
  // Russia — Moscow (Sheremetyevo, Domodedovo, Vnukovo)
  UUEE: { iata: 'SVO', city: 'Moscow', city_tr: 'Moskova' },
  SVO: { iata: 'SVO', city: 'Moscow', city_tr: 'Moskova' },
  UUWW: { iata: 'VKO', city: 'Moscow', city_tr: 'Moskova' },
  VKO: { iata: 'VKO', city: 'Moscow', city_tr: 'Moskova' },
  // Cyprus
  LCLK: { iata: 'LCA', city: 'Larnaca', city_tr: 'Larnaka' },
  LCA: { iata: 'LCA', city: 'Larnaca', city_tr: 'Larnaka' },
  LCRA: { iata: 'PFO', city: 'Paphos', city_tr: 'Baf' },
  PFO: { iata: 'PFO', city: 'Paphos', city_tr: 'Baf' },
  // More Gulf / Middle East
  OBBI: { iata: 'BAH', city: 'Bahrain', city_tr: 'Bahreyn' },
  BAH: { iata: 'BAH', city: 'Bahrain', city_tr: 'Bahreyn' },
  OKBK: { iata: 'KWI', city: 'Kuwait City', city_tr: 'Kuveyt' },
  KWI: { iata: 'KWI', city: 'Kuwait City', city_tr: 'Kuveyt' },
  OOMS: { iata: 'MCT', city: 'Muscat', city_tr: 'Maskat' },
  MCT: { iata: 'MCT', city: 'Muscat', city_tr: 'Maskat' },
  OERK: { iata: 'RUH', city: 'Riyadh', city_tr: 'Riyad' },
  RUH: { iata: 'RUH', city: 'Riyadh', city_tr: 'Riyad' },
  OEJN: { iata: 'JED', city: 'Jeddah', city_tr: 'Cidde' },
  JED: { iata: 'JED', city: 'Jeddah', city_tr: 'Cidde' },
  OEDR: { iata: 'DMM', city: 'Dammam', city_tr: 'Demmam' },
  DMM: { iata: 'DMM', city: 'Dammam', city_tr: 'Demmam' },
  OIIE: { iata: 'IKA', city: 'Tehran', city_tr: 'Tahran' },
  IKA: { iata: 'IKA', city: 'Tehran', city_tr: 'Tahran' },
  OTBH: { iata: 'DOH', city: 'Doha', city_tr: 'Doha' },
  // Greece
  LGAV: { iata: 'ATH', city: 'Athens', city_tr: 'Atina' },
  ATH: { iata: 'ATH', city: 'Athens', city_tr: 'Atina' },
  LGRP: { iata: 'RHO', city: 'Rhodes', city_tr: 'Rodos' },
  RHO: { iata: 'RHO', city: 'Rhodes', city_tr: 'Rodos' },
  LGSA: { iata: 'CHQ', city: 'Chania', city_tr: 'Hanya' },
  CHQ: { iata: 'CHQ', city: 'Chania', city_tr: 'Hanya' },
  LGIR: { iata: 'HER', city: 'Heraklion', city_tr: 'Kandiye' },
  HER: { iata: 'HER', city: 'Heraklion', city_tr: 'Kandiye' },
  // Italy
  LIRF: { iata: 'FCO', city: 'Rome', city_tr: 'Roma' },
  FCO: { iata: 'FCO', city: 'Rome', city_tr: 'Roma' },
  LIML: { iata: 'MXP', city: 'Milan', city_tr: 'Milano' },
  MXP: { iata: 'MXP', city: 'Milan', city_tr: 'Milano' },
  LIPZ: { iata: 'VCE', city: 'Venice', city_tr: 'Venedik' },
  VCE: { iata: 'VCE', city: 'Venice', city_tr: 'Venedik' },
  LIME: { iata: 'BGY', city: 'Milan', city_tr: 'Milano' },
  BGY: { iata: 'BGY', city: 'Milan', city_tr: 'Milano' },
  // Portugal
  LPPT: { iata: 'LIS', city: 'Lisbon', city_tr: 'Lizbon' },
  LIS: { iata: 'LIS', city: 'Lisbon', city_tr: 'Lizbon' },
  LPPR: { iata: 'OPO', city: 'Porto', city_tr: 'Porto' },
  OPO: { iata: 'OPO', city: 'Porto', city_tr: 'Porto' },
  // Belgium, Ireland
  EBBR: { iata: 'BRU', city: 'Brussels', city_tr: 'Brüksel' },
  BRU: { iata: 'BRU', city: 'Brussels', city_tr: 'Brüksel' },
  EIDW: { iata: 'DUB', city: 'Dublin', city_tr: 'Dublin' },
  DUB: { iata: 'DUB', city: 'Dublin', city_tr: 'Dublin' },
  // USA (major hubs)
  KJFK: { iata: 'JFK', city: 'New York', city_tr: 'New York' },
  JFK: { iata: 'JFK', city: 'New York', city_tr: 'New York' },
  KORD: { iata: 'ORD', city: 'Chicago', city_tr: 'Şikago' },
  ORD: { iata: 'ORD', city: 'Chicago', city_tr: 'Şikago' },
  KLAX: { iata: 'LAX', city: 'Los Angeles', city_tr: 'Los Angeles' },
  LAX: { iata: 'LAX', city: 'Los Angeles', city_tr: 'Los Angeles' },
  KEWR: { iata: 'EWR', city: 'Newark', city_tr: 'Newark' },
  EWR: { iata: 'EWR', city: 'Newark', city_tr: 'Newark' },
  KMIA: { iata: 'MIA', city: 'Miami', city_tr: 'Miami' },
  MIA: { iata: 'MIA', city: 'Miami', city_tr: 'Miami' },
  KATL: { iata: 'ATL', city: 'Atlanta', city_tr: 'Atlanta' },
  ATL: { iata: 'ATL', city: 'Atlanta', city_tr: 'Atlanta' },
  KDFW: { iata: 'DFW', city: 'Dallas', city_tr: 'Dallas' },
  DFW: { iata: 'DFW', city: 'Dallas', city_tr: 'Dallas' },
  KDEN: { iata: 'DEN', city: 'Denver', city_tr: 'Denver' },
  DEN: { iata: 'DEN', city: 'Denver', city_tr: 'Denver' },
  KSFO: { iata: 'SFO', city: 'San Francisco', city_tr: 'San Francisco' },
  SFO: { iata: 'SFO', city: 'San Francisco', city_tr: 'San Francisco' },
  KIAD: { iata: 'IAD', city: 'Washington', city_tr: 'Vaşington' },
  IAD: { iata: 'IAD', city: 'Washington', city_tr: 'Vaşington' },
  KBOS: { iata: 'BOS', city: 'Boston', city_tr: 'Boston' },
  BOS: { iata: 'BOS', city: 'Boston', city_tr: 'Boston' },
  KSEA: { iata: 'SEA', city: 'Seattle', city_tr: 'Seattle' },
  SEA: { iata: 'SEA', city: 'Seattle', city_tr: 'Seattle' },
  // Canada
  CYYZ: { iata: 'YYZ', city: 'Toronto', city_tr: 'Toronto' },
  YYZ: { iata: 'YYZ', city: 'Toronto', city_tr: 'Toronto' },
  CYVR: { iata: 'YVR', city: 'Vancouver', city_tr: 'Vancouver' },
  YVR: { iata: 'YVR', city: 'Vancouver', city_tr: 'Vancouver' },
  CYYC: { iata: 'YYC', city: 'Calgary', city_tr: 'Calgary' },
  YYC: { iata: 'YYC', city: 'Calgary', city_tr: 'Calgary' },
  // Asia
  VHHH: { iata: 'HKG', city: 'Hong Kong', city_tr: 'Hong Kong' },
  HKG: { iata: 'HKG', city: 'Hong Kong', city_tr: 'Hong Kong' },
  WSSS: { iata: 'SIN', city: 'Singapore', city_tr: 'Singapur' },
  SIN: { iata: 'SIN', city: 'Singapore', city_tr: 'Singapur' },
  VTBS: { iata: 'BKK', city: 'Bangkok', city_tr: 'Bangkok' },
  BKK: { iata: 'BKK', city: 'Bangkok', city_tr: 'Bangkok' },
  RJAA: { iata: 'NRT', city: 'Tokyo', city_tr: 'Tokyo' },
  NRT: { iata: 'NRT', city: 'Tokyo', city_tr: 'Tokyo' },
  RJTT: { iata: 'HND', city: 'Tokyo', city_tr: 'Tokyo' },
  HND: { iata: 'HND', city: 'Tokyo', city_tr: 'Tokyo' },
  ZSPD: { iata: 'PVG', city: 'Shanghai', city_tr: 'Şangay' },
  PVG: { iata: 'PVG', city: 'Shanghai', city_tr: 'Şangay' },
  VIDP: { iata: 'DEL', city: 'Delhi', city_tr: 'Delhi' },
  DEL: { iata: 'DEL', city: 'Delhi', city_tr: 'Delhi' },
  VABB: { iata: 'BOM', city: 'Mumbai', city_tr: 'Bombay' },
  BOM: { iata: 'BOM', city: 'Mumbai', city_tr: 'Bombay' },
  // Pegasus Airlines destinations
  LATI: { iata: 'TIA', city: 'Tirana', city_tr: 'Tiran' },
  TIA: { iata: 'TIA', city: 'Tirana', city_tr: 'Tiran' },
  DAAG: { iata: 'ALG', city: 'Algiers', city_tr: 'Cezayir' },
  ALG: { iata: 'ALG', city: 'Algiers', city_tr: 'Cezayir' },
  UDYZ: { iata: 'EVN', city: 'Yerevan', city_tr: 'Erivan' },
  EVN: { iata: 'EVN', city: 'Yerevan', city_tr: 'Erivan' },
  UBBB: { iata: 'GYD', city: 'Baku', city_tr: 'Bakü' },
  GYD: { iata: 'GYD', city: 'Baku', city_tr: 'Bakü' },
  UBBG: { iata: 'KVD', city: 'Ganja', city_tr: 'Gence' },
  KVD: { iata: 'KVD', city: 'Ganja', city_tr: 'Gence' },
  EBCI: { iata: 'CRL', city: 'Charleroi', city_tr: 'Charleroi' },
  CRL: { iata: 'CRL', city: 'Charleroi', city_tr: 'Charleroi' },
  LQSA: { iata: 'SJJ', city: 'Sarajevo', city_tr: 'Saraybosna' },
  SJJ: { iata: 'SJJ', city: 'Sarajevo', city_tr: 'Saraybosna' },
  LQTZ: { iata: 'TZL', city: 'Tuzla', city_tr: 'Tuzla' },
  TZL: { iata: 'TZL', city: 'Tuzla', city_tr: 'Tuzla' },
  LBPD: { iata: 'PDV', city: 'Plovdiv', city_tr: 'Filibe' },
  PDV: { iata: 'PDV', city: 'Plovdiv', city_tr: 'Filibe' },
  LBSF: { iata: 'SOF', city: 'Sofia', city_tr: 'Sofya' },
  SOF: { iata: 'SOF', city: 'Sofia', city_tr: 'Sofya' },
  LDZA: { iata: 'ZAG', city: 'Zagreb', city_tr: 'Zagreb' },
  ZAG: { iata: 'ZAG', city: 'Zagreb', city_tr: 'Zagreb' },
  LCEN: { iata: 'ECN', city: 'Ercan', city_tr: 'Ercan' },
  ECN: { iata: 'ECN', city: 'Ercan', city_tr: 'Ercan' },
  LKPR: { iata: 'PRG', city: 'Prague', city_tr: 'Prag' },
  PRG: { iata: 'PRG', city: 'Prague', city_tr: 'Prag' },
  EKCH: { iata: 'CPH', city: 'Copenhagen', city_tr: 'Kopenhag' },
  CPH: { iata: 'CPH', city: 'Copenhagen', city_tr: 'Kopenhag' },
  HEBA: { iata: 'HBE', city: 'Alexandria', city_tr: 'İskenderiye' },
  HBE: { iata: 'HBE', city: 'Alexandria', city_tr: 'İskenderiye' },
  HEAX: { iata: 'SPX', city: 'Cairo', city_tr: 'Kahire' },
  SPX: { iata: 'SPX', city: 'Cairo', city_tr: 'Kahire' },
  HEGN: { iata: 'HRG', city: 'Hurghada', city_tr: 'Hurghada' },
  HRG: { iata: 'HRG', city: 'Hurghada', city_tr: 'Hurghada' },
  HESH: { iata: 'SSH', city: 'Sharm El Sheikh', city_tr: 'Şarm El Şeyh' },
  SSH: { iata: 'SSH', city: 'Sharm El Sheikh', city_tr: 'Şarm El Şeyh' },
  EFHK: { iata: 'HEL', city: 'Helsinki', city_tr: 'Helsinki' },
  HEL: { iata: 'HEL', city: 'Helsinki', city_tr: 'Helsinki' },
  LFML: { iata: 'MRS', city: 'Marseille', city_tr: 'Marsilya' },
  MRS: { iata: 'MRS', city: 'Marseille', city_tr: 'Marsilya' },
  LFPO: { iata: 'ORY', city: 'Paris', city_tr: 'Paris' },
  ORY: { iata: 'ORY', city: 'Paris', city_tr: 'Paris' },
  LFMH: { iata: 'EBU', city: 'Saint-Étienne', city_tr: 'Saint-Étienne' },
  EBU: { iata: 'EBU', city: 'Saint-Étienne', city_tr: 'Saint-Étienne' },
  EDDB: { iata: 'BER', city: 'Berlin', city_tr: 'Berlin' },
  BER: { iata: 'BER', city: 'Berlin', city_tr: 'Berlin' },
  EDDW: { iata: 'BRE', city: 'Bremen', city_tr: 'Bremen' },
  BRE: { iata: 'BRE', city: 'Bremen', city_tr: 'Bremen' },
  EDDK: { iata: 'CGN', city: 'Cologne', city_tr: 'Köln' },
  CGN: { iata: 'CGN', city: 'Cologne', city_tr: 'Köln' },
  EDLW: { iata: 'DTM', city: 'Dortmund', city_tr: 'Dortmund' },
  DTM: { iata: 'DTM', city: 'Dortmund', city_tr: 'Dortmund' },
  EDDE: { iata: 'ERF', city: 'Erfurt', city_tr: 'Erfurt' },
  ERF: { iata: 'ERF', city: 'Erfurt', city_tr: 'Erfurt' },
  EDDH: { iata: 'HAM', city: 'Hamburg', city_tr: 'Hamburg' },
  HAM: { iata: 'HAM', city: 'Hamburg', city_tr: 'Hamburg' },
  EDDV: { iata: 'HAJ', city: 'Hanover', city_tr: 'Hannover' },
  HAJ: { iata: 'HAJ', city: 'Hanover', city_tr: 'Hannover' },
  EDDP: { iata: 'LEJ', city: 'Leipzig', city_tr: 'Leipzig' },
  LEJ: { iata: 'LEJ', city: 'Leipzig', city_tr: 'Leipzig' },
  EDDN: { iata: 'NUE', city: 'Nuremberg', city_tr: 'Nürnberg' },
  NUE: { iata: 'NUE', city: 'Nuremberg', city_tr: 'Nürnberg' },
  EDDS: { iata: 'STR', city: 'Stuttgart', city_tr: 'Stuttgart' },
  STR: { iata: 'STR', city: 'Stuttgart', city_tr: 'Stuttgart' },
  UGSB: { iata: 'BUS', city: 'Batumi', city_tr: 'Batumi' },
  BUS: { iata: 'BUS', city: 'Batumi', city_tr: 'Batumi' },
  UGKO: { iata: 'KUT', city: 'Kutaisi', city_tr: 'Kutaisi' },
  KUT: { iata: 'KUT', city: 'Kutaisi', city_tr: 'Kutaisi' },
  UGTB: { iata: 'TBS', city: 'Tbilisi', city_tr: 'Tiflis' },
  TBS: { iata: 'TBS', city: 'Tbilisi', city_tr: 'Tiflis' },
  LHBP: { iata: 'BUD', city: 'Budapest', city_tr: 'Budapeşte' },
  BUD: { iata: 'BUD', city: 'Budapest', city_tr: 'Budapeşte' },
  OITT: { iata: 'TBZ', city: 'Tabriz', city_tr: 'Tebriz' },
  TBZ: { iata: 'TBZ', city: 'Tabriz', city_tr: 'Tebriz' },
  ORBI: { iata: 'BGW', city: 'Baghdad', city_tr: 'Bağdat' },
  BGW: { iata: 'BGW', city: 'Baghdad', city_tr: 'Bağdat' },
  ORMM: { iata: 'BSR', city: 'Basra', city_tr: 'Basra' },
  BSR: { iata: 'BSR', city: 'Basra', city_tr: 'Basra' },
  ORER: { iata: 'EBL', city: 'Erbil', city_tr: 'Erbil' },
  EBL: { iata: 'EBL', city: 'Erbil', city_tr: 'Erbil' },
  LLBG: { iata: 'TLV', city: 'Tel Aviv', city_tr: 'Tel Aviv' },
  TLV: { iata: 'TLV', city: 'Tel Aviv', city_tr: 'Tel Aviv' },
  LIPE: { iata: 'BLQ', city: 'Bologna', city_tr: 'Bologna' },
  BLQ: { iata: 'BLQ', city: 'Bologna', city_tr: 'Bologna' },
  OJAM: { iata: 'AMM', city: 'Amman', city_tr: 'Amman' },
  AMM: { iata: 'AMM', city: 'Amman', city_tr: 'Amman' },
  UAAA: { iata: 'ALA', city: 'Almaty', city_tr: 'Almatı' },
  ALA: { iata: 'ALA', city: 'Almaty', city_tr: 'Almatı' },
  UATE: { iata: 'SCO', city: 'Aqtau', city_tr: 'Aktav' },
  SCO: { iata: 'SCO', city: 'Aqtau', city_tr: 'Aktav' },
  UATT: { iata: 'AKX', city: 'Aqtöbe', city_tr: 'Aktober' },
  AKX: { iata: 'AKX', city: 'Aqtöbe', city_tr: 'Aktober' },
  UACC: { iata: 'NQZ', city: 'Astana', city_tr: 'Astana' },
  NQZ: { iata: 'NQZ', city: 'Astana', city_tr: 'Astana' },
  UATG: { iata: 'GUW', city: 'Atyrau', city_tr: 'Atırau' },
  GUW: { iata: 'GUW', city: 'Atyrau', city_tr: 'Atırau' },
  UAII: { iata: 'CIT', city: 'Shymkent', city_tr: 'Şımkent' },
  CIT: { iata: 'CIT', city: 'Shymkent', city_tr: 'Şımkent' },
  BKPR: { iata: 'PRN', city: 'Pristina', city_tr: 'Priştine' },
  PRN: { iata: 'PRN', city: 'Pristina', city_tr: 'Priştine' },
  UAFM: { iata: 'FRU', city: 'Bishkek', city_tr: 'Bişkek' },
  FRU: { iata: 'FRU', city: 'Bishkek', city_tr: 'Bişkek' },
  UAFO: { iata: 'OSS', city: 'Osh', city_tr: 'Oş' },
  OSS: { iata: 'OSS', city: 'Osh', city_tr: 'Oş' },
  OLBA: { iata: 'BEY', city: 'Beirut', city_tr: 'Beyrut' },
  BEY: { iata: 'BEY', city: 'Beirut', city_tr: 'Beyrut' },
  // airport-codes.csv: LUKK = Chișinău International, IATA RMO
  LUKK: { iata: 'RMO', city: 'Chișinău', city_tr: 'Kişinev' },
  RMO: { iata: 'RMO', city: 'Chișinău', city_tr: 'Kişinev' },
  GMMN: { iata: 'CMN', city: 'Casablanca', city_tr: 'Kazablanka' },
  CMN: { iata: 'CMN', city: 'Casablanca', city_tr: 'Kazablanka' },
  EHEH: { iata: 'EIN', city: 'Eindhoven', city_tr: 'Eindhoven' },
  EIN: { iata: 'EIN', city: 'Eindhoven', city_tr: 'Eindhoven' },
  EHRD: { iata: 'RTM', city: 'Rotterdam', city_tr: 'Rotterdam' },
  RTM: { iata: 'RTM', city: 'Rotterdam', city_tr: 'Rotterdam' },
  LWSK: { iata: 'SKP', city: 'Skopje', city_tr: 'Üsküp' },
  SKP: { iata: 'SKP', city: 'Skopje', city_tr: 'Üsküp' },
  ENGM: { iata: 'OSL', city: 'Oslo', city_tr: 'Oslo' },
  OSL: { iata: 'OSL', city: 'Oslo', city_tr: 'Oslo' },
  EPKK: { iata: 'KRK', city: 'Krakow', city_tr: 'Krakov' },
  KRK: { iata: 'KRK', city: 'Krakow', city_tr: 'Krakov' },
  EPGD: { iata: 'GDN', city: 'Gdansk', city_tr: 'Gdansk' },
  GDN: { iata: 'GDN', city: 'Gdansk', city_tr: 'Gdansk' },
  EPWA: { iata: 'WAW', city: 'Warsaw', city_tr: 'Varşova' },
  WAW: { iata: 'WAW', city: 'Warsaw', city_tr: 'Varşova' },
  LROP: { iata: 'OTP', city: 'Bucharest', city_tr: 'Bükreş' },
  OTP: { iata: 'OTP', city: 'Bucharest', city_tr: 'Bükreş' },
  UUDD: { iata: 'DME', city: 'Moscow', city_tr: 'Moskova' },
  DME: { iata: 'DME', city: 'Moscow', city_tr: 'Moskova' },
  ULLI: { iata: 'LED', city: 'Saint Petersburg', city_tr: 'Sankt Petersburg' },
  LED: { iata: 'LED', city: 'Saint Petersburg', city_tr: 'Sankt Petersburg' },
  URMM: { iata: 'MRV', city: 'Mineralnye Vody', city_tr: 'Mineralnıye Vodı' },
  MRV: { iata: 'MRV', city: 'Mineralnye Vody', city_tr: 'Mineralnıye Vodı' },
  URMG: { iata: 'GRV', city: 'Grozny', city_tr: 'Groznı' },
  GRV: { iata: 'GRV', city: 'Grozny', city_tr: 'Groznı' },
  OEMA: { iata: 'MED', city: 'Medina', city_tr: 'Medine' },
  MED: { iata: 'MED', city: 'Medina', city_tr: 'Medine' },
  LEZL: { iata: 'SVQ', city: 'Seville', city_tr: 'Sevilla' },
  SVQ: { iata: 'SVQ', city: 'Seville', city_tr: 'Sevilla' },
  LYBE: { iata: 'BEG', city: 'Belgrade', city_tr: 'Belgrad' },
  BEG: { iata: 'BEG', city: 'Belgrade', city_tr: 'Belgrad' },
  LZIB: { iata: 'BTS', city: 'Bratislava', city_tr: 'Bratislava' },
  BTS: { iata: 'BTS', city: 'Bratislava', city_tr: 'Bratislava' },
  ESSA: { iata: 'ARN', city: 'Stockholm', city_tr: 'Stokholm' },
  ARN: { iata: 'ARN', city: 'Stockholm', city_tr: 'Stokholm' },
  LSGG: { iata: 'GVA', city: 'Geneva', city_tr: 'Cenevre' },
  GVA: { iata: 'GVA', city: 'Geneva', city_tr: 'Cenevre' },
  LFSB: { iata: 'BSL', city: 'Basel', city_tr: 'Basel' },
  BSL: { iata: 'BSL', city: 'Basel', city_tr: 'Basel' },
  EGBB: { iata: 'BHX', city: 'Birmingham', city_tr: 'Birmingham' },
  BHX: { iata: 'BHX', city: 'Birmingham', city_tr: 'Birmingham' },
  EGGD: { iata: 'BRS', city: 'Bristol', city_tr: 'Bristol' },
  BRS: { iata: 'BRS', city: 'Bristol', city_tr: 'Bristol' },
  EGSS: { iata: 'STN', city: 'London', city_tr: 'Londra' },
  STN: { iata: 'STN', city: 'London', city_tr: 'Londra' },
  EGCC: { iata: 'MAN', city: 'Manchester', city_tr: 'Manchester' },
  MAN: { iata: 'MAN', city: 'Manchester', city_tr: 'Manchester' },
  EGPH: { iata: 'EDI', city: 'Edinburgh', city_tr: 'Edinburgh' },
  EDI: { iata: 'EDI', city: 'Edinburgh', city_tr: 'Edinburgh' },
  OMAA: { iata: 'AUH', city: 'Abu Dhabi', city_tr: 'Abu Dabi' },
  AUH: { iata: 'AUH', city: 'Abu Dhabi', city_tr: 'Abu Dabi' },
  // Adıyaman, Afyon, Ağrı, Eskişehir, Isparta, Kastamonu, Kocaeli, Sinop, Ordu-Giresun (OGZ)
  LTCP: { iata: 'ADF', city: 'Adıyaman' },
  ADF: { iata: 'ADF', city: 'Adıyaman' },
  LTBY: { iata: 'AFY', city: 'Afyon' },
  AFY: { iata: 'AFY', city: 'Afyon' },
  LTCO: { iata: 'AJI', city: 'Ağrı' },
  AJI: { iata: 'AJI', city: 'Ağrı' },
  AOE: { iata: 'AOE', city: 'Eskişehir' },
  LTFU: { iata: 'ISE', city: 'Isparta' },
  ISE: { iata: 'ISE', city: 'Isparta' },
  LTAL: { iata: 'KFS', city: 'Kastamonu' },
  KFS: { iata: 'KFS', city: 'Kastamonu' },
  LTBQ: { iata: 'KCO', city: 'Kocaeli' },
  KCO: { iata: 'KCO', city: 'Kocaeli' },
  LTCQ: { iata: 'NOP', city: 'Sinop' },
  NOP: { iata: 'NOP', city: 'Sinop' },
  OGZ: { iata: 'OGZ', city: 'Ordu-Giresun' },
  LTGP: { iata: 'GZP', city: 'Gazipaşa' },
  GZP: { iata: 'GZP', city: 'Gazipaşa' },
  LTAP: { iata: 'MZH', city: 'Amasya' },
  MZH: { iata: 'MZH', city: 'Amasya' },
  LTCJ: { iata: 'BAL', city: 'Batman' },
  BAL: { iata: 'BAL', city: 'Batman' },
  LTCU: { iata: 'BGG', city: 'Bingöl' },
  BGG: { iata: 'BGG', city: 'Bingöl' },
  LTFD: { iata: 'EDO', city: 'Edremit' },
  EDO: { iata: 'EDO', city: 'Edremit' },
  LTAY: { iata: 'DNZ', city: 'Denizli' },
  DNZ: { iata: 'DNZ', city: 'Denizli' },
  LTCC: { iata: 'DIY', city: 'Diyarbakır' },
  DIY: { iata: 'DIY', city: 'Diyarbakır' },
  LTCA: { iata: 'EZS', city: 'Elazığ' },
  EZS: { iata: 'EZS', city: 'Elazığ' },
  LTCD: { iata: 'ERC', city: 'Erzincan' },
  ERC: { iata: 'ERC', city: 'Erzincan' },
  LTCE: { iata: 'ERZ', city: 'Erzurum' },
  ERZ: { iata: 'ERZ', city: 'Erzurum' },
  LTAJ: { iata: 'GZT', city: 'Gaziantep' },
  GZT: { iata: 'GZT', city: 'Gaziantep' },
  LTCT: { iata: 'IGD', city: 'Iğdır' },
  IGD: { iata: 'IGD', city: 'Iğdır' },
  LTCN: { iata: 'KCM', city: 'Kahramanmaraş' },
  KCM: { iata: 'KCM', city: 'Kahramanmaraş' },
  LTCF: { iata: 'KSY', city: 'Kars' },
  KSY: { iata: 'KSY', city: 'Kars' },
  LTAU: { iata: 'ASR', city: 'Kayseri' },
  ASR: { iata: 'ASR', city: 'Kayseri' },
  LTAN: { iata: 'KYA', city: 'Konya' },
  KYA: { iata: 'KYA', city: 'Konya' },
  LTBZ: { iata: 'KZR', city: 'Kütahya' },
  KZR: { iata: 'KZR', city: 'Kütahya' },
  LTAT: { iata: 'MLX', city: 'Malatya' },
  MLX: { iata: 'MLX', city: 'Malatya' },
  LTCR: { iata: 'MQM', city: 'Mardin' },
  MQM: { iata: 'MQM', city: 'Mardin' },
  LTCK: { iata: 'MSR', city: 'Muş' },
  MSR: { iata: 'MSR', city: 'Muş' },
  LTCB: { iata: 'OGU', city: 'Ordu' },
  OGU: { iata: 'OGU', city: 'Ordu' },
  LTFV: { iata: 'RZV', city: 'Rize' },
  RZV: { iata: 'RZV', city: 'Rize' },
  LTFH: { iata: 'SZF', city: 'Samsun' },
  SZF: { iata: 'SZF', city: 'Samsun' },
  LTCS: { iata: 'GNY', city: 'Şanlıurfa' },
  GNY: { iata: 'GNY', city: 'Şanlıurfa' },
  SIC: { iata: 'SIC', city: 'Sinop' },
  LTAR: { iata: 'VAS', city: 'Sivas' },
  VAS: { iata: 'VAS', city: 'Sivas' },
  LTFC: { iata: 'TEQ', city: 'Tekirdağ' },
  TEQ: { iata: 'TEQ', city: 'Tekirdağ' },
  LTCI: { iata: 'VAN', city: 'Van' }, // Van Ferit Melen (LTCI was wrongly listed as Izmir before)
  VAN: { iata: 'VAN', city: 'Van' },
};

/** DB satırı şehirsiz / eksikse statik listeden doldur (cache tek başına yeterli değil). */
function mergeDbAndStaticAirport(
  fromDb: AirportDisplay | undefined,
  fromStatic: AirportDisplay | undefined
): AirportDisplay | null {
  if (!fromDb && !fromStatic) return null;
  if (!fromDb) return fromStatic ?? null;
  if (!fromStatic) return fromDb;
  const cityDb = fromDb.city?.trim() ?? '';
  const citySt = fromStatic.city?.trim() ?? '';
  const city_trDb = fromDb.city_tr?.trim() ?? '';
  const city_trSt = fromStatic.city_tr?.trim() ?? '';
  const iataDb = fromDb.iata?.trim() ?? '';
  const iataSt = fromStatic.iata?.trim() ?? '';
  const merged: AirportDisplay = {
    iata: iataDb || iataSt,
    city: cityDb || citySt,
  };
  const tr = city_trDb || city_trSt;
  if (tr) merged.city_tr = tr;
  const tzDb = fromDb.timezone_iana?.trim();
  if (tzDb) merged.timezone_iana = tzDb;
  return merged;
}

export function getAirportDisplay(code: string | null | undefined): AirportDisplay | null {
  if (!code || typeof code !== 'string') return null;
  const key = code.trim().toUpperCase();
  const fromDb = airportDisplayCache.get(key);
  const fromStatic = AIRPORTS[key as keyof typeof AIRPORTS];
  return mergeDbAndStaticAirport(fromDb, fromStatic);
}

/** Format for list: "IATA (City)" or "CODE" if unknown. Pass cityFromDb to prefer stored city. Dil tr ise city_tr kullanılır. */
export function formatAirportForList(
  code: string | null | undefined,
  cityFromDb?: string | null
): string {
  if (!code || !code.trim()) return '—';
  const info = getAirportDisplay(code);
  const city = displayCityName(cityFromDb, info);
  if (info) return city ? `${info.iata} (${city})` : info.iata;
  return cityFromDb?.trim() ? `${code.trim()} (${cityFromDb.trim()})` : code.trim();
}

/** Format for flight list: "City (CODE)" e.g. "İstanbul (IST)". Dil tr ise city_tr kullanılır. */
export function formatCityAndCode(
  code: string | null | undefined,
  cityFromDb?: string | null
): string {
  if (!code || !code.trim()) return '—';
  const info = getAirportDisplay(code);
  const city = displayCityName(cityFromDb, info);
  const codeDisplay = info?.iata ?? code.trim();
  if (city) return `${city} (${codeDisplay})`;
  return codeDisplay;
}

/** Divert satırı: parantez içinde şehir (tr → city_tr); yoksa IATA. */
export function formatDivertDestination(code: string | null | undefined): string {
  if (!code || typeof code !== 'string' || !code.trim()) return '';
  const info = getAirportDisplay(code);
  if (!info) return code.trim().toUpperCase();
  const city = cityForLocale(info as AirportDisplay) || info.city;
  return city || info.iata;
}

/** IANA timezone for airport (code = ICAO or IATA). Used to show local (L) times. */
const AIRPORT_TIMEZONES: Record<string, string> = {
  LTFJ: 'Europe/Istanbul', SAW: 'Europe/Istanbul', LTFM: 'Europe/Istanbul', IST: 'Europe/Istanbul',
  LTAI: 'Europe/Istanbul', AYT: 'Europe/Istanbul', LTBJ: 'Europe/Istanbul', BJV: 'Europe/Istanbul',
  LTBS: 'Europe/Istanbul', DLM: 'Europe/Istanbul', LTFB: 'Europe/Istanbul', ESB: 'Europe/Istanbul',
  LTCI: 'Europe/Istanbul', LTAF: 'Europe/Istanbul', ADB: 'Europe/Istanbul', IZM: 'Europe/Istanbul',
  LTCG: 'Europe/Istanbul', TZX: 'Europe/Istanbul', LTAH: 'Europe/Istanbul', ADA: 'Europe/Istanbul',
  LTDA: 'Europe/Istanbul', HTY: 'Europe/Istanbul',
  LTFE: 'Europe/Istanbul', LTAC: 'Europe/Istanbul', ANK: 'Europe/Istanbul',
  OPKC: 'Asia/Karachi', KHI: 'Asia/Karachi', OPRN: 'Asia/Karachi', ISB: 'Asia/Karachi',
  OPLA: 'Asia/Karachi', LHE: 'Asia/Karachi',
  EDDF: 'Europe/Berlin', FRA: 'Europe/Berlin', EDDM: 'Europe/Berlin', MUC: 'Europe/Berlin',
  EDDL: 'Europe/Berlin', DUS: 'Europe/Berlin',
  EGLL: 'Europe/London', LHR: 'Europe/London', EGKK: 'Europe/London', LGW: 'Europe/London',
  EHAM: 'Europe/Amsterdam', AMS: 'Europe/Amsterdam',
  LFPG: 'Europe/Paris', CDG: 'Europe/Paris', LFLL: 'Europe/Paris', LYS: 'Europe/Paris',
  LEMD: 'Europe/Madrid', MAD: 'Europe/Madrid', LEBL: 'Europe/Madrid', BCN: 'Europe/Madrid',
  LOWW: 'Europe/Vienna', VIE: 'Europe/Vienna', LOWG: 'Europe/Vienna', GRZ: 'Europe/Vienna',
  LSZH: 'Europe/Zurich', ZRH: 'Europe/Zurich',
  OMDB: 'Asia/Dubai', DXB: 'Asia/Dubai', OMSJ: 'Asia/Dubai', SHJ: 'Asia/Dubai',
  OTBD: 'Asia/Qatar', OTHH: 'Asia/Qatar', DOH: 'Asia/Qatar',
  UUEE: 'Europe/Moscow', SVO: 'Europe/Moscow', UUWW: 'Europe/Moscow', VKO: 'Europe/Moscow',
  TUN: 'Africa/Tunis', DTTA: 'Africa/Tunis',
  UTSA: 'Asia/Samarkand', NAV: 'Asia/Samarkand',
  LCLK: 'Asia/Nicosia', LCA: 'Asia/Nicosia', LCRA: 'Asia/Nicosia', PFO: 'Asia/Nicosia',
  OBBI: 'Asia/Bahrain', BAH: 'Asia/Bahrain',
  OKBK: 'Asia/Kuwait', KWI: 'Asia/Kuwait',
  OOMS: 'Asia/Muscat', MCT: 'Asia/Muscat',
  OERK: 'Asia/Riyadh', RUH: 'Asia/Riyadh', OEJN: 'Asia/Riyadh', JED: 'Asia/Riyadh', OEDR: 'Asia/Riyadh', DMM: 'Asia/Riyadh',
  OIIE: 'Asia/Tehran', IKA: 'Asia/Tehran', OTBH: 'Asia/Qatar',
  LGAV: 'Europe/Athens', ATH: 'Europe/Athens', LGRP: 'Europe/Athens', RHO: 'Europe/Athens', LGSA: 'Europe/Athens', CHQ: 'Europe/Athens', LGIR: 'Europe/Athens', HER: 'Europe/Athens',
  LIRF: 'Europe/Rome', FCO: 'Europe/Rome', LIML: 'Europe/Rome', MXP: 'Europe/Rome', LIPZ: 'Europe/Rome', VCE: 'Europe/Rome', LIME: 'Europe/Rome', BGY: 'Europe/Rome',
  LPPT: 'Europe/Lisbon', LIS: 'Europe/Lisbon', LPPR: 'Europe/Lisbon', OPO: 'Europe/Lisbon',
  EBBR: 'Europe/Brussels', BRU: 'Europe/Brussels', EIDW: 'Europe/Dublin', DUB: 'Europe/Dublin',
  KJFK: 'America/New_York', JFK: 'America/New_York', KEWR: 'America/New_York', EWR: 'America/New_York', KIAD: 'America/New_York', IAD: 'America/New_York', KBOS: 'America/New_York', BOS: 'America/New_York',
  KORD: 'America/Chicago', ORD: 'America/Chicago', KDFW: 'America/Chicago', DFW: 'America/Chicago',
  KLAX: 'America/Los_Angeles', LAX: 'America/Los_Angeles', KSFO: 'America/Los_Angeles', SFO: 'America/Los_Angeles', KSEA: 'America/Los_Angeles', SEA: 'America/Los_Angeles',
  KMIA: 'America/New_York', MIA: 'America/New_York', KATL: 'America/New_York', ATL: 'America/New_York', KDEN: 'America/Denver', DEN: 'America/Denver',
  CYYZ: 'America/Toronto', YYZ: 'America/Toronto', CYVR: 'America/Vancouver', YVR: 'America/Vancouver', CYYC: 'America/Edmonton', YYC: 'America/Edmonton',
  VHHH: 'Asia/Hong_Kong', HKG: 'Asia/Hong_Kong',
  WSSS: 'Asia/Singapore', SIN: 'Asia/Singapore',
  VTBS: 'Asia/Bangkok', BKK: 'Asia/Bangkok',
  RJAA: 'Asia/Tokyo', NRT: 'Asia/Tokyo', RJTT: 'Asia/Tokyo', HND: 'Asia/Tokyo',
  ZSPD: 'Asia/Shanghai', PVG: 'Asia/Shanghai',
  VIDP: 'Asia/Kolkata', DEL: 'Asia/Kolkata', VABB: 'Asia/Kolkata', BOM: 'Asia/Kolkata',
  // Pegasus Airlines destinations (all)
  LATI: 'Europe/Tirane', TIA: 'Europe/Tirane',
  DAAG: 'Africa/Algiers', ALG: 'Africa/Algiers',
  UDYZ: 'Asia/Yerevan', EVN: 'Asia/Yerevan',
  UBBB: 'Asia/Baku', GYD: 'Asia/Baku', UBBG: 'Asia/Baku', KVD: 'Asia/Baku',
  EBCI: 'Europe/Brussels', CRL: 'Europe/Brussels',
  LQSA: 'Europe/Sarajevo', SJJ: 'Europe/Sarajevo', LQTZ: 'Europe/Sarajevo', TZL: 'Europe/Sarajevo',
  LBPD: 'Europe/Sofia', PDV: 'Europe/Sofia', LBSF: 'Europe/Sofia', SOF: 'Europe/Sofia',
  LDZA: 'Europe/Zagreb', ZAG: 'Europe/Zagreb',
  LCEN: 'Asia/Nicosia', ECN: 'Asia/Nicosia',
  LKPR: 'Europe/Prague', PRG: 'Europe/Prague',
  EKCH: 'Europe/Copenhagen', CPH: 'Europe/Copenhagen',
  HEBA: 'Africa/Cairo', HBE: 'Africa/Cairo', HEAX: 'Africa/Cairo', SPX: 'Africa/Cairo', HEGN: 'Africa/Cairo', HRG: 'Africa/Cairo', HESH: 'Africa/Cairo', SSH: 'Africa/Cairo',
  EFHK: 'Europe/Helsinki', HEL: 'Europe/Helsinki',
  LFML: 'Europe/Paris', MRS: 'Europe/Paris', LFPO: 'Europe/Paris', ORY: 'Europe/Paris', LFMH: 'Europe/Paris', EBU: 'Europe/Paris',
  EDDB: 'Europe/Berlin', BER: 'Europe/Berlin', EDDW: 'Europe/Berlin', BRE: 'Europe/Berlin', EDDK: 'Europe/Berlin', CGN: 'Europe/Berlin',
  EDLW: 'Europe/Berlin', DTM: 'Europe/Berlin', EDDE: 'Europe/Berlin', ERF: 'Europe/Berlin', EDDH: 'Europe/Berlin', HAM: 'Europe/Berlin',
  EDDV: 'Europe/Berlin', HAJ: 'Europe/Berlin', EDDP: 'Europe/Berlin', LEJ: 'Europe/Berlin', EDDN: 'Europe/Berlin', NUE: 'Europe/Berlin', EDDS: 'Europe/Berlin', STR: 'Europe/Berlin',
  UGSB: 'Asia/Tbilisi', BUS: 'Asia/Tbilisi', UGKO: 'Asia/Tbilisi', KUT: 'Asia/Tbilisi', UGTB: 'Asia/Tbilisi', TBS: 'Asia/Tbilisi',
  LHBP: 'Europe/Budapest', BUD: 'Europe/Budapest',
  OITT: 'Asia/Tehran', TBZ: 'Asia/Tehran',
  ORBI: 'Asia/Baghdad', BGW: 'Asia/Baghdad', ORMM: 'Asia/Baghdad', BSR: 'Asia/Baghdad', ORER: 'Asia/Baghdad', EBL: 'Asia/Baghdad',
  LLBG: 'Asia/Jerusalem', TLV: 'Asia/Jerusalem',
  LIPE: 'Europe/Rome', BLQ: 'Europe/Rome',
  OJAM: 'Asia/Amman', AMM: 'Asia/Amman',
  UAAA: 'Asia/Almaty', ALA: 'Asia/Almaty', UATE: 'Asia/Aqtau', SCO: 'Asia/Aqtau', UATT: 'Asia/Aqtobe', AKX: 'Asia/Aqtobe',
  UACC: 'Asia/Almaty', NQZ: 'Asia/Almaty', UATG: 'Asia/Atyrau', GUW: 'Asia/Atyrau', UAII: 'Asia/Almaty', CIT: 'Asia/Almaty',
  BKPR: 'Europe/Belgrade', PRN: 'Europe/Belgrade',
  UAFM: 'Asia/Bishkek', FRU: 'Asia/Bishkek', UAFO: 'Asia/Bishkek', OSS: 'Asia/Bishkek',
  OLBA: 'Asia/Beirut', BEY: 'Asia/Beirut',
  LUKK: 'Europe/Chisinau', RMO: 'Europe/Chisinau',
  GMMN: 'Africa/Casablanca', CMN: 'Africa/Casablanca',
  EHEH: 'Europe/Amsterdam', EIN: 'Europe/Amsterdam', EHRD: 'Europe/Amsterdam', RTM: 'Europe/Amsterdam',
  LWSK: 'Europe/Skopje', SKP: 'Europe/Skopje',
  ENGM: 'Europe/Oslo', OSL: 'Europe/Oslo',
  EPKK: 'Europe/Warsaw', KRK: 'Europe/Warsaw', EPGD: 'Europe/Warsaw', GDN: 'Europe/Warsaw', EPWA: 'Europe/Warsaw', WAW: 'Europe/Warsaw',
  LROP: 'Europe/Bucharest', OTP: 'Europe/Bucharest',
  UUDD: 'Europe/Moscow', DME: 'Europe/Moscow', ULLI: 'Europe/Moscow', LED: 'Europe/Moscow', URMM: 'Europe/Moscow', MRV: 'Europe/Moscow', URMG: 'Europe/Moscow', GRV: 'Europe/Moscow',
  OEMA: 'Asia/Riyadh', MED: 'Asia/Riyadh',
  LEZL: 'Europe/Madrid', SVQ: 'Europe/Madrid',
  LYBE: 'Europe/Belgrade', BEG: 'Europe/Belgrade',
  LZIB: 'Europe/Bratislava', BTS: 'Europe/Bratislava',
  ESSA: 'Europe/Stockholm', ARN: 'Europe/Stockholm',
  LSGG: 'Europe/Zurich', GVA: 'Europe/Zurich', LFSB: 'Europe/Zurich', BSL: 'Europe/Zurich',
  EGBB: 'Europe/London', BHX: 'Europe/London', EGGD: 'Europe/London', BRS: 'Europe/London', EGSS: 'Europe/London', STN: 'Europe/London', EGCC: 'Europe/London', MAN: 'Europe/London', EGPH: 'Europe/London', EDI: 'Europe/London',
  OMAA: 'Asia/Dubai', AUH: 'Asia/Dubai',
  LTGP: 'Europe/Istanbul', GZP: 'Europe/Istanbul', LTAP: 'Europe/Istanbul', MZH: 'Europe/Istanbul', LTCJ: 'Europe/Istanbul', BAL: 'Europe/Istanbul',
  LTCU: 'Europe/Istanbul', BGG: 'Europe/Istanbul', LTFD: 'Europe/Istanbul', EDO: 'Europe/Istanbul', LTAY: 'Europe/Istanbul', DNZ: 'Europe/Istanbul',
  LTCC: 'Europe/Istanbul', DIY: 'Europe/Istanbul', LTCA: 'Europe/Istanbul', EZS: 'Europe/Istanbul', LTCD: 'Europe/Istanbul', ERC: 'Europe/Istanbul', LTCE: 'Europe/Istanbul', ERZ: 'Europe/Istanbul',
  LTAJ: 'Europe/Istanbul', GZT: 'Europe/Istanbul', LTCT: 'Europe/Istanbul', IGD: 'Europe/Istanbul', LTCN: 'Europe/Istanbul', KCM: 'Europe/Istanbul', LTCF: 'Europe/Istanbul', KSY: 'Europe/Istanbul',
  LTAU: 'Europe/Istanbul', ASR: 'Europe/Istanbul', LTAN: 'Europe/Istanbul', KYA: 'Europe/Istanbul', LTBZ: 'Europe/Istanbul', KZR: 'Europe/Istanbul',
  LTAT: 'Europe/Istanbul', MLX: 'Europe/Istanbul', LTCR: 'Europe/Istanbul', MQM: 'Europe/Istanbul', LTCK: 'Europe/Istanbul', MSR: 'Europe/Istanbul',
  LTCB: 'Europe/Istanbul', OGU: 'Europe/Istanbul', OGZ: 'Europe/Istanbul', LTFU: 'Europe/Istanbul', ISE: 'Europe/Istanbul', LTFV: 'Europe/Istanbul', RZV: 'Europe/Istanbul', LTFH: 'Europe/Istanbul', SZF: 'Europe/Istanbul',
  LTCS: 'Europe/Istanbul', GNY: 'Europe/Istanbul', LTCP: 'Europe/Istanbul', ADF: 'Europe/Istanbul', LTCQ: 'Europe/Istanbul', NOP: 'Europe/Istanbul', SIC: 'Europe/Istanbul', LTAR: 'Europe/Istanbul', VAS: 'Europe/Istanbul',
  LTFC: 'Europe/Istanbul', TEQ: 'Europe/Istanbul', LTCI: 'Europe/Istanbul', VAN: 'Europe/Istanbul',
  LTBY: 'Europe/Istanbul', AFY: 'Europe/Istanbul', LTCO: 'Europe/Istanbul', AJI: 'Europe/Istanbul', AOE: 'Europe/Istanbul', LTBH: 'Europe/Istanbul', CKZ: 'Europe/Istanbul', LTAL: 'Europe/Istanbul', KFS: 'Europe/Istanbul', LTBQ: 'Europe/Istanbul', KCO: 'Europe/Istanbul',
};

export function getAirportTimezone(code: string | null | undefined): string | null {
  if (!code || typeof code !== 'string') return null;
  const key = code.trim().toUpperCase();
  const fromCache = airportDisplayCache.get(key)?.timezone_iana?.trim();
  if (fromCache) return fromCache;
  return AIRPORT_TIMEZONES[key] ?? null;
}
