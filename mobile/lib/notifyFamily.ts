/**
 * Invoke the notify-family Edge Function to send push to family users.
 * - notifyFamilyFlightEvent: after crew updates flight and status is took_off (en_route), landed, cancelled, or diverted.
 * - notifyFamilyTodayFlights: when crew taps "Send flights to my family".
 * - notifyFamilyStandbyAssigned: after crew converts standby → flights (görev tebliği).
 *
 * RN'de `functions.invoke` bazen sorun çıkarır → önce fetch + apikey.
 * 401: Edge gateway veya fonksiyon JWT reddi — refreshSession ile bir kez yeniden dene.
 */
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase';

type PostResult = { ok: true; sent: number } | { ok: false; error: string; status?: number };

async function getFreshAccessToken(): Promise<string | null> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token) return null;
  const now = Math.floor(Date.now() / 1000);
  const exp = session.expires_at ?? 0;
  /**
   * Edge gateway + notify-family içi getUser(jwt): süresi dolmuş veya yakında dolacak token "Invalid JWT" üretir.
   * expires_at yoksa (0) veya 5 dk içinde bitecekse mutlaka yenile.
   */
  const needsRefresh = exp === 0 || exp <= now + 5 * 60;
  if (needsRefresh) {
    const { data: ref, error: refErr } = await supabase.auth.refreshSession();
    if (!refErr && ref.session?.access_token) return ref.session.access_token.trim();
    if (exp > now + 30) return session.access_token.trim();
    return null;
  }
  return session.access_token.trim();
}

function errorFromResponseBody(text: string, json: unknown, status: number): string {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    const e = o.error ?? o.message ?? o.msg;
    if (typeof e === 'string' && e.trim()) return e.trim();
    const det = o.details;
    if (typeof det === 'string' && det.trim()) return `${status}: ${det.trim()}`;
  }
  const t = text.trim();
  if (t.length > 0 && t.length < 400) return t;
  if (status === 401) {
    return 'Oturum doğrulanamadı (401). Bir kez çıkış yapıp tekrar giriş yapmayı deneyin.';
  }
  return `Sunucu yanıtı ${status}`;
}

async function edgeInvokeErrorMessage(error: { message?: string; context?: Response }): Promise<string> {
  const base = error?.message || 'Gönderilemedi';
  const ctx = error?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const j = (await ctx.json()) as { error?: string; details?: string };
      if (j?.error) {
        return j.details ? `${j.error}: ${j.details}` : j.error;
      }
    } catch {
      /* ignore */
    }
  }
  return base;
}

function notifyFamilyUrl(): string {
  return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/notify-family`;
}

async function postNotifyFamilyOnce(
  body: Record<string, unknown>,
  accessToken: string
): Promise<PostResult> {
  try {
    const res = await fetch(notifyFamilyUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken.trim()}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
    }
    const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};

    if (!res.ok) {
      return {
        ok: false,
        error: errorFromResponseBody(text, json, res.status),
        status: res.status,
      };
    }
    if (o.ok === true && typeof o.sent === 'number') {
      return { ok: true, sent: o.sent as number };
    }
    const err = typeof o.error === 'string' ? o.error : 'Gönderilemedi';
    const det = typeof o.details === 'string' ? o.details : undefined;
    return { ok: false, error: det ? `${err}: ${det}` : err, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Ağ: ${msg}` };
  }
}

/** Sunucu JWT reddederse (401 veya gövdede Invalid JWT) bir kez refresh + tekrar dene. */
function looksLikeJwtAuthFailure(r: PostResult): boolean {
  if (r.ok === true) return false;
  if (r.status === 401 || r.status === 403) return true;
  const msg = (r.error ?? '').toLowerCase();
  return (
    msg.includes('invalid jwt') ||
    msg.includes('invalid token') ||
    msg.includes('jwt expired') ||
    msg.includes('malformed jwt')
  );
}

async function postNotifyFamilyWith401Retry(
  body: Record<string, unknown>,
  accessToken: string
): Promise<PostResult> {
  let r = await postNotifyFamilyOnce(body, accessToken);
  if (r.ok === true) return r;
  if (!looksLikeJwtAuthFailure(r)) return r;

  const { data: ref, error: refErr } = await supabase.auth.refreshSession();
  const t2 = ref.session?.access_token?.trim();
  if (refErr || !t2) {
    return {
      ok: false,
      error:
        'Oturum süresi doldu veya jeton geçersiz. Çıkış yapıp tekrar giriş yapın; sorun sürerse uygulamayı kapatıp açın.',
      status: r.status ?? 401,
    };
  }
  r = await postNotifyFamilyOnce(body, t2);
  return r;
}

