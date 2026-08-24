/**
 * AeroDataBox hub kalkış/varış tahtaları — mobil airportBoardCache ile aynı uç noktalar.
 */
import {
  AERODATABOX_RAPIDAPI_BASE,
  aerodataboxUrlForProvider,
  parseAerodataboxBoardJson,
  readAerodataboxProvidersFromEnv,
} from './aerodataboxHttp.ts';
import {
  istanbulCalendarDate,
  istanbulSlotKey,
  nextCalendarDayYmd,
} from './hubAirportBoardIstanbul.ts';

export const HUB_AIRPORT_BOARD_HUBS_IATA = ['SAW', 'IST', 'AYT', 'ESB', 'ADB', 'ECN'] as const;

const BASE = AERODATABOX_RAPIDAPI_BASE;
const COMMON =
  'withLeg=true&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false';

function envInt(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 0 geçerli (ör. ikinci 429 beklemesini kapatmak için). */
function envIntNonNegative(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Edge runtime’da AbortSignal.timeout her sürümde yok; TypeError → tüm istek boş dönüyordu. */
function fetchWithTimeout(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(t));
}

const LEG_TIME_KEYS = [
  'scheduledTimeUtc',
  'scheduledTime',
  'scheduledTimeLocal',
  'predictedTimeUtc',
  'predictedTime',
  'estimatedTimeUtc',
  'estimatedTime',
  'expectedTimeUtc',
  'expectedTime',
  'actualTimeUtc',
  'actualTime',
  'runwayTimeUtc',
  'iata',
  'icao',
  'terminal',
  'gate',
] as const;

function slimAirport(ap: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['iata', 'icao', 'name', 'municipalityName', 'countryCode', 'timeZone']) {
    if (k in ap) out[k] = ap[k];
  }
  return out;
}

function slimLeg(leg: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!leg || typeof leg !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const k of LEG_TIME_KEYS) {
    if (k in leg) out[k] = leg[k];
  }
  if (leg.airport && typeof leg.airport === 'object' && !Array.isArray(leg.airport)) {
    out.airport = slimAirport(leg.airport as Record<string, unknown>);
  }
  return out;
}

/** PostgREST / ağ limiti: tahta satırından uçak/görsel vb. atılır; mobil flightInfoFromAeroDataBoxRoot için yeterli. */
function slimBoardRowForDb(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (row.number != null) out.number = row.number;
  if (row.status != null) out.status = row.status;
  if (row.airline != null) out.airline = row.airline;
  const dep = slimLeg(row.departure as Record<string, unknown> | undefined);
  const arr = slimLeg(row.arrival as Record<string, unknown> | undefined);
  if (dep) out.departure = dep;
  if (arr) out.arrival = arr;
  return out;
}

/**
 * RapidAPI 429: varsayılan concurrency 1, kısa batch aralığı, HUB_BOARD_MAX_WALL_MS ile Edge timeout önlenir.
 * HUB_BOARD_FETCH_CONCURRENCY / HUB_BOARD_BATCH_GAP_MS / HUB_BOARD_AFTER_429_COOLDOWN_MS / HUB_BOARD_429_SECOND_WAIT_MS.
 */
function resolveFetchTuning(_urlCount: number): {
  concurrency: number;
  batchGapMs: number;
  requestTimeoutMs: number;
  after429CooldownMs: number;
  second429WaitMs: number;
} {
  let concurrency = envInt('HUB_BOARD_FETCH_CONCURRENCY', 0);
  if (!concurrency) {
    concurrency = 1;
  }
  /** Sıralı (concurrency 1) iken ~30 sn cron için 12 URL ≈ 11*gap + istek süreleri; 429 sonrası ek beklemeler süreyi uzatır. */
  const batchGapMs = envInt('HUB_BOARD_BATCH_GAP_MS', 700);
  const requestTimeoutMs = envInt('HUB_BOARD_REQUEST_TIMEOUT_MS', 12000);
  const after429CooldownMs = envInt('HUB_BOARD_AFTER_429_COOLDOWN_MS', 2500);
  /** Varsayılan 0: üçüncü deneme yok (Edge ~30 sn + 429 uyku timeout yapıyor). >0 ile açılır. */
  const second429WaitMs = envIntNonNegative('HUB_BOARD_429_SECOND_WAIT_MS', 0);
  return { concurrency, batchGapMs, requestTimeoutMs, after429CooldownMs, second429WaitMs };
}

