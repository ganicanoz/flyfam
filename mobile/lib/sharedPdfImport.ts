import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import {
  cacheDirectory,
  copyAsync,
  getInfoAsync,
} from 'expo-file-system/legacy';

export const PENDING_SHARED_PDF_URI_KEY = 'flyfam_pending_shared_pdf_uri';

const MIN_PDF_BYTES = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Query param: tek veya çift encode’u güvenli çöz. */
function decodeUriParam(raw: string): string {
  let out = raw.trim();
  try {
    out = decodeURIComponent(out);
  } catch {
    return raw.trim();
  }
  if (/%[0-9A-Fa-f]{2}/.test(out)) {
    try {
      return decodeURIComponent(out);
    } catch {
      return out;
    }
  }
  return out;
}

/**
 * Paylaşım eklentisinden: `openHostApp('import-pdf?uri=' + encodeURIComponent(filePath))`
 * → `flyfam:///import-pdf?uri=...`
 */
export function extractPdfUriFromFlyFamImportUrl(url: string): string | null {
  if (!url || !url.toLowerCase().startsWith('flyfam')) return null;
  const parsed = Linking.parse(url);
  const path = (parsed.path || '').replace(/^\/+/, '');
  const host = (parsed.hostname || '').replace(/^\/+/, '');
  const route = path || host;
  if (route !== 'import-pdf') return null;
  const qp = parsed.queryParams ?? {};
  const rawCandidate = qp.uri ?? qp.url ?? qp.file ?? qp.path;
  if (typeof rawCandidate !== 'string' || !rawCandidate.trim()) return null;
  return decodeUriParam(rawCandidate);
}

/** iOS `file://` (Inbox / App Group) ve Android `content://` VIEW intent. */
export function isLikelyPdfIncomingUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim().replace(/\\/g, '/');
  const lower = u.toLowerCase();
  if (lower.startsWith('file://')) {
    if (lower.endsWith('.pdf')) return true;
    if (lower.includes('/inbox/')) return true;
    if (lower.includes('shareddata')) return true;
    return false;
  }
  if (lower.startsWith('content://')) {
    return lower.includes('pdf') || lower.includes('application%2Fpdf');
  }
  return false;
}

function isAlreadyInAppCache(uri: string): boolean {
  const cache = cacheDirectory ?? '';
  if (!cache) return false;
  const norm = uri.replace(/\\/g, '/');
  return norm.includes(cache) || /\/Caches\/ExponentExperienceData\//i.test(norm);
}

async function pdfFileLooksValid(uri: string): Promise<boolean> {
  try {
    const info = await getInfoAsync(uri);
    if (!info.exists) return false;
    const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
    return size >= MIN_PDF_BYTES;
  } catch {
    return false;
  }
}

/**
 * Deeplink / Share Extension / content:// kaynaklarını uygulama cache’ine kopyalar.
 * Geçici Inbox / App Group URI’leri oturum hazır olana kadar silinmesin diye
 * Linking anında çağrılmalı; DocumentPicker zaten cache’e kopyalar.
 */
export async function materializeSharedPdfToCache(sourceUri: string): Promise<string> {
  const src = sourceUri.trim();
  if (!src) throw new Error('shared PDF URI empty');

  if (isAlreadyInAppCache(src) && (await pdfFileLooksValid(src))) {
    return src;
  }

  const cacheDir = cacheDirectory;
  if (!cacheDir) throw new Error('cacheDirectory unavailable');

  const dest = `${cacheDir}shared-roster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
  const delaysMs = [0, 120, 350, 800, 1600];
  let lastErr: unknown;

  for (const waitMs of delaysMs) {
    if (waitMs > 0) await sleep(waitMs);
    try {
      await copyAsync({ from: src, to: dest });
      if (!(await pdfFileLooksValid(dest))) {
        throw new Error('copied PDF empty or too small');
      }
      return dest;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function savePendingSharedPdfUri(uri: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_SHARED_PDF_URI_KEY, uri);
}

export async function takePendingSharedPdfUri(): Promise<string | null> {
  const v = await AsyncStorage.getItem(PENDING_SHARED_PDF_URI_KEY);
  if (v) await AsyncStorage.removeItem(PENDING_SHARED_PDF_URI_KEY);
  return v;
}
