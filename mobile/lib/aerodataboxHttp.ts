/**
 * AeroDataBox — RapidAPI + API.Market (doc: openapi-apimarket-v1.yaml).
 */
import Constants from 'expo-constants';

export const AERODATABOX_RAPIDAPI_BASE = 'https://aerodatabox.p.rapidapi.com';
export const AERODATABOX_APIMARKET_DEFAULT_BASE =
  'https://prod.api.market/api/v1/aedbx/aerodatabox';

const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';

export type AerodataboxProviderKind = 'rapidapi' | 'apimarket';

export type AerodataboxProvider = {
  kind: AerodataboxProviderKind;
  label: string;
  cooldownKey: string;
  base: string;
  headers: Record<string, string>;
};

function envTrim(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

export function apiMarketAuthHeaders(key: string): Record<string, string> {
  return {
    'x-magicapi-key': key,
    'x-api-market-key': key,
    accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 FlyFam/1.0',
  };
}

export function rapidApiAuthHeaders(key: string): Record<string, string> {
  return {
    'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
    'x-rapidapi-key': key,
    accept: 'application/json',
  };
}

export function readAerodataboxProvidersFromEnv(): AerodataboxProvider[] {
  const apiMarketKey = (
    Constants.expoConfig?.extra?.aerodataboxApiMarketKey ??
    envTrim('EXPO_PUBLIC_AERODATABOX_APIMARKET_KEY')
  ).trim();
  let apiMarketBase = (
    Constants.expoConfig?.extra?.aerodataboxApiMarketBase ??
    envTrim('EXPO_PUBLIC_AERODATABOX_APIMARKET_BASE')
  )
    .trim()
    .replace(/\/$/, '');
  if (apiMarketKey && !apiMarketBase) {
    apiMarketBase = AERODATABOX_APIMARKET_DEFAULT_BASE;
  }

  const rapidKey = (
    Constants.expoConfig?.extra?.aerodataboxRapidApiKey ??
    envTrim('EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY') ??
    envTrim('EXPO_PUBLIC_RAPIDAPI_KEY')
  ).trim() || AERODATABOX_RAPIDAPI_FALLBACK;

  const skipRapid =
    envTrim('EXPO_PUBLIC_AERODATABOX_SKIP_RAPIDAPI') === '1' ||
    envTrim('EXPO_PUBLIC_AERODATABOX_SKIP_RAPIDAPI') === 'true';

  const primary = envTrim('EXPO_PUBLIC_AERODATABOX_PRIMARY').toLowerCase();

  const apimarket: AerodataboxProvider | null =
    apiMarketKey && apiMarketBase
      ? {
          kind: 'apimarket',
          label: 'AeroDataBox (API Market)',
          cooldownKey: 'aerodatabox_alt',
          base: apiMarketBase,
          headers: apiMarketAuthHeaders(apiMarketKey),
        }
      : null;

  const rapid: AerodataboxProvider | null =
    rapidKey && !skipRapid
      ? {
          kind: 'rapidapi',
          label: 'AeroDataBox (RapidAPI)',
          cooldownKey: 'aerodatabox',
          base: AERODATABOX_RAPIDAPI_BASE,
          headers: rapidApiAuthHeaders(rapidKey),
        }
      : null;

  if (primary === 'rapidapi') {
    return [rapid, apimarket].filter((x): x is AerodataboxProvider => x != null);
  }
  return [apimarket, rapid].filter((x): x is AerodataboxProvider => x != null);
}

export function aerodataboxUrlForProvider(
  rapidTemplateUrl: string,
  provider: AerodataboxProvider,
): string {
  if (provider.kind === 'rapidapi') return rapidTemplateUrl;
  if (!rapidTemplateUrl.startsWith(AERODATABOX_RAPIDAPI_BASE)) return rapidTemplateUrl;
  return `${provider.base.replace(/\/$/, '')}${rapidTemplateUrl.slice(AERODATABOX_RAPIDAPI_BASE.length)}`;
}

export function parseAerodataboxBoardJson(
  json: Record<string, unknown> | null,
): Record<string, unknown>[] {
  if (!json || typeof json !== 'object') return [];
  const arrivals = json.arrivals;
  const departures = json.departures;
  if (Array.isArray(arrivals)) return arrivals as Record<string, unknown>[];
  if (Array.isArray(departures)) return departures as Record<string, unknown>[];
  return [];
}

/** Sırayla dene; ilk 2xx board listesini döndür. */
const FLIGHT_NUMBER_QUERY =
  '?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both';

export function buildAerodataboxFlightNumberSources(
  variants: string[],
  flightDate: string,
  options?: { includeT00?: boolean },
): Array<{
  label: string;
  cooldownKey: string;
  urls: string[];
  headers: Record<string, string>;
}> {
  const includeT00 = options?.includeT00 !== false;
  return readAerodataboxProvidersFromEnv().map((p) => {
    const b = p.base.replace(/\/$/, '');
    return {
      label: p.label,
      cooldownKey: p.cooldownKey,
      headers: p.headers,
      urls: variants.flatMap((v) => {
        const u = `${b}/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(flightDate)}${FLIGHT_NUMBER_QUERY}`;
        if (!includeT00) return [u];
        return [
          u,
          `${b}/flights/number/${encodeURIComponent(v)}/${encodeURIComponent(flightDate)}T00:00${FLIGHT_NUMBER_QUERY}`,
        ];
      }),
    };
  });
}

export async function fetchAerodataboxBoardMulti(
  rapidTemplateUrl: string,
): Promise<{ rows: Record<string, unknown>[]; provider: AerodataboxProvider | null }> {
  const providers = readAerodataboxProvidersFromEnv();
  for (const p of providers) {
    const url = aerodataboxUrlForProvider(rapidTemplateUrl, p);
    try {
      const res = await fetch(url, { headers: p.headers });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const rows = parseAerodataboxBoardJson(json);
      return { rows, provider: p };
    } catch {
      continue;
    }
  }
  return { rows: [], provider: null };
}
