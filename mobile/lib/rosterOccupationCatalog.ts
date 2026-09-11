/**
 * Remote roster occupation catalog (admin Deploy → published_payload).
 * Apps read published snapshot without store rebuild; baked-in labels remain fallback.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const STORAGE_KEY = 'flyfam:roster_occupation_catalog_v1';

export type RosterOccupationPublishedRow = {
  code: string;
  airline_icao?: string;
  category?: string;
  label_tr: string;
  label_en: string;
  description_tr?: string;
  description_en?: string;
  card_accent?: string;
  calendar_mark?: string;
  special_notes?: string;
  sort_order?: number;
  active?: boolean;
};

type CatalogCache = {
  version: number;
  rows: RosterOccupationPublishedRow[];
  fetchedAt: number;
};

let memory: CatalogCache | null = null;
/** code (upper) → preferred row (airline-specific preferred later via lookup with airline). */
let byCode = new Map<string, RosterOccupationPublishedRow[]>();

function rebuildIndex(rows: RosterOccupationPublishedRow[]) {
  byCode = new Map();
  for (const row of rows) {
    const code = String(row.code || '')
      .replace(/\s/g, '')
      .toUpperCase();
    if (!code) continue;
    const list = byCode.get(code) ?? [];
    list.push(row);
    byCode.set(code, list);
  }
}

function applyCache(cache: CatalogCache) {
  memory = cache;
  rebuildIndex(cache.rows);
}

export function getOccupationCatalogVersion(): number {
  return memory?.version ?? 0;
}

export function lookupPublishedOccupationLabel(
  code: string | null | undefined,
  lang: 'tr' | 'en',
  airlineIcao?: string | null,
): string | null {
  if (!code) return null;
  const u = code.replace(/\s/g, '').toUpperCase();
  const rows = byCode.get(u);
  if (!rows || rows.length === 0) return null;
  const air = (airlineIcao || '').trim().toUpperCase();
  const match =
    (air ? rows.find((r) => (r.airline_icao || '').toUpperCase() === air) : null) ||
    rows.find((r) => !(r.airline_icao || '').trim()) ||
    rows[0];
  if (!match) return null;
  const label = lang === 'tr' ? match.label_tr : match.label_en;
  return label?.trim() || null;
}

export async function hydrateOccupationCatalogFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CatalogCache;
    if (!parsed || !Array.isArray(parsed.rows)) return;
    applyCache({
      version: Number(parsed.version) || 0,
      rows: parsed.rows,
      fetchedAt: Number(parsed.fetchedAt) || 0,
    });
  } catch {
    /* ignore */
  }
}

export async function refreshOccupationCatalog(force = false): Promise<CatalogCache | null> {
  try {
    const { data, error } = await supabase
      .from('roster_occupation_catalog_meta')
      .select('published_version, published_payload, published_at')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return memory;
    const version = Number(data.published_version) || 0;
    if (!force && memory && memory.version === version && memory.rows.length > 0) {
      return memory;
    }
    const payload = Array.isArray(data.published_payload)
      ? (data.published_payload as RosterOccupationPublishedRow[])
      : [];
    const next: CatalogCache = {
      version,
      rows: payload.filter((r) => r && r.active !== false && r.code),
      fetchedAt: Date.now(),
    };
    applyCache(next);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
    return next;
  } catch {
    return memory;
  }
}
