#!/usr/bin/env node
/**
 * Belirli uçuşlar için PDF dışı tüm sağlayıcılardan anlık yanıt toplar ve HTML rapor üretir.
 *
 *   node scripts/flight-provider-snapshot-report.js
 *
 * `flight_date` her zaman **çalıştırma anındaki yerel takvim günü** (Node sürecinin TZ’si; macOS’ta genelde sistem saati). Argüman yok. Anahtarlar: kök `.env` + `mobile/.env`
 * (AIRLABS / FR24 / AeroDataBox RapidAPI / AeroAPI / FlightAPI).
 * FR24: yalnızca rapor `flight_date` (ymd) ve ertesi gün kalkış meydanı **yerel** gününe uyan bacaklar; aksi halde “Atlandı” (eski land edilmiş bacaklar özet/faza girmez).
 *
 * Çıktı:
 *   - docs/FLIGHT_PROVIDER_SNAPSHOT.html (kartlar + her uçuş için parametre matrisi)
 *   - docs/FLIGHT_PROVIDER_PARAMETERS_SNAPSHOT.html (yalnızca matrisler, `FLIGHT_PROVIDER_PARAMETERS_TABLE` ile aynı kolonlar)
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const OUT_HTML = path.join(projectRoot, 'docs', 'FLIGHT_PROVIDER_SNAPSHOT.html');
const OUT_PARAMS_HTML = path.join(projectRoot, 'docs', 'FLIGHT_PROVIDER_PARAMETERS_SNAPSHOT.html');

const DEFAULT_FLIGHTS = ['PC271', 'PC351', 'PC2018', 'PC1015', 'PC2218'];
const CLI_FLIGHTS = process.argv.slice(2)
  .map((s) => String(s || '').trim().toUpperCase())
  .filter(Boolean);
const TARGET_FLIGHTS = CLI_FLIGHTS.length > 0 ? [...new Set(CLI_FLIGHTS)] : DEFAULT_FLIGHTS;

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  });
}
loadEnv(path.join(projectRoot, '.env'));
loadEnv(path.join(projectRoot, 'mobile', '.env'));

const AIRLABS_KEY = process.env.EXPO_PUBLIC_AIRLABS_API_KEY || process.env.AIRLABS_API_KEY;
const FR24_TOKEN = process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN || process.env.FR24_API_TOKEN;
const AEROAPI_KEY = process.env.AEROAPI_API_KEY || process.env.FLIGHTAWARE_AEROAPI_KEY;
function envTrimmed(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
const FLIGHTAPI_KEY = envTrimmed('FLIGHTAPI_API_KEY', 'EXPO_PUBLIC_FLIGHTAPI_API_KEY', 'FLIGHT_API_KEY') || null;
const SUPABASE_URL = envTrimmed('EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL');
const SUPABASE_SERVICE_KEY = envTrimmed('SUPABASE_SERVICE_ROLE_KEY');
const ADB_KEY =
  process.env.AERODATABOX_RAPIDAPI_KEY ||
  process.env.EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';

const IATA_TO_ICAO = { PC: 'PGT', TK: 'THY', XQ: 'SXS', VF: 'TKJ' };

function variants(flight) {
  const raw = String(flight || '')
    .replace(/\s/g, '')
    .toUpperCase();
  if (!raw || raw.length < 4) return [raw];
  const v = [raw];
  const m = raw.match(/^([A-Z]{2})(\d+)$/);
  if (m) {
    const code = m[1];
    const n = m[2];
    if (n.length === 3) v.push(code + '0' + n);
    if (n.length === 4 && n.startsWith('0')) v.push(code + n.slice(1));
    const icao = IATA_TO_ICAO[code];
    if (icao) {
      v.push(icao + n);
      if (n.length === 3) v.push(icao + '0' + n);
    }
  }
  return [...new Set(v)];
}

/** Çalıştırıldığı gün — yerel saat dilimi (crew roster günü ile hizalı olması için). */
function todayLocalYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const FLIGHT_DATE = todayLocalYmd();

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toUtcIsoAssumeUtc(dt) {
  if (!dt || typeof dt !== 'string') return null;
  let s = dt.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const hasOffset = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasOffset) {
    const noSecs = s.length <= 16;
    s = noSecs ? `${s}:00.000Z` : `${s}Z`;
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Kalkış meydanı yerel günü — `supabase/functions/_shared/fr24FlightDateMatch.ts` ile aynı tablo. */
const FR24_AIRPORT_OFFSET_MINUTES = {
  IST: 180, LTFM: 180, SAW: 180, LTFJ: 180, COV: 180, LTDB: 180, ADB: 180, LTAF: 180, LTBJ: 180, AYT: 180, LTAI: 180,
  ESB: 180, LTFB: 180, BJV: 180, DLM: 180, LTBS: 180, IZM: 180, TZX: 180, ADA: 180,
  GZP: 180, LTGP: 180, ASR: 180, LTAU: 180, KYA: 180, LTAN: 180, GZT: 180, LTAJ: 180,
  VAN: 180, LTCI: 180, ERZ: 180, LTCE: 180, DIY: 180, LTCC: 180, SZF: 180, EDO: 180, LTFD: 180,
  ECN: 120, LCEN: 120, LCA: 120, LCLK: 120, PFO: 120,
  LHR: 0, EGLL: 0, LGW: 0, EGKK: 0, STN: 0, EGSS: 0, MAN: 0, EGCC: 0, EDI: 0, EGPH: 0,
  BHX: 0, EGBB: 0, BRS: 0, EGGD: 0, NCL: 0, EGNT: 0, LPL: 0, EGGP: 0, BFS: 0, EGAA: 0,
  FRA: 60, EDDF: 60, MUC: 60, EDDM: 60, DUS: 60, EDDL: 60, BER: 60, EDDB: 60,
  CDG: 60, LFPG: 60, ORY: 60, LFPO: 60, LYS: 60, MRS: 60,
  MAD: 60, LEMD: 60, BCN: 60, LEBL: 60, SVQ: 60, LEZL: 60,
  AMS: 60, EHAM: 60, BRU: 60, EBBR: 60, ZRH: 60, LSZH: 60, VIE: 60, LOWW: 60,
  PRG: 60, LKPR: 60, CPH: 60, EKCH: 60, HEL: 60, EFHK: 60,
  ATH: 60, LGAV: 60, LIS: 60, LPPT: 60, OPO: 60, DUB: 60, EIDW: 60,
  WAW: 60, EPWA: 60, KRK: 60, EPKK: 60, OSL: 60, ENGM: 60, ARN: 60, ESSA: 60,
  GVA: 60, LSGG: 60, BSL: 60, LFSB: 60, CGN: 60, EDDK: 60, HAM: 60, EDDH: 60,
  STR: 60, EDDS: 60, NUE: 60, EDDN: 60, LEJ: 60, EDDP: 60, EIN: 60, EHEH: 60, RTM: 60, EHRD: 60,
  BLQ: 60, LIPE: 60, BUD: 60, LHBP: 60, BEG: 60, LYBE: 60, BTS: 60, LZIB: 60,
  RHO: 120, HER: 120, CHQ: 120, SKG: 120, LGTS: 120, TIA: 120, LATI: 120,
  ZAG: 120, LDZA: 120, SJJ: 120, LQSA: 120, SOF: 120, LBSF: 120, OTP: 120, LROP: 120,
  SKP: 120, LWSK: 120, PRN: 120, BKPR: 120, KIV: 120, LUKK: 120,
  LCRA: 120,
  DXB: 240, OMDB: 240, SHJ: 240, AUH: 240, OMAA: 240,
  DOH: 180, OTHH: 180, OTBD: 180, BAH: 180, OBBI: 180, KWI: 180, OKBK: 180,
  MCT: 240, OOMS: 240,
  KHI: 300, OPKC: 300, ISB: 300, LHE: 300,
  BGW: 180, ORBI: 180,
  SVO: 180, UUEE: 180, DME: 180, UUDD: 180, LED: 180, ULLI: 180,
};

function fr24UtcToLocalDateAtAirport(utcIso, airportCode) {
  if (!utcIso || !airportCode) return undefined;
  const offsetMin = FR24_AIRPORT_OFFSET_MINUTES[String(airportCode).toUpperCase().trim()] ?? 0;
  const ms = new Date(utcIso).getTime();
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + offsetMin * 60 * 1000).toISOString().slice(0, 10);
}

function nextCalendarYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function fr24LegDepLocalYmd(x) {
  const origin = String(x.orig_icao ?? x.origin_icao ?? x.orig_iata ?? x.origin_iata ?? '').toUpperCase();
  const depScheduled = x.scheduled_departure_utc ?? x.scheduled_departure;
  const first = x.first_seen ?? x.firstSeen;
  const takeoff = x.datetime_takeoff ?? x.datetimeTakeoff;
  const depIso =
    toUtcIsoAssumeUtc(typeof depScheduled === 'string' ? depScheduled : null) ||
    toUtcIsoAssumeUtc(typeof takeoff === 'string' ? takeoff : null) ||
    toUtcIsoAssumeUtc(typeof first === 'string' ? first : null);
  return fr24UtcToLocalDateAtAirport(depIso, origin) || (depIso ? depIso.slice(0, 10) : '');
}

function fr24FilterByRosterOrNextDay(list, rosterYmd) {
  const yNext = nextCalendarYmd(rosterYmd);
  return list.filter((x) => {
    const day = fr24LegDepLocalYmd(x);
    return day === rosterYmd || day === yNext;
  });
}

function pickBestFr24Leg(filtered) {
  if (!filtered.length) return null;
  const live = filtered.find((x) => x?.flight_ended === false || x?.flightEnded === false);
  if (live) return live;
  const score = (x) => {
    const t = x.scheduled_departure_utc ?? x.scheduled_departure ?? x.first_seen ?? x.firstSeen ?? '';
    const iso = toUtcIsoAssumeUtc(String(t));
    const ms = iso ? new Date(iso).getTime() : 0;
    return Number.isNaN(ms) ? 0 : ms;
  };
  return [...filtered].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function parseUtcMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** STD/ETD varsa basit faz tahmini (roster satırı yok; kilit/iniş yok). */
function guessPhaseLabel(stdIso, etdIso, nowMs) {
  const stdMs = parseUtcMs(stdIso);
  if (stdMs <= 0) return 'semi_active? (STD yok)';
  const etdMs = parseUtcMs(etdIso) || stdMs;
  const MS_3H = 3 * 3600000;
  const MS_30M = 30 * 60000;
  if (nowMs < stdMs - MS_3H) return 'passive_future';
  if (nowMs < etdMs - MS_30M) return 'semi_active';
  return 'active';
}

function aeroCoerceTimeString(v) {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object' && typeof v.utc === 'string') return v.utc.trim();
  return null;
}

function aeroRootLegs(root) {
  if (root.departure && root.arrival && typeof root.departure === 'object' && typeof root.arrival === 'object') {
    return { dep: root.departure, arr: root.arrival };
  }
  const departures = Array.isArray(root.departures) ? root.departures : [];
  const arrivals = Array.isArray(root.arrivals) ? root.arrivals : [];
  const depWrap = departures[0] || {};
  const arrWrap = arrivals[0] || {};
  const dep =
    depWrap && typeof depWrap === 'object' && depWrap.departure && typeof depWrap.departure === 'object'
      ? depWrap.departure
      : depWrap;
  const arr =
    arrWrap && typeof arrWrap === 'object' && arrWrap.arrival && typeof arrWrap.arrival === 'object'
      ? arrWrap.arrival
      : arrWrap;
  return { dep: dep || root, arr: arr || root };
}

async function fetchAirLabs(flight) {
  if (!AIRLABS_KEY) return { ok: false, error: 'AIRLABS_API_KEY yok', raw: null, summary: null };
  const tries = variants(flight);
  for (const v of tries) {
    const useIcao = /^[A-Z]{3}\d+$/.test(v);
    const qs = useIcao ? `flight_icao=${encodeURIComponent(v)}` : `flight_iata=${encodeURIComponent(v)}`;
    const url = `https://airlabs.co/api/v9/flight?${qs}&api_key=${encodeURIComponent(AIRLABS_KEY)}`;
    try {
      const res = await fetch(url);
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.error) continue;
      const f = json?.response ?? json;
      if (!f || typeof f !== 'object') continue;
      const summary = {
        flight_iata: f.flight_iata ?? f.flight_icao,
        dep_iata: f.dep_iata,
        dep_icao: f.dep_icao,
        arr_iata: f.arr_iata,
        arr_icao: f.arr_icao,
        dep_time_utc: f.dep_time_utc ?? f.dep_time,
        arr_time_utc: f.arr_time_utc ?? f.arr_time,
        dep_std_iso: toUtcIsoAssumeUtc(f.dep_time_utc ?? f.dep_time),
        arr_sta_iso: toUtcIsoAssumeUtc(f.arr_time_utc ?? f.arr_time),
        dep_estimated_utc: f.dep_estimated_utc ?? f.dep_estimated,
        arr_estimated_utc: f.arr_estimated_utc ?? f.arr_estimated,
        dep_etd_iso: toUtcIsoAssumeUtc(f.dep_estimated_utc ?? f.dep_estimated),
        dep_actual_utc: f.dep_actual_utc ?? f.dep_actual,
        arr_actual_utc: f.arr_actual_utc ?? f.arr_actual,
        status: f.status,
        percent: f.percent,
        dep_delayed: f.dep_delayed,
        arr_delayed: f.arr_delayed,
      };
      return { ok: true, error: null, raw: f, summary };
    } catch (e) {
      return { ok: false, error: e.message, raw: null, summary: null };
    }
  }
  return { ok: false, error: 'Yanıt yok / eşleşme yok', raw: null, summary: null };
}

