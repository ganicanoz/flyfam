/**
 * Create / redeem one-time auth deep-link handoffs.
 * Create: public (web callback) — stores secrets server-side.
 * Redeem: public with handoff id — returns payload once, then consumes.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const HANDOFF_TTL_MS = 2 * 60 * 1000;
const ALLOWED_TYPES = new Set([
  'signup',
  'recovery',
  'email',
  'invite',
  'magiclink',
  'email_change',
]);

type HandoffPayload = {
  token_hash?: string;
  type?: string;
  code?: string;
  error?: string;
  error_code?: string;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitizeIncoming(raw: Record<string, unknown>): HandoffPayload | null {
  // Explicitly ignore legacy access_token / refresh_token — TokenHash-only templates.
  const out: HandoffPayload = {};
  const tokenHash = typeof raw.token_hash === 'string' ? raw.token_hash.trim() : '';
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  const error = typeof raw.error === 'string' ? raw.error.trim().slice(0, 300) : '';
  const errorCode = typeof raw.error_code === 'string' ? raw.error_code.trim().slice(0, 120) : '';

  if (tokenHash) out.token_hash = tokenHash.slice(0, 2048);
  if (type && ALLOWED_TYPES.has(type)) out.type = type;
  if (code) out.code = code.slice(0, 2048);
  if (error) out.error = error;
  if (errorCode) out.error_code = errorCode;

  const hasSecret = Boolean(out.token_hash || out.code);
  const hasError = Boolean(out.error || out.error_code);
  if (!hasSecret && !hasError) return null;
  if (out.token_hash && !out.type) return null;
  return out;
}

/** Strip any legacy session tokens before returning a redeemed payload. */
function sanitizeRedeemPayload(raw: unknown): HandoffPayload {
  if (!raw || typeof raw !== 'object') return {};
  const cleaned = sanitizeIncoming(raw as Record<string, unknown>);
  return cleaned ?? {};
}

type AdminClient = ReturnType<typeof createClient>;

/** Awaited purge of expired handoffs. Never throws; never logs payloads. */
async function cleanupExpiredHandoffs(admin: AdminClient): Promise<void> {
  const { error: rpcError } = await admin.rpc('cleanup_expired_auth_link_handoffs');
  if (!rpcError) return;

  console.error('[auth-link-handoff] cleanup rpc failed', rpcError.message);
  const { error: deleteError } = await admin
    .from('auth_link_handoffs')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (deleteError) {
    console.error('[auth-link-handoff] cleanup delete failed', deleteError.message);
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: 'Missing server configuration' });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action.trim() : '';

    if (action === 'create') {
      const payload = sanitizeIncoming(body);
      if (!payload) return json(400, { error: 'Missing auth handoff payload' });

      const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
      const { data, error } = await admin
        .from('auth_link_handoffs')
        .insert({ payload, expires_at: expiresAt })
        .select('id')
        .single();

      if (error || !data?.id) {
        console.error('[auth-link-handoff] create failed', error?.message ?? 'unknown');
        return json(500, { error: 'Could not create handoff' });
      }

      await cleanupExpiredHandoffs(admin);

      return json(200, { ok: true, handoff_id: data.id, expires_at: expiresAt });
    }

    if (action === 'redeem') {
      const handoffId = typeof body.handoff_id === 'string' ? body.handoff_id.trim() : '';
      if (!/^[0-9a-f-]{36}$/i.test(handoffId)) {
        return json(400, { error: 'Invalid handoff_id' });
      }

      const { data: row, error } = await admin
        .from('auth_link_handoffs')
        .select('id, payload, expires_at, consumed_at')
        .eq('id', handoffId)
        .maybeSingle();

      if (error) {
        console.error('[auth-link-handoff] redeem lookup failed', error.message);
        return json(500, { error: 'Handoff lookup failed' });
      }
      if (!row) return json(404, { error: 'Handoff not found' });
      if (row.consumed_at) return json(410, { error: 'Handoff already used' });
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await admin.from('auth_link_handoffs').delete().eq('id', handoffId);
        return json(410, { error: 'Handoff expired' });
      }

      const { data: claimed, error: claimErr } = await admin
        .from('auth_link_handoffs')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', handoffId)
        .is('consumed_at', null)
        .select('payload')
        .maybeSingle();

      if (claimErr) {
        console.error('[auth-link-handoff] redeem claim failed', claimErr.message);
        return json(500, { error: 'Handoff claim failed' });
      }
      if (!claimed) return json(410, { error: 'Handoff already used' });

      await admin.from('auth_link_handoffs').delete().eq('id', handoffId);
      await cleanupExpiredHandoffs(admin);

      const payload = sanitizeRedeemPayload(claimed.payload);
      if (!payload.token_hash && !payload.code && !payload.error && !payload.error_code) {
        return json(410, { error: 'Handoff payload unsupported' });
      }

      return json(200, { ok: true, payload });
    }

    return json(400, { error: 'Unknown action' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[auth-link-handoff] unexpected', msg);
    return json(500, { error: 'Unexpected error' });
  }
});
