/**
 * AeroDataBox HTTP — RapidAPI + API.Market (https://doc.aerodatabox.com/docs/openapi-apimarket-v1.yaml).
 * API.Market gateway: https://prod.api.market/api/v1/aedbx/aerodatabox — auth: x-magicapi-key
 */
export const AERODATABOX_RAPIDAPI_BASE = 'https://aerodatabox.p.rapidapi.com';
export const AERODATABOX_APIMARKET_DEFAULT_BASE =
  'https://prod.api.market/api/v1/aedbx/aerodatabox';

export type AerodataboxProviderKind = 'rapidapi' | 'apimarket';

export type AerodataboxProvider = {
  kind: AerodataboxProviderKind;
  label: string;
  cooldownKey: string;
  base: string;
  headers: Record<string, string>;
};

function envTrim(name: string): string {
  return (Deno.env.get(name) ?? '').trim();
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

/** API Market önce (anahtar varsa); RapidAPI kota dolunca AERODATABOX_SKIP_RAPIDAPI=1. */
export function readAerodataboxProvidersFromEnv(fallbackRapidKey = ''): AerodataboxProvider[] {
  const apiMarketKey = envTrim('AERODATABOX_APIMARKET_KEY');
  let apiMarketBase = envTrim('AERODATABOX_APIMARKET_BASE').replace(/\/$/, '');
  if (apiMarketKey && !apiMarketBase) {
    apiMarketBase = AERODATABOX_APIMARKET_DEFAULT_BASE;
  }

  const rapidKey =
    envTrim('AERODATABOX_RAPIDAPI_KEY') ||
    envTrim('RAPIDAPI_KEY') ||
    envTrim('EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY') ||
    fallbackRapidKey.trim();

  const skipRapid =
    envTrim('AERODATABOX_SKIP_RAPIDAPI') === '1' ||
    envTrim('AERODATABOX_SKIP_RAPIDAPI') === 'true';

  const primary = envTrim('AERODATABOX_PRIMARY').toLowerCase();

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
  // Varsayılan: API Market birincil
  return [apimarket, rapid].filter((x): x is AerodataboxProvider => x != null);
}

/** RapidAPI şablon URL → hedef base (path + query aynı). */
export function aerodataboxUrlForProvider(rapidTemplateUrl: string, provider: AerodataboxProvider): string {
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

const FLIGHT_NUMBER_QUERY =
  '?withAircraftImage=false&withLocation=false&withFlightPlan=false&dateLocalRole=Both';

/** Uçuş numarası / tarih — sağlayıcı sırası readAerodataboxProvidersFromEnv ile aynı. */
export function buildAerodataboxFlightNumberSources(
  variants: string[],
  flightDate: string,
  fallbackRapidKey = '',
  options?: { includeT00?: boolean },
): Array<{ cooldownKey: string; urls: string[]; headers: Record<string, string> }> {
  const includeT00 = options?.includeT00 !== false;
  return readAerodataboxProvidersFromEnv(fallbackRapidKey).map((p) => {
    const b = p.base.replace(/\/$/, '');
    return {
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