async function fetchAeroDataBox(flight, ymd) {
  if (!ADB_KEY) return { ok: false, error: 'AeroDataBox key yok', raw: null, summary: null };
  const urls = variants(flight).slice(0, 4).flatMap((v) => [
    `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(ymd)}?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
    `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(ymd)}T00:00?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both`,
  ]);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
          'x-rapidapi-key': ADB_KEY,
        },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) continue;
      const root = Array.isArray(json) ? json[0] : json;
      if (!root || typeof root !== 'object') continue;
      const { dep, arr } = aeroRootLegs(root);
      const depSched =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(dep.scheduledTimeUtc) ||
            aeroCoerceTimeString(dep.scheduledTime) ||
            aeroCoerceTimeString(dep.scheduledTimeLocal),
        ) || null;
      const arrSched =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(arr.scheduledTimeUtc) ||
            aeroCoerceTimeString(arr.scheduledTime) ||
            aeroCoerceTimeString(arr.scheduledTimeLocal),
        ) || null;
      const depEst =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(dep.predictedTimeUtc) ||
            aeroCoerceTimeString(dep.estimatedTimeUtc) ||
            aeroCoerceTimeString(dep.estimatedTime),
        ) || null;
      const arrEst =
        toUtcIsoAssumeUtc(
          aeroCoerceTimeString(arr.predictedTimeUtc) ||
            aeroCoerceTimeString(arr.estimatedTimeUtc) ||
            aeroCoerceTimeString(arr.estimatedTime),
        ) || null;
      const ap = (x) => (x && x.airport && typeof x.airport === 'object' ? x.airport : {});
      const dap = ap(dep);
      const aap = ap(arr);
      const summary = {
        dep_iata: dap.iata,
        dep_icao: dap.icao,
        arr_iata: aap.iata,
        arr_icao: aap.icao,
        scheduled_dep: depSched,
        scheduled_arr: arrSched,
        estimated_dep: depEst,
        estimated_arr: arrEst,
        status: root.status?.text || root.status,
      };
      if (depSched || arrSched || depEst || arrEst || summary.status) {
        return { ok: true, error: null, raw: root, summary };
      }
    } catch (e) {
      return { ok: false, error: e.message, raw: null, summary: null };
    }
  }
  return { ok: false, error: 'Yanıt yok', raw: null, summary: null };
}

async function fetchFr24(flight, ymd) {
  if (!FR24_TOKEN) return { ok: false, error: 'FR24 token yok', raw: null, summary: null };
  const flightsParam = variants(flight).slice(0, 15).join(',');
  const [y, m, d] = ymd.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 2, 0, 0, 0)).toISOString().slice(0, 19);
  const to = new Date(Date.UTC(y, m - 1, d + 2, 23, 59, 59)).toISOString().slice(0, 19);
  const url = `https://fr24api.flightradar24.com/api/flight-summary/light?flight_datetime_from=${encodeURIComponent(from)}&flight_datetime_to=${encodeURIComponent(to)}&flights=${encodeURIComponent(flightsParam)}&limit=20`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${FR24_TOKEN}`,
        Accept: 'application/json',
        'Accept-Version': 'v1',
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `${res.status} ${json?.error || json?.message || ''}`, raw: json, summary: null };
    const list = json?.data || [];
    if (!list.length) return { ok: true, error: null, raw: list, summary: null, legs: 0 };
    const allowed = fr24FilterByRosterOrNextDay(list, ymd);
    if (!allowed.length) {
      const yNext = nextCalendarYmd(ymd);
      return {
        ok: true,
        skipped: true,
        discardReason: `FR24’te ${ymd} veya ${yNext} kalkış (meydan yerel günü) yok; ${list.length} eski bacak yok sayıldı (land → passive akışıyla uyum).`,
        raw: list,
        summary: null,
        legs: 0,
        legsTotal: list.length,
      };
    }
    const f = pickBestFr24Leg(allowed);
    if (!f) {
      return {
        ok: true,
        skipped: true,
        discardReason: `FR24’te ${ymd} / ${nextCalendarYmd(ymd)} filtresinden sonra seçilecek bacak yok.`,
        raw: list,
        summary: null,
        legs: 0,
        legsTotal: list.length,
      };
    }
    const summary = {
      origin: (f.orig_icao ?? f.origin_icao ?? '').toString(),
      destination: (f.dest_icao ?? f.destination_icao ?? f.destination_icao_actual ?? '').toString(),
      flight_ended: f.flight_ended ?? f.flightEnded,
      scheduled_departure_utc: toUtcIsoAssumeUtc(f.scheduled_departure_utc ?? f.scheduled_departure),
      scheduled_arrival_utc: toUtcIsoAssumeUtc(f.scheduled_arrival_utc ?? f.scheduled_arrival),
      first_seen: f.first_seen ?? f.firstSeen,
      last_seen: f.last_seen ?? f.lastSeen,
      datetime_takeoff: f.datetime_takeoff ?? f.datetimeTakeoff,
      datetime_landed: f.datetime_landed ?? f.datetimeLanded,
      dep_local_day: fr24LegDepLocalYmd(f),
    };
    return { ok: true, error: null, raw: allowed, summary, legs: allowed.length };
  } catch (e) {
    return { ok: false, error: e.message, raw: null, summary: null };
  }
}