/** Edge/cron ~30 sn: ADB aşaması için üst süre; 0 = sınırsız. */
function resolveMaxWallMsForFetch(): number {
  const v = Deno.env.get('HUB_BOARD_MAX_WALL_MS');
  if (v === undefined || v === '') return 22_000;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Varsayılan: her çalışmada 3 hub (12 URL/gün); saat dilimine göre döner — 6 hub ~2 saatte tamamlanır, DB’de birleştirilir. */
export function getHubBoardHubsForRun(now: Date = new Date()): string[] {
  const all = [...HUB_AIRPORT_BOARD_HUBS_IATA];
  const maxPer = envInt('HUB_BOARD_MAX_HUBS', 3);
  if (maxPer >= all.length) return all;
  const rotateHours = envInt('HUB_BOARD_ROTATE_HOURS', 1);
  const periodMs = rotateHours * 3600_000;
  const bucket = Math.floor(now.getTime() / periodMs);
  const periods = Math.ceil(all.length / maxPer);
  const rot = bucket % periods;
  const start = rot * maxPer;
  return all.slice(start, start + maxPer);
}

function rowCacheKey(row: Record<string, unknown>): string {
  const n = String(row.number ?? '')
    .replace(/\s/g, '')
    .toUpperCase();
  const dep = row.departure as Record<string, unknown> | undefined;
  const arr = row.arrival as Record<string, unknown> | undefined;
  const ds =
    typeof dep?.scheduledTimeUtc === 'string'
      ? dep.scheduledTimeUtc
      : typeof dep?.scheduledTime === 'string'
        ? dep.scheduledTime
        : '';
  const ar =
    typeof arr?.scheduledTimeUtc === 'string'
      ? arr.scheduledTimeUtc
      : typeof arr?.scheduledTime === 'string'
        ? arr.scheduledTime
        : '';
  return `${n}|${ds.slice(0, 19)}|${ar.slice(0, 19)}`;
}

/** Mobil `rowCacheKey` ile aynı; Edge birleştirme için. */
export function hubBoardRowCacheKey(row: Record<string, unknown>): string {
  return rowCacheKey(row);
}

function buildJobsForDay(hub: string, day: string): { url: string }[] {
  const next = nextCalendarDayYmd(day);
  return [
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T00:00/${day}T12:00?direction=Arrival&${COMMON}`,
    },
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T12:00/${next}T00:00?direction=Arrival&${COMMON}`,
    },
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T00:00/${day}T12:00?direction=Departure&${COMMON}`,
    },
    {
      url: `${BASE}/flights/airports/iata/${hub}/${day}T12:00/${next}T00:00?direction=Departure&${COMMON}`,
    },
  ];
}

function retryAfterMs(res: Response, fallbackMs: number): number {
  const ra = res.headers.get('Retry-After');
  if (ra) {
    const sec = parseInt(ra, 10);
    if (Number.isFinite(sec)) return Math.min(30_000, Math.max(2000, sec * 1000));
  }
  return fallbackMs;
}

function remainingMs(deadline: number): number {
  if (!Number.isFinite(deadline)) return 1_000_000;
  return Math.max(0, deadline - Date.now());
}

async function sleepWithinBudget(ms: number, deadline: number): Promise<boolean> {
  const r = remainingMs(deadline);
  if (r < 400) return false;
  const wait = Math.min(ms, r - 300);
  if (wait <= 0) return false;
  await sleep(wait);
  return true;
}

async function fetchBoardOnce(
  url: string,
  headers: Record<string, string>,
  requestTimeoutMs: number,
  second429WaitMs: number,
  deadline: number,
): Promise<{ rows: Record<string, unknown>[]; saw429: boolean; ok: boolean }> {
  const doFetch = () => fetchWithTimeout(url, { headers }, requestTimeoutMs);
  let saw429 = false;
  let res = await doFetch();
  if (res.status === 429) {
    saw429 = true;
    let waitMs = retryAfterMs(res, 2500);
    const r = remainingMs(deadline);
    waitMs = Math.min(waitMs, Math.max(0, r - 1200));
    if (waitMs < 900 || r < 1500) {
      return { rows: [], saw429: true, ok: false };
    }
    await sleep(waitMs);
    res = await doFetch();
  }
  if (res.status === 429 && second429WaitMs > 0) {
    saw429 = true;
    const r2 = remainingMs(deadline);
    if (r2 < second429WaitMs + 1500) {
      return { rows: [], saw429: true, ok: false };
    }
    await sleep(second429WaitMs);
    res = await doFetch();
  }
  if (!res.ok) {
    if (res.status === 429) saw429 = true;
    return { rows: [], saw429, ok: false };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const rows = parseAerodataboxBoardJson(json);
  return { rows, saw429, ok: rows.length > 0 || res.ok };
}

async function fetchBoard(
  url: string,
  rapidApiKey: string,
  requestTimeoutMs: number,
  second429WaitMs: number,
  deadline: number,
): Promise<{ rows: Record<string, unknown>[]; saw429: boolean }> {
  const providers = readAerodataboxProvidersFromEnv(rapidApiKey);
  if (!providers.length) {
    console.warn('[hubAirportBoardAdbSync] no ADB provider configured');
    return { rows: [], saw429: false };
  }

  let saw429 = false;
  for (const provider of providers) {
    const targetUrl = aerodataboxUrlForProvider(url, provider);
    const result = await fetchBoardOnce(
      targetUrl,
      provider.headers,
      requestTimeoutMs,
      second429WaitMs,
      deadline,
    );
    if (result.saw429) saw429 = true;
    if (result.rows.length > 0) {
      return { rows: result.rows, saw429 };
    }
    if (result.ok) {
      return { rows: [], saw429 };
    }
  }

  console.warn('[hubAirportBoardAdbSync] board failed all providers', url.slice(0, 120));
  return { rows: [], saw429 };
}

export type HubBoardSyncResult = {
  version: 2;
  anchorDay: string;
  slotKey: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  /** Planlanan URL sayısı (job listesi). */
  urlsFetched: number;
  /** Gerçekten denenen URL sayısı (süre dolunca erken durduysa < urlsFetched). */
  urlsCompleted: number;
  /** HUB_BOARD_MAX_WALL_MS dolunca veya bütçe yetmediğinde true. */
  stoppedEarly: boolean;
  /** 1 = yalnız İstanbul bugünü (30 sn cron için); 2 = bugün+yarın (mobil ile aynı kapsam). */
  calendarDays: 1 | 2;
  /** Bu çalışmada çekilen hub IATA listesi (kısmi tur). */
  hubsInRun: string[];
};

export type HubBoardMergeOptions = {
  calendarDays?: 1 | 2;
};

export async function fetchMergedHubAirportBoardRows(
  rapidApiKey: string,
  now: Date = new Date(),
  options?: HubBoardMergeOptions,
): Promise<HubBoardSyncResult> {
  const calendarDays: 1 | 2 = options?.calendarDays === 2 ? 2 : 1;
  const today = istanbulCalendarDate(now);
  const tomorrow = nextCalendarDayYmd(today);
  const slotKey = istanbulSlotKey(now);
  const dayList = calendarDays === 2 ? [today, tomorrow] : [today];
  const hubs = getHubBoardHubsForRun(now);
  const jobs: string[] = [];
  for (const hub of hubs) {
    for (const day of dayList) {
      for (const j of buildJobsForDay(hub, day)) {
        jobs.push(j.url);
      }
    }
  }
  const { concurrency, batchGapMs, requestTimeoutMs, after429CooldownMs, second429WaitMs } =
    resolveFetchTuning(jobs.length);
  const maxWallMs = resolveMaxWallMsForFetch();
  const deadline = maxWallMs > 0 ? Date.now() + maxWallMs : Number.POSITIVE_INFINITY;
  const merged = new Map<string, Record<string, unknown>>();
  let urlsCompleted = 0;
  let stoppedEarly = false;

  for (let i = 0; i < jobs.length; i += concurrency) {
    if (Number.isFinite(deadline) && remainingMs(deadline) < 800) {
      stoppedEarly = true;
      break;
    }
    if (i > 0) {
      const okGap = await sleepWithinBudget(batchGapMs, deadline);
      if (!okGap) {
        stoppedEarly = true;
        break;
      }
    }
    const slice = jobs.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      slice.map((u) =>
        fetchBoard(u, rapidApiKey, requestTimeoutMs, second429WaitMs, deadline).catch((e) => {
          console.warn('[hubAirportBoardAdbSync] fetch error', String(e).slice(0, 120), u.slice(80, 140));
          return { rows: [] as Record<string, unknown>[], saw429: false };
        }),
      ),
    );
    urlsCompleted += slice.length;
    let any429 = false;
    for (const br of batchResults) {
      if (br.saw429) any429 = true;
      for (const row of br.rows) {
        if (!row || typeof row !== 'object') continue;
        const key = rowCacheKey(row as Record<string, unknown>);
        merged.set(key, row as Record<string, unknown>);
      }
    }
    if (any429 && i + concurrency < jobs.length) {
      const okCool = await sleepWithinBudget(after429CooldownMs, deadline);
      if (!okCool) {
        stoppedEarly = true;
        break;
      }
    }
  }

  const rows = [...merged.values()].map((r) => slimBoardRowForDb(r));
  return {
    version: 2,
    anchorDay: today,
    slotKey,
    rows,
    rowCount: rows.length,
    urlsFetched: jobs.length,
    urlsCompleted,
    stoppedEarly,
    calendarDays,
    hubsInRun: hubs,
  };
}
