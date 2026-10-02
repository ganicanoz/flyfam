import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'roster-pdf-reports';
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_BYTES = 1024;
const MAX_PER_DAY = 5;
const REASONS = new Set(['suspect', 'failed', 'manual']);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const shortText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
};

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function purgeExpired(admin: any): Promise<void> {
  const { data } = await admin
    .from('roster_pdf_reports')
    .select('id, storage_path')
    .lt('expires_at', new Date().toISOString())
    .limit(50);
  const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
  if (!rows.length) return;
  const { error } = await admin.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
  if (error) {
    console.warn('[roster-pdf-report] purge storage', error.message);
    return;
  }
  await admin.from('roster_pdf_reports').delete().in('id', rows.map((r) => r.id));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Server configuration' }, 500);
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  try {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const b64 = typeof body?.pdf_base64 === 'string' ? body.pdf_base64 : '';
    if (!b64 || b64.length > Math.ceil(MAX_BYTES / 3) * 4 + 64) return json({ error: 'pdf_base64 missing or too large' }, 400);
    const reason = typeof body?.reason === 'string' && REASONS.has(body.reason) ? body.reason : 'manual';

    const bytes = decodeBase64(b64);
    if (!bytes || bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return json({ error: 'Invalid PDF size' }, 400);
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return json({ error: 'Not a PDF' }, 400);

    let meta: Record<string, unknown> = {};
    if (body?.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
      const s = JSON.stringify(body.meta);
      if (s.length <= 4000) meta = body.meta as Record<string, unknown>;
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin
      .from('roster_pdf_reports')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);
    if ((count ?? 0) >= MAX_PER_DAY) return json({ error: 'rate_limited' }, 429);

    const path = `${user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upErr) {
      console.error('[roster-pdf-report] upload', upErr.message);
      return json({ error: 'upload_failed' }, 500);
    }

    const { data: row, error: insErr } = await admin
      .from('roster_pdf_reports')
      .insert({
        user_id: user.id,
        storage_path: path,
        reason,
        airline_icao: shortText(body?.airline_icao, 8)?.toUpperCase() ?? null,
        parse_source: shortText(body?.parse_source, 40),
        app_version: shortText(body?.app_version, 40),
        platform: shortText(body?.platform, 16),
        size_bytes: bytes.length,
        meta,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      console.error('[roster-pdf-report] insert', insErr?.message);
      await admin.storage.from(BUCKET).remove([path]);
      return json({ error: 'insert_failed' }, 500);
    }

    try {
      await purgeExpired(admin);
    } catch (e) {
      console.warn('[roster-pdf-report] purge', e instanceof Error ? e.message : String(e));
    }

    return json({ ok: true, id: (row as { id: string }).id });
  } catch (e) {
    console.error('[roster-pdf-report] unhandled', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal' }, 500);
  }
});