async function fetchAeroApi(flight, ymd) {
  if (!AEROAPI_KEY) return { ok: false, error: 'AEROAPI_API_KEY yok', raw: null, summary: null };
  const from = new Date(`${ymd}T00:00:00Z`).toISOString();
  const to = new Date(`${ymd}T23:59:59Z`).toISOString();
  for (const ident of variants(flight).slice(0, 6)) {
    const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(ident)}?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}&max_pages=1`;
    try {
      const res = await fetch(url, {
        headers: { 'x-apikey': AEROAPI_KEY, Accept: 'application/json' },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) continue;
      const row = Array.isArray(json?.flights) && json.flights[0] ? json.flights[0] : null;
      if (!row) continue;
      const summary = {
        ident: row.ident_in ?? row.ident,
        origin: row.origin?.code ?? row.origin,
        destination: row.destination?.code ?? row.destination,
        scheduled_out: row.scheduled_out,
        scheduled_in: row.scheduled_in,
        estimated_out: row.estimated_out,
        estimated_in: row.estimated_in,
        actual_out: row.actual_out,
        actual_in: row.actual_in,
        status: row.status,
      };
      return { ok: true, error: null, raw: row, summary };
    } catch (e) {
      return { ok: false, error: e.message, raw: null, summary: null };
    }
  }
  return { ok: false, error: 'Uçuş yok / 4xx', raw: null, summary: null };
}

function parseAnyIsoToUtc(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = new Date(s.trim()).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isDateNearbySnapshot(iso, flightDate) {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  if (d === flightDate) return true;
  const y = Number(flightDate.slice(0, 4));
  const m = Number(flightDate.slice(5, 7)) - 1;
  const day = Number(flightDate.slice(8, 10));
  const prev = new Date(Date.UTC(y, m, day - 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(y, m, day + 1)).toISOString().slice(0, 10);
  return d === prev || d === next;
}

function normalizeOvernightEtaSnapshot(depIso, etaIso) {
  if (!depIso || !etaIso) return etaIso;
  const depMs = new Date(depIso).getTime();
  const etaMs = new Date(etaIso).getTime();
  if (!Number.isFinite(depMs) || !Number.isFinite(etaMs)) return etaIso;
  if (etaMs < depMs) return new Date(etaMs + 24 * 60 * 60 * 1000).toISOString();
  return etaIso;
}

function summarizeFlightApiAirline(payload, flightDate) {
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) rows = payload.data;
    else if (payload.departure || payload.arrival) rows = [payload];
    else if (Array.isArray(payload.flights)) rows = payload.flights;
  }
  if (!rows.length) return null;
  let depLeg = null;
  let arrLeg = null;
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    if (item.departure && typeof item.departure === 'object' && !depLeg) depLeg = item.departure;
    if (item.arrival && typeof item.arrival === 'object' && !arrLeg) arrLeg = item.arrival;
  }
  if (!depLeg && !arrLeg) return null;
  const std = parseAnyIsoToUtc(depLeg?.departureDateTime) || parseAnyIsoToUtc(depLeg?.scheduledTime);
  const etd = parseAnyIsoToUtc(depLeg?.estimatedTime);
  const sta = parseAnyIsoToUtc(arrLeg?.arrivalDateTime) || parseAnyIsoToUtc(arrLeg?.scheduledTime);
  const eta = parseAnyIsoToUtc(arrLeg?.estimatedTime);
  const dep = etd || std;
  const arrRaw = eta || sta;
  const arr = dep && arrRaw ? normalizeOvernightEtaSnapshot(dep, arrRaw) : arrRaw;
  const dateAnchor = dep || std || arr || eta;
  if (dateAnchor && !isDateNearbySnapshot(dateAnchor, flightDate)) return null;
  const origin = depLeg?.airportCode ? String(depLeg.airportCode).toUpperCase() : '';
  const destination = arrLeg?.airportCode ? String(arrLeg.airportCode).toUpperCase() : '';
  if (!dep && !arr && !origin && !destination) return null;
  return {
    origin: origin || null,
    destination: destination || null,
    origin_city: depLeg?.airportCity || null,
    destination_city: arrLeg?.airportCity || null,
    scheduled_dep: dep,
    scheduled_arr: arr,
    dep_raw_scheduled: depLeg?.scheduledTime || null,
    arr_raw_scheduled: arrLeg?.scheduledTime || null,
  };
}

async function fetchFlightApi(flight, ymd) {
  if (!FLIGHTAPI_KEY) {
    return {
      ok: false,
      error: 'Anahtar yok — .env veya mobile/.env içinde FLIGHTAPI_API_KEY veya EXPO_PUBLIC_FLIGHTAPI_API_KEY tanımla',
      raw: null,
      summary: null,
    };
  }
  const raw = String(flight).replace(/\s/g, '').toUpperCase();
  const m = raw.match(/^([A-Z]{2})(\d+)$/);
  if (!m) return { ok: false, error: 'Beklenen format: IATA + numara (örn. PC271)', raw: null, summary: null };
  const airline = m[1];
  const numStr = String(parseInt(m[2], 10));
  const dateCompact = ymd.replace(/-/g, '');
  const urls = [
    `https://api.flightapi.io/airline/${encodeURIComponent(FLIGHTAPI_KEY)}?num=${encodeURIComponent(numStr)}&name=${encodeURIComponent(airline)}&date=${encodeURIComponent(dateCompact)}`,
  ];
  const icao = IATA_TO_ICAO[airline];
  if (icao) {
    urls.push(
      `https://api.flightapi.io/airline/${encodeURIComponent(FLIGHTAPI_KEY)}?num=${encodeURIComponent(numStr)}&name=${encodeURIComponent(icao)}&date=${encodeURIComponent(dateCompact)}`,
    );
  }
  let lastErr = null;
  let lastBody = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      lastBody = json ?? text?.slice(0, 800) ?? null;
      const apiMsg =
        json && typeof json === 'object' && typeof json.message === 'string' ? json.message : null;
      if (json && json.success === false && apiMsg) {
        lastErr = apiMsg;
        continue;
      }
      if (!res.ok) {
        lastErr = apiMsg ? `${res.status}: ${apiMsg}` : `${res.status}`;
        continue;
      }
      const summary = summarizeFlightApiAirline(json, ymd);
      if (summary) return { ok: true, error: null, raw: json, summary };
      lastErr = apiMsg || 'Eşleşme yok (tarih/rota / yanıt şekli)';
    } catch (e) {
      lastErr = e.message;
    }
  }
  return { ok: false, error: lastErr || 'Yanıt yok', raw: lastBody, summary: null };
}

