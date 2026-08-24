import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

export const PENDING_SHARED_PDF_URI_KEY = 'flyfam_pending_shared_pdf_uri';

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
  try {
    const decoded = decodeURIComponent(rawCandidate);
    // Some clients encode twice before deep-linking.
    return decodeURIComponent(decoded);
  } catch {
    return rawCandidate;
  }
}

/** iOS `file://` (Inbox) ve Android `content://` VIEW intent. */
export function isLikelyPdfIncomingUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim().replace(/\\/g, '/');
  const lower = u.toLowerCase();
  if (lower.startsWith('file://')) {
    if (lower.endsWith('.pdf')) return true;
    if (lower.includes('/inbox/')) return true;
    return false;
  }
  if (lower.startsWith('content://')) {
    return lower.includes('pdf') || lower.includes('application%2Fpdf');
  }
  return false;
}

export async function savePendingSharedPdfUri(uri: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_SHARED_PDF_URI_KEY, uri);
}

export async function takePendingSharedPdfUri(): Promise<string | null> {
  const v = await AsyncStorage.getItem(PENDING_SHARED_PDF_URI_KEY);
  if (v) await AsyncStorage.removeItem(PENDING_SHARED_PDF_URI_KEY);
  return v;
}
