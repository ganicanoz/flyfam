/**
 * Single active mobile device per user.
 *
 * POST { action: 'register' | 'assert', install_id: string }
 * - register: upsert install_id, then signOut scope=others (keep this JWT)
 * - assert: 200 if install matches; 409 if another device is active
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeInstallId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (id.length < 8 || id.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authHeader) {
      return json(400, { error: 'Missing server configuration or auth header' });
    }

    let body: { action?: string; install_id?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const action = String(body.action ?? 'register').trim().toLowerCase();
    if (action !== 'register' && action !== 'assert') {
      return json(400, { error: 'action must be register or assert' });
    }

    const installId = normalizeInstallId(body.install_id);
    if (!installId) {
      return json(400, { error: 'install_id required' });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: getUserError,
    } = await userClient.auth.getUser();

    if (getUserError || !user) {
      return json(401, { error: getUserError?.message || 'Unauthorized' });
    }

    if (action === 'assert') {
      const { data: row, error } = await adminClient
        .from('user_active_devices')
        .select('install_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('[register-active-device] assert select', error.message);
        return json(500, { error: 'assert failed' });
      }

      // No row yet (legacy session before feature): allow until next register.
      if (!row?.install_id) {
        return json(200, { ok: true, active: true, pending_register: true });
      }

      if (String(row.install_id) !== installId) {
        return json(409, { ok: false, code: 'other_device_active' });
      }
      return json(200, { ok: true, active: true });
    }

    const { error: upsertError } = await adminClient.from('user_active_devices').upsert(
      {
        user_id: user.id,
        install_id: installId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    if (upsertError) {
      console.error('[register-active-device] upsert', upsertError.message);
      return json(500, { error: 'register failed' });
    }

    // Keep this access/refresh; invalidate other devices' refresh tokens.
    const { error: othersError } = await userClient.auth.signOut({ scope: 'others' });
    if (othersError) {
      console.warn('[register-active-device] signOut others', othersError.message);
      // Still registered; old devices may linger until JWT expiry — assert will kick them.
    }

    return json(200, { ok: true, registered: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[register-active-device] unhandled', msg);
    return json(500, { error: msg });
  }
});
