/** Roster poll JSON cache (provider_response_cache table). */

export async function getCachedPayload(
  supabase: {
    from: (t: string) => {
      select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } };
    };
  },
  cacheKey: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('provider_response_cache').select('payload, expires_at').eq('cache_key', cacheKey)
    .maybeSingle();
  if (error || !data || typeof data !== 'object') return null;
  const row = data as { payload?: unknown; expires_at?: string };
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  if (!row.payload || typeof row.payload !== 'object') return null;
  return { ...(row.payload as Record<string, unknown>) };
}

export async function setCachedPayload(
  supabase: {
    from: (t: string) => {
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: unknown }>;
    };
  },
  cacheKey: string,
  payload: Record<string, unknown>,
  expiresAtMs: number,
): Promise<void> {
  const { error } = await supabase.from('provider_response_cache').upsert(
    {
      cache_key: cacheKey,
      payload,
      expires_at: new Date(expiresAtMs).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'cache_key' },
  );
  if (error) console.warn('[providerResponseCache] upsert', cacheKey, error);
}
