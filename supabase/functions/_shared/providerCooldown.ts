/** Retry-After + 429 cooldown persistence for Edge (flight_provider_cooldown table). */

export function parseRetryAfterSeconds(headers: Headers): number | null {
  const ra = headers.get('retry-after');
  if (!ra?.trim()) return null;
  const n = Number(ra.trim());
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), 900);
  const t = Date.parse(ra);
  if (!Number.isNaN(t)) {
    const sec = Math.ceil((t - Date.now()) / 1000);
    return sec > 0 ? Math.min(sec, 900) : null;
  }
  return null;
}

/** Seconds to wait after 429; clamp 30s–15m; default 90s if no Retry-After. */
export function cooldownSecondsFor429(retryAfterSeconds: number | null): number {
  const s = retryAfterSeconds != null ? retryAfterSeconds : 90;
  return Math.min(900, Math.max(30, Math.floor(s)));
}

export async function loadCooldownUntilByProvider(supabase: {
  from: (t: string) => {
    select: (c: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
}): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const { data, error } = await supabase.from('flight_provider_cooldown').select('provider, blocked_until');
  if (error || !Array.isArray(data)) return m;
  const now = Date.now();
  for (const row of data as { provider?: string; blocked_until?: string }[]) {
    const p = typeof row.provider === 'string' ? row.provider : '';
    const t = row.blocked_until ? new Date(row.blocked_until).getTime() : NaN;
    if (p && !Number.isNaN(t) && t > now) m.set(p, t);
  }
  return m;
}

export function isBlockedUntil(map: Map<string, number>, provider: string, nowMs: number = Date.now()): boolean {
  const u = map.get(provider);
  return u != null && u > nowMs;
}

export async function persistProviderCooldown(
  supabase: {
    from: (t: string) => {
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string },
      ) => Promise<{ error: { message: string } | null }>;
    };
  },
  provider: string,
  blockedUntilMs: number,
): Promise<void> {
  const { error } = await supabase.from('flight_provider_cooldown').upsert(
    {
      provider,
      blocked_until: new Date(blockedUntilMs).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider' },
  );
  if (error) console.warn('[providerCooldown] upsert', provider, error.message);
}

export async function applyCooldownSeconds(
  supabase: Parameters<typeof persistProviderCooldown>[0],
  map: Map<string, number>,
  provider: string,
  seconds: number,
): Promise<void> {
  const until = Date.now() + seconds * 1000;
  map.set(provider, until);
  await persistProviderCooldown(supabase, provider, until);
}

export async function apply429ToCooldown(
  supabase: Parameters<typeof persistProviderCooldown>[0],
  map: Map<string, number>,
  provider: string,
  headers: Headers,
): Promise<void> {
  await applyCooldownSeconds(supabase, map, provider, cooldownSecondsFor429(parseRetryAfterSeconds(headers)));
}

/** AirLabs kota aşımını 429 yerine HTTP 200 + `error.code` ile bildirir. */
const AIRLABS_LIMIT_COOLDOWN_SECONDS: Record<string, number> = {
  minute_limit_exceeded: 60,
  hour_limit_exceeded: 15 * 60,
  month_limit_exceeded: 6 * 60 * 60,
};

export function airlabsLimitCooldownSeconds(json: unknown): number | null {
  const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? AIRLABS_LIMIT_COOLDOWN_SECONDS[code] ?? null : null;
}
