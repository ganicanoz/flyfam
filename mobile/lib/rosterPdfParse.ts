/**
 * PDF roster (Pegasus — `supabase/functions/_shared/roster-pdf/airlines/pegasus/`).
 *
 * Öncelik: Edge `parse-roster-pdf` → sunucu `{ flights }` (pdf-parse + parser) veya yalnız `{ text }`.
 * `supabase.functions.invoke` çoğu zaman oturumu doğru taşır → **önce invoke, sonra fetch**.
 * Edge yoksa: `expo-pdf-text-extract` (metin script’ten farklı olabilir).
 */
import { readAsStringAsync } from 'expo-file-system/legacy';
import { extractText, isAvailable } from 'expo-pdf-text-extract';
import { parseFlightsFromPdfText, type PdfFlightRow } from './pdfRosterImport';
import { mergePdfRowsFromTextParse } from './pdfRowMerge';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

export type PdfRosterDeviceParseSource = 'edge_server_flights' | 'edge_text' | 'local_extract' | 'none';

export type PdfRosterDeviceParseResult = {
  flights: PdfFlightRow[];
  /** Ham metin varsa (edge_text / local_extract) script ile bire bir normalizasyon için kullanılabilir. */
  rawText?: string | null;
  /** Hangi yol kullanıldı — simulator’da Edge’in devreye girip girmediğini anlamak için */
  source: PdfRosterDeviceParseSource;
  /** Edge başarısız, yerel çıkarma devreye girdiyse: HTTP / invoke mesajı (teşhis) */
  edgeFailureHint?: string;
};

/** Geliştirme: import sonrası Alert / log için kısa açıklama */
export function pdfParseSourceDevLabel(source: PdfRosterDeviceParseSource): string {
  switch (source) {
    case 'edge_server_flights':
      return 'Supabase Edge (pdf-parse + sunucu parser)';
    case 'edge_text':
      return 'Edge yalnızca metin (eski deploy veya flights yok)';
    case 'local_extract':
      return 'Cihazda PDF metin çıkarma — Edge çağrısı başarısız';
    default:
      return 'Uçuş çıkarılamadı';
  }
}

type EdgeJson = { text?: unknown; flights?: unknown; error?: unknown };

type EdgeOutcome =
  | { ok: true; text: string }
  | { ok: true; legacyFlights: PdfFlightRow[]; text?: string }
  | { ok: false };

/** Edge JWT doğrulaması için güncel access_token (gerekirse refresh). */
async function getAccessTokenForEdgeFunctions(): Promise<string | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    if (__DEV__) console.warn('[PDF] Edge: oturum yok veya token alınamadı', error?.message);
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = session.expires_at ?? 0;
  if (exp > 0 && exp < now + 120) {
    const { data: ref, error: refErr } = await supabase.auth.refreshSession();
    if (refErr) {
      if (__DEV__) console.warn('[PDF] Edge: refreshSession başarısız', refErr.message);
    } else if (ref.session?.access_token) {
      return ref.session.access_token;
    }
  }
  return session.access_token;
}

function interpretEdgeBody(json: unknown): EdgeOutcome {
  if (!json || typeof json !== 'object') return { ok: false };
  const j = json as EdgeJson;
  const text = typeof j.text === 'string' ? j.text : undefined;
  if (Array.isArray(j.flights)) {
    return { ok: true, legacyFlights: j.flights as PdfFlightRow[], text };
  }
  if (text) return { ok: true, text };
  return { ok: false };
}

