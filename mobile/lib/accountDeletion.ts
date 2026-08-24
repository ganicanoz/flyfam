import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

async function messageFromInvokeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response | undefined;
    if (res && typeof res.json === 'function') {
      try {
        const body = await res.json();
        if (body && typeof body === 'object' && 'error' in body && body.error != null) {
          return typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (error instanceof Error) return error.message;
  return 'Delete account failed';
}

export async function deleteMyAccount(): Promise<{ ok: true } | { ok: false; error: string }> {
  await supabase.auth.refreshSession().catch(() => {});
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    return { ok: false, error: sessionError?.message || 'Oturum bulunamadı; tekrar giriş yapın.' };
  }

  const { data, error } = await supabase.functions.invoke('delete-my-account', {
    body: {},
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    const detail = await messageFromInvokeError(error);
    return { ok: false, error: detail || (error as Error).message };
  }

  if (data && typeof data === 'object' && data !== null && 'error' in data && (data as { error?: unknown }).error) {
    return { ok: false, error: String((data as { error: unknown }).error) };
  }

  return { ok: true };
}
