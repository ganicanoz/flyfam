import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type UsagePoint = {
  endpoint: string;
  metricDate: string | null;
  calls: number | null;
  credits: number | null;
  raw: Record<string, unknown>;
};
const DEFAULT_ALLOWED_EMAIL = 'ganicanoz@gmail.com';

function normalizeEmail(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function decodeJwtPayload(jwt: string): { sub?: string; email?: string } | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const json = JSON.parse(atob(payload)) as Record<string, unknown>;
    return {
      sub: typeof json.sub === 'string' ? json.sub : undefined,
      email: typeof json.email === 'string' ? json.email : undefined,
    };
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function endpointFromRow(row: Record<string, unknown>): string | null {
  const candidates = ['endpoint', 'path', 'route', 'name', 'label'];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function callsFromRow(row: Record<string, unknown>): number | null {
  const candidates = ['total_calls', 'calls', 'request_count', 'requests', 'count'];
  for (const k of candidates) {
    const v = toNum(row[k]);
    if (v != null) return v;
  }
  return null;
}

function creditsFromRow(row: Record<string, unknown>): number | null {
  const candidates = ['credit_cost', 'credits', 'credit', 'cost'];
  for (const k of candidates) {
    const v = toNum(row[k]);
    if (v != null) return v;
  }
  return null;
}

function dateFromRow(row: Record<string, unknown>): string | null {
  const candidates = ['date', 'day', 'metric_date', 'timestamp', 'time'];
  for (const k of candidates) {
    const d = toDate(row[k]);
    if (d) return d;
  }
  return null;
}

function scanAny(value: unknown, out: UsagePoint[]): void {
  if (Array.isArray(value)) {
    for (const item of value) scanAny(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  const endpoint = endpointFromRow(row);
  const calls = callsFromRow(row);
  const credits = creditsFromRow(row);
  const metricDate = dateFromRow(row);
  if (endpoint && (calls != null || credits != null)) {
    out.push({ endpoint, metricDate, calls, credits, raw: row });
  }
  for (const v of Object.values(row)) scanAny(v, out);
}

function dedupePoints(points: UsagePoint[]): UsagePoint[] {
  const m = new Map<string, UsagePoint>();
  for (const p of points) {
    const key = `${p.endpoint}::${p.metricDate ?? ''}::${p.calls ?? ''}::${p.credits ?? ''}`;
    if (!m.has(key)) m.set(key, p);
  }
  return [...m.values()];
}

function hintIfFr24TablesMissing(errMsg: string | undefined): string | undefined {
  const m = String(errMsg ?? '').toLowerCase();
  if (
    !m.includes('fr24_usage_metric') && !m.includes('schema cache') && !m.includes('does not exist') &&
    !m.includes('relation') && !m.includes('undefined table')
  ) {
    return undefined;
  }
  return 'Veritabanında FR24 tabloları yok: `supabase/migrations/20260417110000_fr24_usage_metrics_history.sql` migration’ını uygula (ör. proje kökünde `supabase db push` veya Supabase Dashboard → SQL Editor’da dosyanın içeriğini çalıştır).';
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  /** Prefer FR24_USAGE_*; fall back to same token used by flight APIs / admin live FR24. */
  const bearer =
    Deno.env.get('FR24_USAGE_AUTH_BEARER')?.trim() ||
    Deno.env.get('FR24API_TOKEN')?.trim() ||
    Deno.env.get('FR24_API_TOKEN')?.trim() ||
    Deno.env.get('EXPO_PUBLIC_FR24API_TOKEN')?.trim();
  const user = Deno.env.get('FR24_USAGE_BASIC_USER')?.trim();
  const pass = Deno.env.get('FR24_USAGE_BASIC_PASS')?.trim();
  const cookie = Deno.env.get('FR24_USAGE_COOKIE')?.trim();
  const extraRaw = Deno.env.get('FR24_USAGE_EXTRA_HEADERS_JSON')?.trim();

  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  } else if (user && pass) {
    headers.Authorization = `Basic ${btoa(`${user}:${pass}`)}`;
  }
  if (cookie) headers.Cookie = cookie;
  if (extraRaw) {
    try {
      const obj = JSON.parse(extraRaw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && k.trim()) headers[k.trim()] = v;
      }
    } catch {
      // ignore malformed extra headers
    }
  }
  /** REST /api/* calls require this header (see FR24 credit overview docs). */
  if ((bearer || (user && pass)) && !String(headers['Accept-Version'] ?? '').trim()) {
    headers['Accept-Version'] = 'v1';
  }
  return headers;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const cronSecret = Deno.env.get('CRON_SECRET')?.trim();
  const supplied = req.headers.get('x-cron-secret')?.trim();
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  let authorized = !!cronSecret && cronSecret === supplied;
  if (!authorized && bearer) {
    const claims = decodeJwtPayload(bearer);
    const requesterEmail = normalizeEmail(claims?.email);
    const allowedEmailsRaw = Deno.env.get('ADMIN_DASHBOARD_ALLOWED_EMAILS') ?? DEFAULT_ALLOWED_EMAIL;
    const allowedEmails = new Set(
      allowedEmailsRaw
        .split(',')
        .map((x) => normalizeEmail(x))
        .filter(Boolean),
    );
    authorized = !!claims?.sub && !!requesterEmail && allowedEmails.has(requesterEmail);
  }
  if (!authorized) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: provide x-cron-secret or admin bearer token' }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  /** Prefer programmatic /api/usage (JSON). The /usage-metrics URL is a browser dashboard and often returns HTML → "response invalid". */
  const usageUrl =
    Deno.env.get('FR24_USAGE_METRICS_URL')?.trim() ||
    Deno.env.get('ADMIN_FR24_USAGE_URL')?.trim() ||
    'https://fr24api.flightradar24.com/api/usage';
  const period = Deno.env.get('FR24_USAGE_METRICS_PERIOD')?.trim() ?? '30d';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured (Supabase env missing)' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const headers = buildHeaders();
  let payload: unknown = null;
  let httpStatus = 0;
  let bodyText = '';
  try {
    const res = await fetch(usageUrl, { method: 'GET', headers });
    httpStatus = res.status;
    bodyText = await res.text();
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = null;
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: 'FR24 request failed', detail: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (httpStatus < 200 || httpStatus >= 300 || !payload || typeof payload !== 'object') {
    const hasBearer =
      !!(Deno.env.get('FR24_USAGE_AUTH_BEARER')?.trim() ||
        Deno.env.get('FR24API_TOKEN')?.trim() ||
        Deno.env.get('FR24_API_TOKEN')?.trim() ||
        Deno.env.get('EXPO_PUBLIC_FR24API_TOKEN')?.trim());
    const hasBasic = !!(Deno.env.get('FR24_USAGE_BASIC_USER')?.trim() && Deno.env.get('FR24_USAGE_BASIC_PASS')?.trim());
    const hasCookie = !!Deno.env.get('FR24_USAGE_COOKIE')?.trim();
    let hint: string | undefined;
    if (httpStatus === 401 || httpStatus === 403) {
      hint =
        'FR24 rejected the request. Set Supabase secret FR24_API_TOKEN (same as flight-lookup) or FR24API_TOKEN / FR24_USAGE_AUTH_BEARER, or FR24_USAGE_BASIC_*, or FR24_USAGE_COOKIE.';
    } else if (!hasBearer && !hasBasic && !hasCookie) {
      hint =
        'No FR24 auth configured. Add Supabase secret FR24_API_TOKEN (same value as flight-lookup) or FR24API_TOKEN, then redeploy sync-fr24-usage-metrics.';
    } else if (!payload || typeof payload !== 'object') {
      hint =
        'Response was not a JSON object (often HTML login page). Use https://fr24api.flightradar24.com/api/usage with Bearer token and Accept-Version v1 (set FR24_USAGE_METRICS_URL / ADMIN_FR24_USAGE_URL if needed). Cookie auth may still need the browser /usage-metrics URL + FR24_USAGE_COOKIE.';
    } else if (String(usageUrl).includes('usage-metrics')) {
      hint =
        'FR24_USAGE_METRICS_URL points at the browser usage-metrics page; programmatic sync expects https://fr24api.flightradar24.com/api/usage (Bearer + Accept-Version v1).';
    } else {
      hint =
        'FR24 returned a non-success HTTP status or an unexpected JSON body. Confirm FR24API_TOKEN and URL (prefer /api/usage).';
    }
    return new Response(
      JSON.stringify({
        error: 'FR24 usage response invalid',
        status: httpStatus,
        body_preview: bodyText.slice(0, 600),
        hint,
        auth_configured: hasBearer || hasBasic || hasCookie,
      }),
      {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const pointsRaw: UsagePoint[] = [];
  scanAny(payload, pointsRaw);
  const points = dedupePoints(pointsRaw);
  const totalCalls = points.reduce((s, p) => s + (p.calls ?? 0), 0);
  const totalCredits = points.reduce((s, p) => s + (p.credits ?? 0), 0);

  const { data: snapshot, error: snapErr } = await admin
    .from('fr24_usage_metric_snapshots')
    .insert({
      period,
      source_url: usageUrl,
      total_calls: points.length > 0 ? totalCalls : null,
      total_credits: points.length > 0 ? totalCredits : null,
      endpoint_count: new Set(points.map((p) => p.endpoint)).size,
      raw: payload as Record<string, unknown>,
    })
    .select('id')
    .single();

  if (snapErr || !snapshot?.id) {
    const msg = snapErr?.message ?? 'Snapshot insert failed';
    const hint = hintIfFr24TablesMissing(msg);
    return new Response(JSON.stringify({ error: msg, ...(hint ? { hint } : {}) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (points.length > 0) {
    const rows = points.map((p) => ({
      snapshot_id: snapshot.id,
      endpoint: p.endpoint,
      metric_date: p.metricDate,
      calls: p.calls,
      credits: p.credits,
      raw: p.raw,
    }));
    const { error: ptsErr } = await admin.from('fr24_usage_metric_points').insert(rows);
    if (ptsErr) {
      const msg = ptsErr.message ?? 'Points insert failed';
      const hint = hintIfFr24TablesMissing(msg);
      return new Response(JSON.stringify({ error: msg, ...(hint ? { hint } : {}) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      snapshot_id: snapshot.id,
      points: points.length,
      endpoint_count: new Set(points.map((p) => p.endpoint)).size,
      total_calls: points.length > 0 ? totalCalls : null,
      total_credits: points.length > 0 ? totalCredits : null,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
