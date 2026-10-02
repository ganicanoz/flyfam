/**
 * PDF roster import — sunucu tarafı (`import-roster` Edge).
 * Parse + birleştirme + plan + RPC sunucuda çalışır; parser/plan düzeltmeleri yeni build gerektirmez.
 * Sunucu ulaşılamazsa (`unavailable`) çağıran eski cihaz yoluna (`parseRosterPdfFromDevice` + `importPdfFlightsViaRpc`) düşer.
 * Sunucu yolunu uzaktan kapatmak için `import-roster` 503 dönebilir; istemciler otomatik eski yola geçer.
 */
import { readAsStringAsync } from 'expo-file-system/legacy';
import { extractText, isAvailable } from 'expo-pdf-text-extract';
import type { PdfFlightRow, PdfImportRpcResult } from './pdfRosterImport';
import { flushPendingRosterClear } from './rosterFlightClear';
import { getAccessTokenForEdgeFunctions } from './rosterPdfParse';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { appMeta } from './userActivity';

export type ServerRosterImportOutcome =
  | { kind: 'imported'; flights: PdfFlightRow[]; result: PdfImportRpcResult | null }
  | { kind: 'unavailable'; reason: string };

type ImportRosterJson = {
  ok?: unknown;
  rows?: unknown;
  result?: unknown;
  error?: unknown;
  code?: unknown;
};

async function postImportRoster(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: ImportRosterJson | null } | { status: 0; error: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/import-roster`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as ImportRosterJson | null;
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function importRosterPdfViaServer(
  uri: string,
  opts?: { crewAirlineIcao?: string | null },
): Promise<ServerRosterImportOutcome> {
  try {
    const base64 = await readAsStringAsync(uri, { encoding: 'base64' }).catch(() => '');
    if (base64.length < 20) return { kind: 'unavailable', reason: 'pdf_read_failed' };

    let deviceText = '';
    if (isAvailable() && (opts?.crewAirlineIcao ?? '').trim().toUpperCase() !== 'SXS') {
      try {
        deviceText = (await extractText(uri))?.trim() ?? '';
      } catch {
        /* best-effort merge only */
      }
    }

    await flushPendingRosterClear();

    let token = await getAccessTokenForEdgeFunctions();
    if (!token) return { kind: 'unavailable', reason: 'no_session' };
    const meta = appMeta();
    const body: Record<string, unknown> = {
      pdf_base64: base64,
      ...(deviceText ? { device_text: deviceText } : {}),
      platform: meta.platform ?? null,
      app_version: meta.app_version ?? null,
      app_build: meta.app_build ?? null,
    };

    let res = await postImportRoster(token, body);
    if (res.status === 401) {
      const { data: ref } = await supabase.auth.refreshSession();
      token = ref.session?.access_token ?? null;
      if (!token) return { kind: 'unavailable', reason: 'HTTP 401' };
      res = await postImportRoster(token, body);
    }
    if (res.status === 0) return { kind: 'unavailable', reason: `network: ${'error' in res ? res.error : ''}` };
    const json = 'json' in res ? res.json : null;
    if (res.status !== 200 || !json || json.ok !== true || !Array.isArray(json.rows)) {
      const code = json && typeof json.code === 'string' ? ` ${json.code}` : '';
      if (__DEV__) console.warn('[PDF] import-roster unavailable', res.status, json?.error);
      return { kind: 'unavailable', reason: `HTTP ${res.status}${code}` };
    }
    const result = json.result && typeof json.result === 'object' ? (json.result as PdfImportRpcResult) : null;
    if (json.rows.length > 0 && !result) return { kind: 'unavailable', reason: 'missing_result' };
    if (__DEV__) console.log('[PDF] import-roster (server):', json.rows.length, 'rows, ok', result?.ok ?? 0);
    return { kind: 'imported', flights: json.rows as PdfFlightRow[], result };
  } catch (e) {
    return { kind: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
  }
}
