/**
 * Sağlayıcı yanıtındaki meydan kodlarından statik tabloda olmayanları `public.airports`
 * tablosundan (timezone_iana) tamamlar; yerel→UTC çevirisi ve yerel gün eşlemesi o meydanlarda
 * UTC varsayımına düşmez. Sonuçlar (bulunamayanlar dahil) isolate ömrü boyunca bellekte kalır.
 */
import { airportIanaForCode, registerAirportIanaFromDb } from './airportIanaByCode.ts';

const AIRPORT_CODE_RE = /^[A-Z0-9]{3,4}$/;
const NON_AIRPORT_KEY_RE = /airline|operat|aircraft|flight|callsign|painted|reg/i;
const NON_AIRPORT_PARENT_RE = /^(airline|aircraft|flight|operator|codeshared)$/i;
const MAX_CODES_PER_QUERY = 40;
const MAX_WALK_NODES = 3000;
const checkedCodes = new Set<string>();

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

function isValidIana(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Yanıt içinde anahtarı iata/icao içeren 3-4 karakterlik değerleri toplar (havayolu/uçak alanları hariç). */
export function collectAirportCodesFromPayload(payload: unknown): string[] {
  const out = new Set<string>();
  let visited = 0;
  const walk = (node: unknown, depth: number, parentKey: string) => {
    if (!node || typeof node !== 'object' || depth > 6 || visited > MAX_WALK_NODES) return;
    visited += 1;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, parentKey);
      return;
    }
    if (NON_AIRPORT_PARENT_RE.test(parentKey)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const k = key.toLowerCase();
        if ((k.includes('iata') || k.includes('icao')) && !NON_AIRPORT_KEY_RE.test(k)) {
          const code = value.trim().toUpperCase();
          if (AIRPORT_CODE_RE.test(code)) out.add(code);
        }
      } else if (value && typeof value === 'object') {
        walk(value, depth + 1, key);
      }
    }
  };
  walk(payload, 0, '');
  return [...out];
}

export async function ensureAirportTimezones(
  supabase: SupabaseLike | null | undefined,
  codes: Iterable<unknown>,
): Promise<void> {
  if (!supabase || typeof supabase.from !== 'function') return;
  const missing: string[] = [];
  for (const raw of codes) {
    if (typeof raw !== 'string') continue;
    const code = raw.trim().toUpperCase();
    if (!AIRPORT_CODE_RE.test(code) || checkedCodes.has(code) || airportIanaForCode(code)) continue;
    if (!missing.includes(code)) missing.push(code);
    if (missing.length >= MAX_CODES_PER_QUERY) break;
  }
  if (missing.length === 0) return;
  try {
    const list = missing.join(',');
    const { data, error } = await supabase
      .from('airports')
      .select('icao,iata,timezone_iana')
      .or(`icao.in.(${list}),iata.in.(${list})`)
      .not('timezone_iana', 'is', null)
      .limit(MAX_CODES_PER_QUERY * 4);
    if (error || !Array.isArray(data)) return;
    const byCode = new Map<string, Set<string>>();
    const add = (code: unknown, tz: string) => {
      if (typeof code !== 'string') return;
      const u = code.trim().toUpperCase();
      if (!missing.includes(u)) return;
      if (!byCode.has(u)) byCode.set(u, new Set());
      byCode.get(u)!.add(tz);
    };
    for (const row of data as { icao?: unknown; iata?: unknown; timezone_iana?: unknown }[]) {
      const tz = typeof row.timezone_iana === 'string' ? row.timezone_iana.trim() : '';
      if (!tz || !isValidIana(tz)) continue;
      add(row.icao, tz);
      add(row.iata, tz);
    }
    for (const [code, zones] of byCode) {
      if (zones.size === 1) registerAirportIanaFromDb(code, [...zones][0]);
    }
    for (const code of missing) checkedCodes.add(code);
  } catch {
    // DB erişilemezse statik tablo / sabit offset fallback'i ile devam
  }
}

export function ensureAirportTimezonesForPayload(supabase: SupabaseLike | null | undefined, payload: unknown): Promise<void> {
  return ensureAirportTimezones(supabase, collectAirportCodesFromPayload(payload));
}