export async function notifyFamilyFlightEvent(
  type: 'took_off' | 'landed' | 'cancelled' | 'diverted',
  flightId: string
): Promise<void> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return;

  const viaFetch = await postNotifyFamilyWith401Retry({ type, flightId }, accessToken);
  if (viaFetch.ok === true) return;

  const token2 = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token2) return;

  const { error } = await supabase.functions.invoke('notify-family', {
    body: { type, flightId },
    headers: { Authorization: `Bearer ${token2}` },
  });
  if (error) {
    const msg = await edgeInvokeErrorMessage(error as { message?: string; context?: Response });
    console.warn('[NotifyFamily]', type, viaFetch.error, '| invoke:', msg);
  } else {
    console.warn('[NotifyFamily]', type, viaFetch.error);
  }
}

export type NotifyTodayFlightsResult = { ok: true; sent: number } | { ok: false; error: string };

export async function notifyFamilyTodayFlights(
  crewId: string,
  date: string
): Promise<NotifyTodayFlightsResult> {
  // Önce süresi dolmak üzere olan token'ı getFreshAccessToken ile yenile; sonra notify.
  let accessToken = await getFreshAccessToken();
  if (!accessToken) {
    const { data: ref, error: refErr } = await supabase.auth.refreshSession();
    if (!refErr) accessToken = ref.session?.access_token?.trim() ?? null;
  }
  if (!accessToken) {
    return {
      ok: false,
      error: 'Oturum yok veya süresi doldu. Çıkış yapıp tekrar giriş yapın.',
    };
  }

  return notifyFamilyTodayFlightsWithToken(accessToken, crewId, date);
}

async function notifyFamilyTodayFlightsWithToken(
  accessToken: string,
  crewId: string,
  date: string
): Promise<NotifyTodayFlightsResult> {
  const body = { type: 'today_flights' as const, crewId, date };

  const direct = await postNotifyFamilyWith401Retry(body, accessToken);
  if (direct.ok === true) {
    return { ok: true, sent: direct.sent };
  }

  const networkOnly = direct.error.startsWith('Ağ:');
  if (!networkOnly) {
    return { ok: false, error: direct.error };
  }

  const token2 = (await supabase.auth.getSession()).data.session?.access_token?.trim();
  if (!token2) {
    return { ok: false, error: direct.error };
  }

  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    sent?: number;
    error?: string;
    details?: string;
  }>('notify-family', {
    body,
    headers: { Authorization: `Bearer ${token2}` },
  });

  if (!error && data?.ok === true && typeof data.sent === 'number') {
    return { ok: true, sent: data.sent };
  }
  if (!error && data && typeof data === 'object' && data.ok !== true) {
    const errMsg = (data.error as string) || 'Gönderilemedi';
    const details = typeof data.details === 'string' ? data.details : undefined;
    return { ok: false, error: details ? `${errMsg}: ${details}` : errMsg };
  }
  if (error) {
    const fromInvoke = await edgeInvokeErrorMessage(error as { message?: string; context?: Response });
    return { ok: false, error: `${direct.error} (${fromInvoke})` };
  }
  return { ok: false, error: direct.error };
}

/** Nöbet → görev tebliği: aileye kısa bilgi push'u. Hata sessiz (uçuş kaydı bozulmasın). */
export async function notifyFamilyStandbyAssigned(crewId: string, date: string): Promise<void> {
  let accessToken = await getFreshAccessToken();
  if (!accessToken) {
    const { data: ref, error: refErr } = await supabase.auth.refreshSession();
    if (!refErr) accessToken = ref.session?.access_token?.trim() ?? null;
  }
  if (!accessToken) return;

  const body = { type: 'standby_assigned' as const, crewId, date };
  const viaFetch = await postNotifyFamilyWith401Retry(body, accessToken);
  if (viaFetch.ok === true) return;

  const token2 = (await supabase.auth.getSession()).data.session?.access_token?.trim();
  if (!token2) {
    console.warn('[NotifyFamily] standby_assigned', viaFetch.error);
    return;
  }
  const { error } = await supabase.functions.invoke('notify-family', {
    body,
    headers: { Authorization: `Bearer ${token2}` },
  });
  if (error) {
    const msg = await edgeInvokeErrorMessage(error as { message?: string; context?: Response });
    console.warn('[NotifyFamily] standby_assigned', viaFetch.error, '| invoke:', msg);
  }
}
