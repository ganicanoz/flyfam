import type { Session } from '@supabase/supabase-js';

function isSessionShape(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  const user = s.user as Record<string, unknown> | null | undefined;
  return (
    typeof s.access_token === 'string' &&
    s.access_token.length > 0 &&
    typeof s.refresh_token === 'string' &&
    s.refresh_token.length > 0 &&
    !!user &&
    typeof user.id === 'string' &&
    user.id.length > 0
  );
}

/** Unwrap legacy `{ currentSession }` / `{ session }` envelopes if present. */
export function parsePersistedAuthSessionRaw(raw: string | null | undefined): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isSessionShape(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const envelope = parsed as { currentSession?: unknown; session?: unknown };
      if (isSessionShape(envelope.currentSession)) return envelope.currentSession;
      if (isSessionShape(envelope.session)) return envelope.session;
    }
    return null;
  } catch {
    return null;
  }
}
