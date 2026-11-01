/**
 * Aile planı paylaşım sayfası (app.flyfamapp.com/aile) API'si.
 * Giriş: admin Supabase oturumu (ADMIN_DASHBOARD_ALLOWED_EMAILS) veya 4 haneli PIN → imzalı kısa ömürlü token.
 * Veri: admin_planner_state (config jsonb) + planın sahibinin roster'ı. PIN düz metin saklanmaz.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { changeNotices, isPushEndpoint, localNow, pushToOwner, runOwnerCron } from './notify.ts';
import type { VapidKeys } from './webpush.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TOKEN_PREFIX = 'fp1.';
const TOKEN_TTL_SEC = 30 * 24 * 3600;
const IP_MAX_FAILS = 5;
const IP_WINDOW_MIN = 15;
const GLOBAL_MAX_FAILS = 20;
const GLOBAL_WINDOW_MIN = 60;
const MAX_CONFIG_CHARS = 256_000;
const MAX_PDF_B64_CHARS = 8_000_000;
const MAX_PUSH_SUBS = 20;

function vapidKeys(): VapidKeys | null {
  const publicKey = Deno.env.get('FP_VAPID_PUBLIC') ?? '';
  const privateKey = Deno.env.get('FP_VAPID_PRIVATE') ?? '';
  return publicKey && privateKey ? { publicKey, privateKey, subject: 'https://app.flyfamapp.com/aile/' } : null;
}
const deviceIdOf = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : '');
const personOf = (v: unknown) => (v === 'crew' || v === 'partner' ? v : null);
const DEBT_COLS = 'id, source, label, amount, due_date, paid_on, plan_id, seq, total_n';
const MAX_DEBT_ROWS = 1000;
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isYmd = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
};
/** Aylık taksit vadesi: aynı gün, ay kısaysa ayın son günü. */
function addMonthsYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function normalizeEmail(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret + ':family-planner-token'), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type TokenPayload = { o: string; e: number; p: string };

async function signToken(secret: string, payload: TokenPayload): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body)));
  return TOKEN_PREFIX + body + '.' + b64url(sig);
}