function summaryTable(obj) {
  if (!obj || typeof obj !== 'object') return '<p class="muted">—</p>';
  const rows = Object.entries(obj)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`)
    .join('');
  return rows ? `<table class="kv"><tbody>${rows}</tbody></table>` : '<p class="muted">Özet alan boş</p>';
}

function rawBlock(label, data) {
  const str = data == null ? '' : JSON.stringify(data, null, 2);
  const clipped = str.length > 12000 ? str.slice(0, 12000) + '\n… (kırpıldı)' : str;
  return `<details class="raw"><summary>${esc(label)} — ham JSON</summary><pre>${esc(clipped)}</pre></details>`;
}

async function fetchDbFlightRow(flightNumber, ymd) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { row: null, skipReason: 'SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY yok (.env)' };
  }
  const fn = String(flightNumber || '')
    .replace(/\s/g, '')
    .toUpperCase();
  try {
    const base = SUPABASE_URL.replace(/\/$/, '');
    const u = new URL(`${base}/rest/v1/flights`);
    u.searchParams.set('flight_number', `eq.${fn}`);
    u.searchParams.set('flight_date', `eq.${ymd}`);
    u.searchParams.set('select', '*');
    u.searchParams.set('order', 'updated_at.desc');
    u.searchParams.set('limit', '1');
    const res = await fetch(u.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Accept: 'application/json',
      },
    });
    const arr = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = Array.isArray(arr) ? JSON.stringify(arr) : String(arr ?? res.status);
      return { row: null, skipReason: `REST ${res.status}: ${msg.slice(0, 200)}` };
    }
    if (!Array.isArray(arr) || !arr[0]) {
      return { row: null, skipReason: 'Bu flight_number + flight_date için satır yok' };
    }
    return { row: arr[0], skipReason: null };
  } catch (e) {
    return { row: null, skipReason: e.message || 'Supabase istek hatası' };
  }
}

function dash(v) {
  if (v == null || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.trim() ? esc(s) : '—';
}

function airlabsRaw(r) {
  return r?.al?.raw && typeof r.al.raw === 'object' ? r.al.raw : null;
}

function airlabsArrEtaIso(r) {
  const f = airlabsRaw(r);
  if (!f) return null;
  return toUtcIsoAssumeUtc(f.arr_estimated_utc ?? f.arr_estimated);
}

function adbFlightLabel(r) {
  return r?.adb?.ok && r.adb.summary ? dash(r.flight) : '—';
}

function buildFlightParameterMatrix(r) {
  const db = r.db?.row;
  const al = r.al?.summary;
  const alR = airlabsRaw(r);
  const adb = r.adb?.summary;
  const fr = r.fr?.skipped ? null : r.fr?.summary;
  const aero = r.aero?.summary;
  const fapi = r.fapi?.summary;
  const dbNote = r.db?.skipReason && !db ? `<p class="matrix-note">${esc(r.db.skipReason)}</p>` : '';

  const rows = [
    ['1', 'Uçuş kodu', dash(db?.flight_number), dash(al?.flight_iata), adbFlightLabel(r), dash(r.flight), dash(aero?.ident), dash(r.flight)],
    [
      '2',
      'Kalkış meydanı (IATA/ICAO)',
      dash(db?.origin_airport),
      dash([al?.dep_iata, al?.dep_icao].filter(Boolean).join(' / ') || null),
      dash([adb?.dep_iata, adb?.dep_icao].filter(Boolean).join(' / ') || null),
      dash(fr?.origin),
      dash(aero?.origin),
      dash(fapi?.origin),
    ],
    [
      '3',
      'Varış meydanı (IATA/ICAO)',
      dash(db?.destination_airport),
      dash([al?.arr_iata, al?.arr_icao].filter(Boolean).join(' / ') || null),
      dash([adb?.arr_iata, adb?.arr_icao].filter(Boolean).join(' / ') || null),
      dash(fr?.destination),
      dash(aero?.destination),
      dash(fapi?.destination),
    ],
    [
      '4',
      'STD (UTC)',
      dash(db?.scheduled_departure),
      dash(al?.dep_std_iso ?? al?.dep_time_utc),
      dash(adb?.scheduled_dep),
      dash(fr?.scheduled_departure_utc),
      dash(aero?.scheduled_out ? toUtcIsoAssumeUtc(aero.scheduled_out) : null),
      dash(fapi?.scheduled_dep),
    ],
    [
      '5',
      'STA (UTC)',
      dash(db?.scheduled_arrival),
      dash(al?.arr_sta_iso ?? al?.arr_time_utc),
      dash(adb?.scheduled_arr),
      dash(fr?.scheduled_arrival_utc),
      dash(aero?.scheduled_in ? toUtcIsoAssumeUtc(aero.scheduled_in) : null),
      dash(fapi?.scheduled_arr),
    ],
    [
      '6',
      'ETD (UTC)',
      dash(db?.estimated_departure),
      dash(al?.dep_etd_iso ?? (alR ? toUtcIsoAssumeUtc(alR.dep_estimated_utc ?? alR.dep_estimated) : null)),
      dash(adb?.estimated_dep),
      '—',
      dash(aero?.estimated_out ? toUtcIsoAssumeUtc(aero.estimated_out) : null),
      '—',
    ],
    [
      '7',
      'ETA (UTC)',
      dash(db?.estimated_arrival),
      dash(airlabsArrEtaIso(r)),
      dash(adb?.estimated_arr),
      '—',
      dash(aero?.estimated_in ? toUtcIsoAssumeUtc(aero.estimated_in) : null),
      '—',
    ],
    [
      '8',
      'ATD (UTC)',
      dash(db?.actual_departure),
      dash(toUtcIsoAssumeUtc(al?.dep_actual_utc) ?? (alR ? toUtcIsoAssumeUtc(alR.dep_actual_utc ?? alR.dep_actual) : null)),
      '—',
      dash(fr?.datetime_takeoff),
      dash(aero?.actual_out ? toUtcIsoAssumeUtc(aero.actual_out) : null),
      '—',
    ],
    [
      '9',
      'ATA (UTC)',
      dash(db?.actual_arrival ?? db?.fr24_datetime_landed_utc),
      dash(toUtcIsoAssumeUtc(al?.arr_actual_utc) ?? (alR ? toUtcIsoAssumeUtc(alR.arr_actual_utc ?? alR.arr_actual) : null)),
      '—',
      dash(fr?.datetime_landed),
      dash(aero?.actual_in ? toUtcIsoAssumeUtc(aero.actual_in) : null),
      '—',
    ],
    ['10', 'Anormal durum (iptal / aktarma)', dash(db?.flight_status), dash(al?.status), dash(adb?.status), '—', dash(aero?.status), '—'],
    ['11', 'Transponder açılış (UTC)', '—', '—', '—', dash(fr?.first_seen), '—', '—'],
    [
      '12',
      'Kalkış zamanı (UTC) (operasyonel)',
      dash(db?.fr24_progress_dep_utc ?? db?.actual_departure),
      '—',
      '—',
      dash(fr?.datetime_takeoff),
      '—',
      '—',
    ],
    [
      '13',
      'İniş zamanı (UTC) (operasyonel)',
      dash(db?.fr24_datetime_landed_utc ?? db?.actual_arrival),
      '—',
      '—',
      dash(fr?.datetime_landed),
      '—',
      '—',
    ],
    ['14', 'Son görülme / transponder kapanış (UTC)', dash(db?.last_seen_utc), '—', '—', dash(fr?.last_seen), '—', '—'],
    [
      '15',
      '`api_refresh_phase` · `phase_active_locked`',
      dash(
        db?.api_refresh_phase != null || db?.phase_active_locked != null
          ? `${db.api_refresh_phase ?? '—'} · locked=${db.phase_active_locked ?? '—'}`
          : null,
      ),
      '—',
      '—',
      '—',
      '—',
      '—',
    ],
  ];

  const body = rows
    .map(
      ([no, label, pdf, cAl, cAdb, cFr, cAe, cFa]) =>
        `<tr><td class="num">${esc(no)}</td><td class="lbl">${esc(label)}</td><td class="pdf">${pdf}</td><td>${cAl}</td><td>${cAdb}</td><td>${cFr}</td><td>${cAe}</td><td>${cFa}</td></tr>`,
    )
    .join('');

  return `<div class="param-matrix">
    <h3>Parametre × kaynak <span class="matrix-date">(${esc(FLIGHT_DATE)})</span></h3>
    ${dbNote}
    <div class="matrix-scroll">
      <table class="matrix">
        <thead>
          <tr>
            <th class="num">No</th>
            <th class="lbl">Parametre</th>
            <th class="pdf">PDF / DB <code>flights</code></th>
            <th>AirLabs</th>
            <th>AeroDataBox</th>
            <th>FR24 light</th>
            <th>AeroAPI</th>
            <th>FlightAPI</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="matrix-foot">PDF sütunu: Supabase <code>flights</code> (ilk eşleşen satır). Satır 15 yalnızca DB tetikleyicisi; API’ler doğrudan yazmaz.</p>
  </div>`;
}

async function snapshotFlight(flight) {
  const [al, adb, fr, aero, fapi, db] = await Promise.all([
    fetchAirLabs(flight),
    fetchAeroDataBox(flight, FLIGHT_DATE),
    fetchFr24(flight, FLIGHT_DATE),
    fetchAeroApi(flight, FLIGHT_DATE),
    fetchFlightApi(flight, FLIGHT_DATE),
    fetchDbFlightRow(flight, FLIGHT_DATE),
  ]);

  const nowMs = Date.now();
  const stdIso =
    al.summary?.dep_std_iso ||
    (!fr.skipped && fr.summary?.scheduled_departure_utc) ||
    (aero.summary?.scheduled_out ? toUtcIsoAssumeUtc(aero.summary.scheduled_out) : null) ||
    adb.summary?.scheduled_dep ||
    fapi.summary?.scheduled_dep ||
    null;
  const etdIso =
    al.summary?.dep_etd_iso ||
    (aero.summary?.estimated_out ? toUtcIsoAssumeUtc(aero.summary.estimated_out) : null) ||
    adb.summary?.estimated_dep ||
    stdIso;
  const phaseHint = guessPhaseLabel(stdIso, etdIso, nowMs);

  return { flight, al, adb, fr, aero, fapi, db, phaseHint, generatedAt: new Date().toISOString() };
}

function buildHtml(results) {
  const keyRow = `
    <tr><td>AirLabs</td><td>${AIRLABS_KEY ? '✓' : '—'}</td></tr>
    <tr><td>FR24</td><td>${FR24_TOKEN ? '✓' : '—'}</td></tr>
    <tr><td>AeroDataBox</td><td>${ADB_KEY ? '✓' : '—'}</td></tr>
    <tr><td>AeroAPI</td><td>${AEROAPI_KEY ? '✓' : '—'}</td></tr>
    <tr><td>FlightAPI</td><td>${FLIGHTAPI_KEY ? '✓' : '—'}</td></tr>
    <tr><td>Supabase <code>flights</code></td><td>${SUPABASE_URL && SUPABASE_SERVICE_KEY ? '✓' : '—'}</td></tr>
  `;

  const flightsHtml = results
    .map((r) => {
      const blocks = [
        ['PDF import', { not: 'Bu rapor sadece API; roster PDF verisi yok.' }],
        ['AirLabs /flight', r.al],
        ['AeroDataBox', r.adb],
        ['FR24 light', r.fr],
        ['AeroAPI', r.aero],
        ['FlightAPI airline', r.fapi],
      ]
        .map(([name, pack]) => {
          const ok = pack.not ? true : pack.ok;
          const err = pack.error;
          const sum = pack.summary;
          const raw = pack.not ? null : pack.raw;
          const badgeClass = pack.not ? 'pdf' : pack.skipped ? 'skip' : ok ? 'ok' : 'bad';
          const badgeLabel = pack.not ? 'PDF' : pack.skipped ? 'Atlandı' : ok ? 'OK' : 'Hata';
          const head = `<span class="badge b-${badgeClass}">${badgeLabel}</span>`;
          const sub = err && !pack.not && !pack.skipped ? `<p class="err">${esc(err)}</p>` : '';
          const skipNote = pack.discardReason ? `<p class="muted">${esc(pack.discardReason)}</p>` : '';
          return `<div class="src">
            <h4>${esc(name)} ${head}</h4>
            ${sub}
            ${skipNote}
            ${pack.not ? `<p class="muted">${esc(pack.not)}</p>` : summaryTable(sum)}
            ${!pack.not ? rawBlock(name, raw) : ''}
          </div>`;
        })
        .join('');

      return `<section class="flight-card">
        <h2>${esc(r.flight)} <span class="date">${esc(FLIGHT_DATE)}</span></h2>
        <p class="phase-hint">Basit faz tahmini (STD/ETD’ye göre, iniş/kilit yok): <code>${esc(r.phaseHint)}</code> · ${esc(r.generatedAt)}</p>
        <div class="grid">${blocks}</div>
        ${buildFlightParameterMatrix(r)}
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>FlyFam — Sağlayıcı snapshot</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 24px; line-height: 1.5; }
  .page-header { background: #0f172a; color: #fff; padding: 20px 24px; margin: -24px -24px 24px -24px; }
  .page-header h1 { font-size: 18px; margin: 0; }
  .page-header p { font-size: 12px; color: #94a3b8; margin: 8px 0 0; max-width: 900px; }
  .meta { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; font-size: 13px; }
  .meta table { border-collapse: collapse; }
  .meta td { padding: 4px 16px 4px 0; }
  .flight-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; }
  .flight-card h2 { margin: 0 0 8px; font-size: 17px; }
  .flight-card .date { font-weight: 400; color: #64748b; font-size: 14px; }
  .phase-hint { font-size: 12px; color: #64748b; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .src { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #fafafa; }
  .src h4 { margin: 0 0 8px; font-size: 13px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .b-ok { background: #dcfce7; color: #15803d; }
  .b-bad { background: #fee2e2; color: #b91c1c; }
  .b-pdf { background: #e0f2fe; color: #0369a1; }
  .b-skip { background: #fef3c7; color: #92400e; }
  .kv { width: 100%; font-size: 11px; border-collapse: collapse; }
  .kv td { padding: 4px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  .kv td:first-child { color: #64748b; width: 42%; }
  .muted { color: #94a3b8; font-size: 12px; margin: 0; }
  .err { color: #b91c1c; font-size: 12px; margin: 0 0 8px; }
  .raw { margin-top: 8px; font-size: 11px; }
  .raw pre { background: #1e293b; color: #e2e8f0; padding: 10px; border-radius: 6px; overflow: auto; max-height: 220px; margin: 6px 0 0; }
  .footer { font-size: 11px; color: #94a3b8; margin-top: 24px; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
  .param-matrix { margin-top: 22px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
  .param-matrix h3 { font-size: 14px; margin: 0 0 10px; color: #0f172a; }
  .matrix-date { font-weight: 400; color: #64748b; font-size: 12px; }
  .matrix-note { font-size: 11px; color: #b45309; margin: 0 0 10px; }
  .matrix-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -4px; }
  table.matrix { width: 100%; min-width: 920px; border-collapse: collapse; font-size: 10px; }
  table.matrix th, table.matrix td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  table.matrix th { background: #1e293b; color: #f8fafc; font-weight: 600; white-space: nowrap; }
  table.matrix th.pdf, table.matrix td.pdf { background: #f0fdf4; border-left: 2px solid #86efac; border-right: 1px solid #bbf7d0; }
  table.matrix th.num, table.matrix td.num { width: 28px; text-align: center; color: #64748b; font-weight: 700; }
  table.matrix th.lbl, table.matrix td.lbl { min-width: 140px; font-weight: 600; color: #334155; }
  table.matrix tbody tr:nth-child(even) td { background: #fafafa; }
  table.matrix tbody tr:nth-child(even) td.pdf { background: #ecfdf5; }
  .matrix-foot { font-size: 10px; color: #94a3b8; margin: 10px 0 0; }
</style>
</head>
<body>
<header class="page-header">
  <h1>Sağlayıcı snapshot — ${esc(FLIGHT_DATE)}</h1>
  <p>Otomatik üretildi: <code>node scripts/flight-provider-snapshot-report.js</code> · Uçuşlar: ${esc(TARGET_FLIGHTS.join(', '))}</p>
</header>
<div class="meta">
  <strong>Anahtar özeti</strong>
  <table>${keyRow}</table>
</div>
${flightsHtml}
<p class="footer">docs/FLIGHT_PROVIDER_SNAPSHOT.html · docs/FLIGHT_PROVIDER_PARAMETERS_SNAPSHOT.html — ham yanıtlar kaynakta farklı hassasiyet ve isimlendirme gösterebilir.</p>
</body>
</html>`;
}

function buildParametersSnapshotOnlyHtml(results) {
  const matrices = results
    .map(
      (r) =>
        `<section class="flight-card">
        <h2>${esc(r.flight)} <span class="date">${esc(FLIGHT_DATE)}</span></h2>
        <p class="phase-hint">Faz (basit): <code>${esc(r.phaseHint)}</code> · ${esc(r.generatedAt)}</p>
        ${buildFlightParameterMatrix(r)}
      </section>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>FlyFam — Parametre matrisi (snapshot)</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 24px; line-height: 1.5; }
  .page-header { background: #0f172a; color: #fff; padding: 22px 24px; margin: -24px -24px 24px -24px; }
  .page-header h1 { font-size: 18px; margin: 0; }
  .page-header p { font-size: 12px; color: #94a3b8; margin: 8px 0 0; max-width: 960px; }
  .flight-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; }
  .flight-card h2 { margin: 0 0 8px; font-size: 17px; }
  .flight-card .date { font-weight: 400; color: #64748b; font-size: 14px; }
  .phase-hint { font-size: 12px; color: #64748b; margin: 0 0 16px; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
  .param-matrix { margin-top: 4px; }
  .param-matrix h3 { font-size: 14px; margin: 0 0 10px; color: #0f172a; }
  .matrix-date { font-weight: 400; color: #64748b; font-size: 12px; }
  .matrix-note { font-size: 11px; color: #b45309; margin: 0 0 10px; }
  .matrix-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -4px; }
  table.matrix { width: 100%; min-width: 920px; border-collapse: collapse; font-size: 10px; }
  table.matrix th, table.matrix td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  table.matrix th { background: #1e293b; color: #f8fafc; font-weight: 600; white-space: nowrap; }
  table.matrix th.pdf, table.matrix td.pdf { background: #f0fdf4; border-left: 2px solid #86efac; border-right: 1px solid #bbf7d0; }
  table.matrix th.num, table.matrix td.num { width: 28px; text-align: center; color: #64748b; font-weight: 700; }
  table.matrix th.lbl, table.matrix td.lbl { min-width: 140px; font-weight: 600; color: #334155; }
  table.matrix tbody tr:nth-child(even) td { background: #fafafa; }
  table.matrix tbody tr:nth-child(even) td.pdf { background: #ecfdf5; }
  .matrix-foot { font-size: 10px; color: #94a3b8; margin: 10px 0 0; }
  .footer { font-size: 11px; color: #94a3b8; margin-top: 24px; }
</style>
</head>
<body>
<header class="page-header">
  <h1>Parametre × sağlayıcı — canlı snapshot</h1>
  <p><code>node scripts/flight-provider-snapshot-report.js</code> · Tarih: <strong>${esc(FLIGHT_DATE)}</strong> · Uçuşlar: ${esc(TARGET_FLIGHTS.join(', '))}. PDF/DB sütunu: Supabase <code>flights</code> (service role). Şema ile uyum: <code>docs/FLIGHT_PROVIDER_PARAMETERS_TABLE.md</code>.</p>
</header>
${matrices}
<p class="footer">docs/FLIGHT_PROVIDER_PARAMETERS_SNAPSHOT.html</p>
</body>
</html>`;
}

async function main() {
  console.log('flight_date (yerel çalıştırma günü):', FLIGHT_DATE);
  console.log('Uçuşlar:', TARGET_FLIGHTS.join(', '));
  const results = [];
  for (let i = 0; i < TARGET_FLIGHTS.length; i++) {
    const f = TARGET_FLIGHTS[i];
    process.stdout.write(`  ${f} … `);
    const r = await snapshotFlight(f);
    results.push(r);
    console.log('tamam');
    if (i < TARGET_FLIGHTS.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
  const html = buildHtml(results);
  const paramsHtml = buildParametersSnapshotOnlyHtml(results);
  fs.writeFileSync(OUT_HTML, html, 'utf8');
  fs.writeFileSync(OUT_PARAMS_HTML, paramsHtml, 'utf8');
  console.log('\nYazıldı:', OUT_HTML);
  console.log('Yazıldı:', OUT_PARAMS_HTML);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