async function rosterPdfViaEdgeFetch(
  base64: string,
  accessToken: string,
): Promise<{ outcome: EdgeOutcome; err?: string }> {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/parse-roster-pdf`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ pdf_base64: base64 }),
    });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const bodyErr =
        json && typeof json === 'object' && json !== null && 'error' in json
          ? String((json as EdgeJson).error)
          : '';
      const err = bodyErr ? `HTTP ${res.status} — ${bodyErr}` : `HTTP ${res.status}`;
      if (__DEV__) console.warn('[PDF] Edge fetch HTTP', res.status, json);
      return { outcome: { ok: false }, err };
    }
    const out = interpretEdgeBody(json);
    if (out.ok) {
      if (__DEV__) {
        if ('legacyFlights' in out) console.log('[PDF] parse-roster-pdf (fetch): server flights', out.legacyFlights.length);
        else console.log('[PDF] parse-roster-pdf (fetch): text chars', out.text.length);
      }
      return { outcome: out };
    }
    if (__DEV__) console.warn('[PDF] Edge fetch: beklenen gövde yok', json);
    return { outcome: { ok: false }, err: '200 ama yanıtta text/flights yok' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (__DEV__) console.warn('[PDF] Edge fetch exception', e);
    return { outcome: { ok: false }, err: `Ağ: ${msg}` };
  }
}

async function rosterPdfViaEdgeInvoke(
  base64: string,
  accessToken: string,
): Promise<{ outcome: EdgeOutcome; err?: string }> {
  const { data, error } = await supabase.functions.invoke<EdgeJson>('parse-roster-pdf', {
    body: { pdf_base64: base64 },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (error) {
    if (__DEV__) console.warn('[PDF] parse-roster-pdf invoke error:', error.message);
    return { outcome: { ok: false }, err: `invoke: ${error.message}` };
  }
  if (data && typeof data === 'object' && typeof (data as EdgeJson).error === 'string') {
    if (__DEV__) console.warn('[PDF] parse-roster-pdf body error:', (data as EdgeJson).error);
    return { outcome: { ok: false }, err: String((data as EdgeJson).error) };
  }
  const out = interpretEdgeBody(data);
  if (out.ok) {
    if (__DEV__) {
      if ('legacyFlights' in out) console.log('[PDF] parse-roster-pdf (invoke): server flights', out.legacyFlights.length);
      else console.log('[PDF] parse-roster-pdf (invoke): text chars', out.text.length);
    }
    return { outcome: out };
  }
  if (__DEV__) console.warn('[PDF] invoke: beklenen gövde yok', data);
  return { outcome: { ok: false }, err: 'invoke: yanıtta text/flights yok' };
}

/**
 * Önce `invoke`, sonra `fetch`; ikisinde de açık Bearer token.
 * 401 sonrası bir kez `refreshSession` ile tekrar dene (eski token / proje uyumsuzluğu için: çıkış + giriş).
 */
async function getRosterOutcomeFromEdge(base64: string): Promise<{ outcome: EdgeOutcome; failureHint: string }> {
  let token = await getAccessTokenForEdgeFunctions();
  if (!token) {
    return { outcome: { ok: false }, failureHint: 'Oturum yok veya access_token alınamadı (giriş yapın).' };
  }

  const tryBoth = async (t: string): Promise<{ outcome: EdgeOutcome; hints: string[] }> => {
    const hints: string[] = [];
    const inv = await rosterPdfViaEdgeInvoke(base64, t);
    if (inv.err) hints.push(inv.err);
    if (inv.outcome.ok) return { outcome: inv.outcome, hints };
    const fe = await rosterPdfViaEdgeFetch(base64, t);
    if (fe.err) hints.push(fe.err);
    if (fe.outcome.ok) return { outcome: fe.outcome, hints };
    return { outcome: { ok: false }, hints };
  };

  let { outcome: out, hints } = await tryBoth(token);
  if (out.ok) return { outcome: out, failureHint: '' };

  const { data: ref, error: refErr } = await supabase.auth.refreshSession();
  if (!refErr && ref.session?.access_token) {
    token = ref.session.access_token;
    const second = await tryBoth(token);
    out = second.outcome;
    hints = [...hints, ...second.hints];
    if (out.ok) return { outcome: out, failureHint: '' };
  }

  // Last fallback: parse endpoint is read-only; try anon JWT for projects where user JWT/session is stale.
  // This still stays within the same Supabase project (URL + anon key pair).
  const anonFetch = await rosterPdfViaEdgeFetch(base64, SUPABASE_ANON_KEY);
  if (anonFetch.err) hints.push(`anon: ${anonFetch.err}`);
  if (anonFetch.outcome.ok) {
    if (__DEV__) console.warn('[PDF] Edge user JWT failed, anon fallback succeeded.');
    return { outcome: anonFetch.outcome, failureHint: '' };
  }

  if (__DEV__) {
    console.warn(
      '[PDF] Edge 401/ hata: JWT reddedildi. Çıkış yapıp yeniden giriş yapın. .env URL/anon key değiştiyse eski oturum yanlış projeye ait olabilir.',
    );
  }
  const failureHint = hints.filter(Boolean).join(' | ') || 'Bilinmeyen Edge hatası';
  return { outcome: { ok: false }, failureHint };
}

export async function parseRosterPdfFromDevice(uri: string): Promise<PdfRosterDeviceParseResult> {
  try {
    let base64 = '';
    try {
      base64 = await readAsStringAsync(uri, { encoding: 'base64' });
    } catch (e) {
      if (__DEV__) console.warn('[PDF] readAsStringAsync(base64) failed', e);
    }

    let edgeFailureHint: string | undefined;
    if (base64.length > 20) {
      const { outcome: edge, failureHint } = await getRosterOutcomeFromEdge(base64);
      if (!edge.ok && failureHint) edgeFailureHint = failureHint;
      if (edge.ok) {
        if ('legacyFlights' in edge) {
          const edgeText = edge.text?.trim() ?? '';
          const mergedFlights =
            edgeText.length > 0
              ? mergePdfRowsFromTextParse(edge.legacyFlights, edgeText)
              : edge.legacyFlights;
          if (__DEV__) {
            console.log(
              '[PDF] using Edge server-parsed flights:',
              edge.legacyFlights.length,
              '→ merged:',
              mergedFlights.length,
            );
          }
          return {
            flights: mergedFlights,
            rawText: edgeText || null,
            source: 'edge_server_flights',
          };
        }
        if ('text' in edge) {
          try {
            const rows = parseFlightsFromPdfText(edge.text);
            if (__DEV__) console.log('[PDF] local parse after Edge text only:', rows.length, 'rows');
            return { flights: rows, rawText: edge.text, source: 'edge_text' };
          } catch (parseErr) {
            if (__DEV__) console.warn('[PDF] parseFlightsFromPdfText(Edge text) failed', parseErr);
            return { flights: [], source: 'none', edgeFailureHint };
          }
        }
      }
    }

    if (!isAvailable()) {
      return { flights: [], source: 'none', edgeFailureHint };
    }
    try {
      const text = await extractText(uri);
      if (__DEV__) {
        console.log('[PDF] fallback expo-pdf-text-extract, chars:', (text || '').length);
      }
      try {
        return {
          flights: parseFlightsFromPdfText(text || ''),
          rawText: text || '',
          source: 'local_extract',
          edgeFailureHint,
        };
      } catch (parseErr) {
        if (__DEV__) console.warn('[PDF] parseFlightsFromPdfText(local text) failed', parseErr);
        return { flights: [], source: 'none', edgeFailureHint };
      }
    } catch (extractErr) {
      if (__DEV__) console.warn('[PDF] expo-pdf-text-extract failed', extractErr);
      return { flights: [], source: 'none', edgeFailureHint };
    }
  } catch (e) {
    if (__DEV__) console.error('[PDF] parseRosterPdfFromDevice unexpected', e);
    return { flights: [], source: 'none' };
  }
}