async function verifyToken(secret: string, token: string): Promise<TokenPayload | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [body, sig] = token.slice(TOKEN_PREFIX.length).split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as TokenPayload;
    if (!p?.o || !p?.e || p.e * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

type Attempt = { bucket: string; fail_count: number; window_started_at: string; locked_until: string | null };

async function readAttempt(client: SupabaseClient, bucket: string): Promise<Attempt | null> {
  const { data } = await client.from('family_planner_pin_attempts').select('*').eq('bucket', bucket).maybeSingle();
  return (data as Attempt | null) ?? null;
}

function isLocked(a: Attempt | null): boolean {
  return !!(a?.locked_until && new Date(a.locked_until).getTime() > Date.now());
}

async function registerFail(client: SupabaseClient, bucket: string, prev: Attempt | null, max: number, windowMin: number) {
  const now = Date.now();
  const windowStart = prev ? new Date(prev.window_started_at).getTime() : now;
  const fresh = !prev || now - windowStart > windowMin * 60_000;
  const count = fresh ? 1 : prev!.fail_count + 1;
  await client.from('family_planner_pin_attempts').upsert({
    bucket,
    fail_count: count,
    window_started_at: new Date(fresh ? now : windowStart).toISOString(),
    locked_until: count >= max ? new Date(now + windowMin * 60_000).toISOString() : null,
  });
}

type Owner = { owner_user_id: string; share_pin_hash: string | null };

async function resolveAuth(
  client: SupabaseClient,
  secret: string,
  bearer: string,
): Promise<{ ownerId: string; via: 'admin' | 'pin' } | null> {
  if (!bearer) return null;
  if (bearer.startsWith(TOKEN_PREFIX)) {
    const p = await verifyToken(secret, bearer);
    if (!p) return null;
    const { data } = await client.from('admin_planner_state').select('owner_user_id, share_pin_hash').eq('owner_user_id', p.o).maybeSingle();
    const row = data as Owner | null;
    if (!row?.share_pin_hash || !row.share_pin_hash.startsWith(p.p)) return null;
    return { ownerId: row.owner_user_id, via: 'pin' };
  }
  const { data: userData, error } = await client.auth.getUser(bearer);
  if (error || !userData?.user) return null;
  const allowed = new Set(
    (Deno.env.get('ADMIN_DASHBOARD_ALLOWED_EMAILS') ?? '').split(',').map((x) => normalizeEmail(x)).filter(Boolean),
  );
  if (!allowed.has(normalizeEmail(userData.user.email))) return null;
  const own = await client.from('admin_planner_state').select('owner_user_id').eq('owner_user_id', userData.user.id).maybeSingle();
  if (own.data) return { ownerId: userData.user.id, via: 'admin' };
  const { data: shared } = await client
    .from('admin_planner_state')
    .select('owner_user_id')
    .not('share_pin_hash', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1);
  const ownerId = (shared as { owner_user_id: string }[] | null)?.[0]?.owner_user_id ?? userData.user.id;
  return { ownerId, via: 'admin' };
}

type PlannerEntry = {
  id: string;
  flight_number: string | null;
  flight_date: string | null;
  origin_airport: string | null;
  destination_airport: string | null;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  roster_entry_kind: string | null;
  archived?: boolean;
};

async function loadEntries(client: SupabaseClient, crewId: string, fromYmd: string, toYmd: string): Promise<PlannerEntry[]> {
  const entries: PlannerEntry[] = [];
  const { data: fcRows } = await client.from('flight_crew').select('flight_id').eq('crew_id', crewId);
  const ids = Array.from(new Set((fcRows ?? []).map((r: { flight_id: string }) => String(r.flight_id))));
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows } = await client
      .from('flights')
      .select('id, flight_number, flight_date, origin_airport, destination_airport, scheduled_departure, scheduled_arrival, roster_entry_kind')
      .in('id', ids.slice(i, i + 200))
      .gte('flight_date', fromYmd)
      .lte('flight_date', toYmd);
    for (const r of rows ?? []) entries.push(r as PlannerEntry);
  }
  const liveIds = new Set(entries.map((e) => e.id));
  const { data: archRows } = await client
    .from('flights_archive')
    .select('original_flight_id, flight_number, flight_date, scheduled_departure, scheduled_arrival, flight_snapshot')
    .or(`crew_id.eq.${crewId},crew_ids.cs.{${crewId}}`)
    .gte('flight_date', fromYmd)
    .lte('flight_date', toYmd)
    .limit(500);
  for (const a of archRows ?? []) {
    const id = String(a.original_flight_id);
    if (liveIds.has(id)) continue;
    const snap = (a.flight_snapshot ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof snap[k] === 'string' ? (snap[k] as string) : null);
    entries.push({
      id,
      flight_number: a.flight_number ?? s('flight_number'),
      flight_date: a.flight_date ?? s('flight_date'),
      origin_airport: s('origin_airport'),
      destination_airport: s('destination_airport'),
      scheduled_departure: a.scheduled_departure ?? s('scheduled_departure'),
      scheduled_arrival: a.scheduled_arrival ?? s('scheduled_arrival'),
      roster_entry_kind: s('roster_entry_kind'),
      archived: true,
    });
  }
  entries.sort((a, b) => String(a.scheduled_departure ?? a.flight_date).localeCompare(String(b.scheduled_departure ?? b.flight_date)));
  return entries;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const client = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'JSON body required' }, 400);
  }
  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'pin_login') {
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    const ipBucket = 'ip:' + (await sha256Hex('fp-ip:' + ip)).slice(0, 32);
    const [ipAttempt, globalAttempt] = await Promise.all([readAttempt(client, ipBucket), readAttempt(client, 'global')]);
    if (isLocked(ipAttempt) || isLocked(globalAttempt)) {
      return json({ error: 'Çok fazla hatalı deneme. Biraz sonra tekrar dene.', locked: true }, 429);
    }
    let matched: Owner | null = null;
    if (/^\d{4}$/.test(pin)) {
      const { data: rows } = await client.from('admin_planner_state').select('owner_user_id, share_pin_hash').not('share_pin_hash', 'is', null);
      for (const row of (rows ?? []) as Owner[]) {
        const h = await sha256Hex(row.owner_user_id + ':' + pin);
        if (row.share_pin_hash && timingSafeEqual(h, row.share_pin_hash)) matched = row;
      }
    }
    if (!matched) {
      await registerFail(client, ipBucket, ipAttempt, IP_MAX_FAILS, IP_WINDOW_MIN);
      await registerFail(client, 'global', globalAttempt, GLOBAL_MAX_FAILS, GLOBAL_WINDOW_MIN);
      return json({ error: 'PIN hatalı' }, 401);
    }
    await client.from('family_planner_pin_attempts').delete().eq('bucket', ipBucket);
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
    const token = await signToken(serviceKey, { o: matched.owner_user_id, e: exp, p: matched.share_pin_hash!.slice(0, 12) });
    return json({ ok: true, token, expires_at: exp });
  }

  if (action === 'cron') {
    const expected = Deno.env.get('FP_CRON_SECRET') ?? '';
    if (!expected || !timingSafeEqual(req.headers.get('x-cron-secret') ?? '', expected)) return json({ error: 'Forbidden' }, 403);
    const keys = vapidKeys();
    if (!keys) return json({ error: 'VAPID not configured' }, 500);
    // Deneme: yalnız cron sırrıyla; saat geçersiz kılınır, gönderim tek cihaza gider, tekrar kaydı ve roster izleme atlanır.
    const testAt = typeof body.test_at === 'string' && !Number.isNaN(Date.parse(body.test_at)) ? new Date(body.test_at) : undefined;
    const testDevice = deviceIdOf(body.test_device) || undefined;
    if ((testAt || body.test_device) && !testDevice) return json({ error: 'test_device required' }, 400);
    const { data: subOwners } = await client.from('family_planner_push_subs').select('owner_user_id');
    const owners = [...new Set(((subOwners ?? []) as { owner_user_id: string }[]).map((r) => r.owner_user_id))];
    const report: Record<string, string[] | string> = {};
    for (const ownerId of owners) {
      try {
        const { data: row } = await client.from('admin_planner_state').select('config').eq('owner_user_id', ownerId).maybeSingle();
        const cfg = (row?.config ?? {}) as Record<string, unknown>;
        const { data: crew } = await client.from('crew_profiles').select('id').eq('user_id', ownerId).maybeSingle();
        report[ownerId.slice(0, 8)] = await runOwnerCron(client, keys, ownerId, cfg, (from, to) => (crew?.id ? loadEntries(client, String(crew.id), from, to) : Promise.resolve([])), {
          at: testAt,
          onlyDevice: testDevice,
        });
      } catch (e) {
        report[ownerId.slice(0, 8)] = 'error: ' + String((e as Error)?.message ?? e).slice(0, 200);
      }
    }
    return json({ ok: true, owners: owners.length, report });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const auth = await resolveAuth(client, serviceKey, bearer);
  if (!auth) return json({ error: 'Giriş gerekli' }, 401);

  if (action === 'session') return json({ ok: true, via: auth.via });

  if (action === 'get') {
    const monthRaw = typeof body.month === 'string' ? body.month.trim() : '';
    if (!/^\d{4}-\d{2}$/.test(monthRaw)) return json({ error: 'month must be YYYY-MM' }, 400);
    const [yy, mm] = monthRaw.split('-').map((x) => Number(x));
    const fromYmd = new Date(Date.UTC(yy, mm - 1, 1 - 7)).toISOString().slice(0, 10);
    const toYmd = new Date(Date.UTC(yy, mm, 0 + 7)).toISOString().slice(0, 10);
    const { data: stateRow, error: stateErr } = await client
      .from('admin_planner_state')
      .select('config, updated_at')
      .eq('owner_user_id', auth.ownerId)
      .maybeSingle();
    if (stateErr) return json({ error: stateErr.message || 'Planner state failed' }, 400);
    const { data: crew } = await client.from('crew_profiles').select('id, home_base_iata, airline_icao').eq('user_id', auth.ownerId).maybeSingle();
    const entries = crew?.id ? await loadEntries(client, String(crew.id), fromYmd, toYmd) : [];
    const { data: finance } = await client
      .from('family_planner_finance')
      .select('source, period, amount, updated_at')
      .eq('owner_user_id', auth.ownerId)
      .gte('period', [String(yy - 1) + '-' + String(mm).padStart(2, '0'), new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 7)].sort()[0])
      .order('period')
      .limit(3000);
    const { data: debts } = await client
      .from('family_planner_debt')
      .select(DEBT_COLS)
      .eq('owner_user_id', auth.ownerId)
      .or('paid_on.is.null,due_date.gte.' + new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10))
      .order('due_date')
      .limit(2000);
    return json({
      finance: finance ?? [],
      debts: debts ?? [],
      ok: true,
      via: auth.via,
      month: monthRaw,
      config: stateRow?.config ?? null,
      config_updated_at: stateRow?.updated_at ?? null,
      crew: crew ? { home_base_iata: crew.home_base_iata ?? null, airline_icao: crew.airline_icao ?? null } : null,
      entries,
    });
  }

  if (action === 'save_config') {
    const cfg = body.config;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return json({ error: 'config object is required' }, 400);
    if (JSON.stringify(cfg).length > MAX_CONFIG_CHARS) return json({ error: 'config too large' }, 400);
    const { data: before } = await client.from('admin_planner_state').select('config').eq('owner_user_id', auth.ownerId).maybeSingle();
    const { error: upErr } = await client
      .from('admin_planner_state')
      .upsert({ owner_user_id: auth.ownerId, config: cfg, updated_at: new Date().toISOString() }, { onConflict: 'owner_user_id' });
    if (upErr) return json({ error: upErr.message || 'Planner save failed' }, 400);
    const keys = vapidKeys();
    let notified = 0;
    if (keys) {
      try {
        const c = cfg as Record<string, unknown>;
        const today = localNow(String(c.timezone || 'Europe/Istanbul')).ymd;
        const excludeDevice = deviceIdOf(body.device_id) || undefined;
        for (const n of changeNotices((before?.config ?? null) as Record<string, unknown> | null, c, today)) {
          notified += (await pushToOwner(client, keys, auth.ownerId, n, { excludeDevice, topic: n.tag })).sent;
        }
      } catch {
        /* bildirim hatası kaydı bozmaz */
      }
    }
    return json({ ok: true, notified });
  }

  if (action === 'push_key') {
    const keys = vapidKeys();
    return keys ? json({ ok: true, publicKey: keys.publicKey }) : json({ error: 'Bildirimler henüz ayarlanmadı' }, 503);
  }

  if (action === 'push_subscribe') {
    const sub = (body.subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint : '';
    const p256dh = typeof sub.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
    const authKey = typeof sub.keys?.auth === 'string' ? sub.keys.auth : '';
    const deviceId = deviceIdOf(body.device_id);
    if (!isPushEndpoint(endpoint) || endpoint.length > 1000 || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(authKey) || !deviceId) {
      return json({ error: 'Geçersiz abonelik' }, 400);
    }
    const { count } = await client.from('family_planner_push_subs').select('id', { count: 'exact', head: true }).eq('owner_user_id', auth.ownerId);
    const { data: existing } = await client.from('family_planner_push_subs').select('id').eq('endpoint', endpoint).maybeSingle();
    if (!existing && (count ?? 0) >= MAX_PUSH_SUBS) return json({ error: 'Çok fazla cihaz kayıtlı' }, 400);
    const label = typeof body.label === 'string' ? body.label.slice(0, 60) : null;
    const person = personOf(body.person);
    const { error } = await client
      .from('family_planner_push_subs')
      .upsert({ owner_user_id: auth.ownerId, device_id: deviceId, endpoint, p256dh, auth: authKey, label, person, fail_count: 0 }, { onConflict: 'endpoint' });
    if (error) return json({ error: error.message || 'Abonelik kaydedilemedi' }, 400);
    return json({ ok: true });
  }

  if (action === 'push_person') {
    const deviceId = deviceIdOf(body.device_id);
    if (!deviceId) return json({ error: 'device_id required' }, 400);
    await client.from('family_planner_push_subs').update({ person: personOf(body.person) }).eq('owner_user_id', auth.ownerId).eq('device_id', deviceId);
    return json({ ok: true });
  }

  if (action === 'finance_set') {
    const source = typeof body.source === 'string' ? body.source : '';
    const period = typeof body.period === 'string' ? body.period : '';
    const { data: row } = await client.from('admin_planner_state').select('config').eq('owner_user_id', auth.ownerId).maybeSingle();
    const fin = ((row?.config ?? {}) as Record<string, any>).finance ?? {};
    const daily = Array.isArray(fin.daily) && fin.daily.includes(source);
    const monthly = Array.isArray(fin.monthly) && fin.monthly.includes(source);
    if (!daily && !monthly) return json({ error: 'Bilinmeyen kaynak' }, 400);
    // Günlük kaynakta YYYY-MM satırı o ayın elle girilen toplamıdır (günlüklerin toplamı yerine geçer).
    if (!(daily ? /^\d{4}-\d{2}(-\d{2})?$/ : /^\d{4}-\d{2}$/).test(period)) return json({ error: 'Geçersiz dönem' }, 400);
    if (body.amount === null) {
      await client.from('family_planner_finance').delete().eq('owner_user_id', auth.ownerId).eq('source', source).eq('period', period);
      return json({ ok: true, deleted: true });
    }
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0 || amount >= 100_000_000) return json({ error: 'Geçersiz tutar' }, 400);
    const rec = { owner_user_id: auth.ownerId, source, period, amount, device_id: deviceIdOf(body.device_id) || null, updated_at: new Date().toISOString() };
    const { error } = await client.from('family_planner_finance').upsert(rec, { onConflict: 'owner_user_id,source,period' });
    if (error) return json({ error: error.message || 'Kaydedilemedi' }, 400);
    return json({ ok: true, row: { source, period, amount, updated_at: rec.updated_at } });
  }

  if (action === 'debt_add') {
    const source = typeof body.source === 'string' ? body.source : '';
    const { data: row } = await client.from('admin_planner_state').select('config').eq('owner_user_id', auth.ownerId).maybeSingle();
    const fin = ((row?.config ?? {}) as Record<string, any>).finance ?? {};
    if (!(Array.isArray(fin.debt?.sources) && fin.debt.sources.includes(source))) return json({ error: 'Bilinmeyen kaynak' }, 400);
    const first = typeof body.first_due === 'string' ? body.first_due : '';
    if (!isYmd(first)) return json({ error: 'Geçersiz vade tarihi' }, 400);
    const n = Number(body.count);
    if (!Number.isInteger(n) || n < 1 || n > 36) return json({ error: 'Taksit 1–36 olmalı' }, 400);
    const total = Math.round(Number(body.amount) * 100);
    if (!Number.isFinite(total) || total < n || total >= 10_000_000_000) return json({ error: 'Geçersiz tutar' }, 400);
    const { count } = await client.from('family_planner_debt').select('id', { count: 'exact', head: true }).eq('owner_user_id', auth.ownerId);
    if ((count ?? 0) + n > MAX_DEBT_ROWS) return json({ error: 'Çok fazla ödeme kaydı' }, 400);
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
    const planId = crypto.randomUUID();
    const each = Math.floor(total / n);
    const deviceId = deviceIdOf(body.device_id) || null;
    const rows = Array.from({ length: n }, (_, i) => ({
      owner_user_id: auth.ownerId,
      source,
      label,
      amount: (i === n - 1 ? total - each * (n - 1) : each) / 100,
      due_date: addMonthsYmd(first, i),
      plan_id: planId,
      seq: i + 1,
      total_n: n,
      device_id: deviceId,
    }));
    const { data, error } = await client.from('family_planner_debt').insert(rows).select(DEBT_COLS);
    if (error) return json({ error: error.message || 'Kaydedilemedi' }, 400);
    return json({ ok: true, rows: data ?? [] });
  }

  if (action === 'debt_update') {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!isUuid(id)) return json({ error: 'id required' }, 400);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('paid_on' in body) {
      if (body.paid_on !== null && !(typeof body.paid_on === 'string' && isYmd(body.paid_on))) return json({ error: 'Geçersiz ödeme tarihi' }, 400);
      patch.paid_on = body.paid_on;
    }
    if ('due_date' in body) {
      if (!(typeof body.due_date === 'string' && isYmd(body.due_date))) return json({ error: 'Geçersiz vade tarihi' }, 400);
      patch.due_date = body.due_date;
    }
    if ('amount' in body) {
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount >= 100_000_000) return json({ error: 'Geçersiz tutar' }, 400);
      patch.amount = amount;
    }
    if ('label' in body) patch.label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
    const { data, error } = await client.from('family_planner_debt').update(patch).eq('owner_user_id', auth.ownerId).eq('id', id).select(DEBT_COLS).maybeSingle();
    if (error) return json({ error: error.message || 'Kaydedilemedi' }, 400);
    if (!data) return json({ error: 'Kayıt bulunamadı' }, 404);
    return json({ ok: true, row: data });
  }

  if (action === 'debt_delete') {
    const id = typeof body.id === 'string' ? body.id : '';
    const planId = typeof body.plan_id === 'string' ? body.plan_id : '';
    let q = client.from('family_planner_debt').delete().eq('owner_user_id', auth.ownerId);
    if (isUuid(planId)) q = q.eq('plan_id', planId);
    else if (isUuid(id)) q = q.eq('id', id);
    else return json({ error: 'id or plan_id required' }, 400);
    const { error } = await q;
    if (error) return json({ error: error.message || 'Silinemedi' }, 400);
    return json({ ok: true });
  }

  if (action === 'push_unsubscribe') {
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const deviceId = deviceIdOf(body.device_id);
    let q = client.from('family_planner_push_subs').delete().eq('owner_user_id', auth.ownerId);
    if (endpoint) q = q.eq('endpoint', endpoint);
    else if (deviceId) q = q.eq('device_id', deviceId);
    else return json({ error: 'endpoint or device_id required' }, 400);
    await q;
    return json({ ok: true });
  }

  if (action === 'push_status') {
    const deviceId = deviceIdOf(body.device_id);
    const { data } = await client.from('family_planner_push_subs').select('device_id').eq('owner_user_id', auth.ownerId);
    const rows = (data ?? []) as { device_id: string }[];
    return json({ ok: true, devices: rows.length, thisDevice: !!deviceId && rows.some((r) => r.device_id === deviceId) });
  }

  if (action === 'push_test') {
    const keys = vapidKeys();
    const deviceId = deviceIdOf(body.device_id);
    if (!keys || !deviceId) return json({ error: 'Bildirimler ayarlı değil' }, 400);
    const r = await pushToOwner(client, keys, auth.ownerId, { title: '🔔 Bildirimler açık', body: 'Bu cihaz aile planı bildirimlerini alacak.', tag: 'test' }, { onlyDevice: deviceId, ttl: 600 });
    return json({ ok: r.sent > 0, ...r });
  }

  if (action === 'parse_pdf') {
    const b64 = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : '';
    if (!b64 || b64.length > MAX_PDF_B64_CHARS) return json({ error: 'pdf_base64 required (max ~6 MB)' }, 400);
    const { data: crew } = await client.from('crew_profiles').select('airline_icao').eq('user_id', auth.ownerId).maybeSingle();
    const icao = String(crew?.airline_icao ?? '').toUpperCase();
    const res = await fetch(supabaseUrl.replace(/\/$/, '') + '/functions/v1/parse-roster-pdf', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdf_base64: b64, crew_airline_icao: icao || undefined, force_parser: icao || 'auto' }),
    });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return json({ error: String(out.error ?? 'PDF parse failed') }, 400);
    return json({ ok: true, flights: Array.isArray(out.flights) ? out.flights : [] });
  }

  return json({ error: 'Unknown action' }, 400);
});
