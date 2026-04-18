import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Json = Record<string, unknown>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const DEFAULT_ALLOWED_EMAIL = 'ganicanoz@gmail.com';

function normalizeEmail(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function shortId(v: string): string {
  const s = String(v ?? '');
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
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

function parseProviderQuotas(raw: string | undefined): Record<string, number | null> {
  if (!raw || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = typeof v === 'object' && v
        ? Number((v as Record<string, unknown>).quota ?? (v as Record<string, unknown>).monthly ?? (v as Record<string, unknown>).limit ?? (v as Record<string, unknown>).value)
        : Number(v);
      out[k.toLowerCase()] = Number.isFinite(n) && n > 0 ? n : null;
    }
    return out;
  } catch {
    return {};
  }
}

function parseMonthlyUsage(raw: string | undefined): Record<string, number | null> {
  if (!raw || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = typeof v === 'object' && v
        ? Number((v as Record<string, unknown>).used ?? (v as Record<string, unknown>).monthly_used ?? (v as Record<string, unknown>).value)
        : Number(v);
      out[k.toLowerCase()] = Number.isFinite(n) && n >= 0 ? n : null;
    }
    return out;
  } catch {
    return {};
  }
}

type Fr24UsageLive = {
  usedCredits: number | null;
  requestCount: number | null;
  endpointCount: number;
  fetchedAt: string;
};

async function fetchFr24UsageLive(fr24Token: string | null): Promise<Fr24UsageLive | null> {
  const usageUrl = Deno.env.get('ADMIN_FR24_USAGE_URL')?.trim();
  if (!usageUrl) return null;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (fr24Token) headers.Authorization = `Bearer ${fr24Token}`;
  try {
    const res = await fetch(usageUrl, { method: 'GET', headers });
    if (!res.ok) return null;
    const json = await res.json() as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(json?.data) ? json.data : [];
    let creditsSum = 0;
    let requestsSum = 0;
    let hasCredits = false;
    let hasRequests = false;
    for (const row of rows) {
      const c = Number(row?.credits);
      if (Number.isFinite(c) && c >= 0) {
        creditsSum += c;
        hasCredits = true;
      }
      const r = Number(row?.request_count);
      if (Number.isFinite(r) && r >= 0) {
        requestsSum += r;
        hasRequests = true;
      }
    }
    return {
      usedCredits: hasCredits ? creditsSum : null,
      requestCount: hasRequests ? requestsSum : null,
      endpointCount: rows.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function computePhaseSummary(rows: Array<{ api_refresh_phase?: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const phase = (r.api_refresh_phase ?? 'unknown').toLowerCase();
    out[phase] = (out[phase] ?? 0) + 1;
  }
  return out;
}

function phaseSortPriority(phase: string | null | undefined): number {
  const p = (phase ?? '').toLowerCase();
  if (p === 'active') return 0;
  if (p === 'semi_active') return 1;
  if (p === 'passive_future') return 2;
  if (p === 'passive_upcoming') return 3;
  if (p === 'passive_past') return 4;
  return 9;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authorization required' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const jwt = authHeader.slice(7).trim();
  const claims = decodeJwtPayload(jwt);
  if (!claims?.sub) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const allowedEmailsRaw = Deno.env.get('ADMIN_DASHBOARD_ALLOWED_EMAILS') ?? DEFAULT_ALLOWED_EMAIL;
  const allowedEmails = new Set(
    allowedEmailsRaw
      .split(',')
      .map((x) => normalizeEmail(x))
      .filter(Boolean),
  );
  const requesterEmail = normalizeEmail(claims.email);
  if (!allowedEmails.has(requesterEmail)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'POST') {
    let body: Record<string, unknown> | null = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const action = typeof body?.action === 'string' ? body.action : '';
    if (action === 'delete_flight') {
      const flightId = typeof body?.flight_id === 'string' ? body.flight_id.trim() : '';
      if (!flightId) {
        return new Response(JSON.stringify({ error: 'flight_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Keep this explicit to ensure full cleanup even if FK cascade is absent.
      await adminClient.from('flight_crew').delete().eq('flight_id', flightId);
      const { error: delErr } = await adminClient.from('flights').delete().eq('id', flightId);
      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message || 'Delete failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action, flight_id: flightId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'update_flight') {
      const flightId = typeof body?.flight_id === 'string' ? body.flight_id.trim() : '';
      if (!flightId) {
        return new Response(JSON.stringify({ error: 'flight_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const patchRaw = (body?.patch ?? {}) as Record<string, unknown>;
      const patch: Record<string, string | null> = {};
      const allowedPhases = new Set(['active', 'semi_active', 'passive_future', 'passive_upcoming', 'passive_past']);
      const allowedStatuses = new Set(['scheduled', 'taxi_out', 'en_route', 'landed', 'parked', 'cancelled', 'diverted']);
      if (typeof patchRaw.api_refresh_phase === 'string' && allowedPhases.has(patchRaw.api_refresh_phase)) {
        patch.api_refresh_phase = patchRaw.api_refresh_phase;
      }
      if (typeof patchRaw.flight_status === 'string' && allowedStatuses.has(patchRaw.flight_status)) {
        patch.flight_status = patchRaw.flight_status;
      }
      if (typeof patchRaw.origin_airport === 'string') patch.origin_airport = patchRaw.origin_airport || null;
      if (typeof patchRaw.destination_airport === 'string') patch.destination_airport = patchRaw.destination_airport || null;
      if (typeof patchRaw.scheduled_departure === 'string') patch.scheduled_departure = patchRaw.scheduled_departure || null;
      if (typeof patchRaw.scheduled_arrival === 'string') patch.scheduled_arrival = patchRaw.scheduled_arrival || null;
      if (Object.keys(patch).length === 0) {
        return new Response(JSON.stringify({ error: 'No valid patch fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await adminClient.from('flights').update(patch).eq('id', flightId);
      if (error) {
        return new Response(JSON.stringify({ error: error.message || 'Update failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action, flight_id: flightId, patch }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'delete_user') {
      const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: crewRows } = await adminClient.from('crew_profiles').select('id').eq('user_id', userId);
      const crewIds = (crewRows ?? []).map((r: { id: string }) => r.id).filter(Boolean);
      if (crewIds.length > 0) {
        await adminClient.from('flight_crew').delete().in('crew_id', crewIds);
      }
      await adminClient.from('crew_profiles').delete().eq('user_id', userId);
      await adminClient.from('profiles').delete().eq('id', userId);
      const { error: authDelErr } = await adminClient.auth.admin.deleteUser(userId);
      if (authDelErr) {
        return new Response(JSON.stringify({ error: authDelErr.message || 'Auth user delete failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action, user_id: userId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'update_user_password') {
      const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
      const newPassword = typeof body?.new_password === 'string' ? body.new_password : '';
      if (!userId || !newPassword) {
        return new Response(JSON.stringify({ error: 'user_id and new_password are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (newPassword.length < 8) {
        return new Response(JSON.stringify({ error: 'new_password must be at least 8 chars' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
      if (error) {
        return new Response(JSON.stringify({ error: error.message || 'Password update failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action, user_id: userId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'create_flight') {
      const payload = (body?.payload ?? {}) as Record<string, unknown>;
      const flightNumber = typeof payload.flight_number === 'string' ? payload.flight_number.trim().toUpperCase() : '';
      const flightDate = typeof payload.flight_date === 'string' ? payload.flight_date.trim() : '';
      if (!flightNumber || !flightDate) {
        return new Response(JSON.stringify({ error: 'flight_number and flight_date are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const crewIds = Array.isArray(payload.crew_ids)
        ? payload.crew_ids.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      const crewId = crewIds[0] ?? null;
      const ins = {
        crew_id: crewId,
        flight_number: flightNumber,
        flight_date: flightDate,
        origin_airport: typeof payload.origin_airport === 'string' ? (payload.origin_airport || null) : null,
        destination_airport: typeof payload.destination_airport === 'string' ? (payload.destination_airport || null) : null,
        scheduled_departure: typeof payload.scheduled_departure === 'string' ? (payload.scheduled_departure || null) : null,
        scheduled_arrival: typeof payload.scheduled_arrival === 'string' ? (payload.scheduled_arrival || null) : null,
        source: 'manual',
      };
      const { data: created, error: createErr } = await adminClient
        .from('flights')
        .insert(ins)
        .select('id')
        .single();
      if (createErr || !created?.id) {
        return new Response(JSON.stringify({ error: createErr?.message || 'Create flight failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (crewIds.length > 0) {
        await adminClient
          .from('flight_crew')
          .upsert(crewIds.map((cid) => ({ flight_id: created.id, crew_id: cid })), { onConflict: 'flight_id,crew_id' });
      }
      return new Response(JSON.stringify({ ok: true, action, flight_id: created.id }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'attach_crew_to_flight' || action === 'detach_crew_from_flight') {
      const flightId = typeof body?.flight_id === 'string' ? body.flight_id.trim() : '';
      const crewId = typeof body?.crew_id === 'string' ? body.crew_id.trim() : '';
      if (!flightId || !crewId) {
        return new Response(JSON.stringify({ error: 'flight_id and crew_id are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (action === 'attach_crew_to_flight') {
        const { error } = await adminClient.from('flight_crew').upsert(
          { flight_id: flightId, crew_id: crewId },
          { onConflict: 'flight_id,crew_id' },
        );
        if (error) {
          return new Response(JSON.stringify({ error: error.message || 'Attach failed' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        await adminClient.from('flight_crew').delete().eq('flight_id', flightId).eq('crew_id', crewId);
        const { count } = await adminClient
          .from('flight_crew')
          .select('flight_id', { count: 'exact', head: true })
          .eq('flight_id', flightId);
        if (!count || count <= 0) {
          await adminClient.from('flights').delete().eq('id', flightId);
        }
      }
      return new Response(JSON.stringify({ ok: true, action, flight_id: flightId, crew_id: crewId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'bulk_update_flights') {
      const flightIds = Array.isArray(body?.flight_ids)
        ? body.flight_ids.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      const patchRaw = (body?.patch ?? {}) as Record<string, unknown>;
      if (flightIds.length === 0) {
        return new Response(JSON.stringify({ error: 'flight_ids required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const patch: Record<string, string | null> = {};
      const allowedPhases = new Set(['active', 'semi_active', 'passive_future', 'passive_upcoming', 'passive_past']);
      const allowedStatuses = new Set(['scheduled', 'taxi_out', 'en_route', 'landed', 'parked', 'cancelled', 'diverted']);
      if (typeof patchRaw.api_refresh_phase === 'string' && allowedPhases.has(patchRaw.api_refresh_phase)) {
        patch.api_refresh_phase = patchRaw.api_refresh_phase;
      }
      if (typeof patchRaw.flight_status === 'string' && allowedStatuses.has(patchRaw.flight_status)) {
        patch.flight_status = patchRaw.flight_status;
      }
      if (Object.keys(patch).length === 0) {
        return new Response(JSON.stringify({ error: 'No valid patch fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await adminClient.from('flights').update(patch).in('id', flightIds);
      if (error) {
        return new Response(JSON.stringify({ error: error.message || 'Bulk update failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action, count: flightIds.length, patch }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'bulk_delete_flights') {
      const flightIds = Array.isArray(body?.flight_ids)
        ? body.flight_ids.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      if (flightIds.length === 0) {
        return new Response(JSON.stringify({ error: 'flight_ids required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await adminClient.from('flight_crew').delete().in('flight_id', flightIds);
      const { error } = await adminClient.from('flights').delete().in('id', flightIds);
      if (error) {
        return new Response(JSON.stringify({ error: error.message || 'Bulk delete failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action, count: flightIds.length }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Unsupported action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const [
    { data: profiles },
    { data: flights },
    { data: cooldownRows },
    { data: fr24Snapshots },
    { data: fr24Points },
  ] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, role, full_name, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000),
    adminClient
      .from('flights')
      .select(
        'id, flight_number, origin_airport, destination_airport, flight_date, scheduled_departure, scheduled_arrival, api_refresh_phase, flight_status',
      )
      .order('flight_date', { ascending: false })
      .limit(1500),
    adminClient
      .from('flight_provider_cooldown')
      .select('provider, blocked_until, updated_at'),
    adminClient
      .from('fr24_usage_metric_snapshots')
      .select('id, fetched_at, total_calls, total_credits, endpoint_count')
      .gte('fetched_at', new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString())
      .order('fetched_at', { ascending: true })
      .limit(200),
    adminClient
      .from('fr24_usage_metric_points')
      .select('snapshot_id, endpoint, metric_date, calls, credits')
      .gte('metric_date', new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .order('metric_date', { ascending: true })
      .limit(5000),
  ]);

  // Auth emails and last_sign_in_at live in auth.users (Admin API).
  const authUsers: Array<{ id: string; email: string | null; last_sign_in_at: string | null }> = [];
  let page = 1;
  while (page <= 20) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      authUsers.push({
        id: u.id,
        email: u.email ?? null,
        last_sign_in_at: (u as { last_sign_in_at?: string | null }).last_sign_in_at ?? null,
      });
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  const authById = new Map(authUsers.map((u) => [u.id, u]));

  const { data: crewProfilesRows } = await adminClient.from('crew_profiles').select('id, user_id');
  const crewIdByUserId = new Map((crewProfilesRows ?? []).map((r: { id: string; user_id: string }) => [r.user_id, r.id]));
  const userRows = (profiles ?? []).map((p: { id: string; full_name?: string | null; role?: string | null }) => {
    const authU = authById.get(p.id);
    return {
      id: p.id,
      id_short: shortId(p.id),
      full_name: p.full_name ?? null,
      role: p.role ?? null,
      crew_id: crewIdByUserId.get(p.id) ?? null,
      email: authU?.email ?? null,
      last_sign_in_at: authU?.last_sign_in_at ?? null,
    };
  });

  const activeCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activeUsers30d = userRows.filter((u) => {
    const t = u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : 0;
    return Number.isFinite(t) && t >= activeCutoffMs;
  });

  const flightRows = (flights ?? []).map((f: {
    id: string;
    flight_number?: string | null;
    origin_airport?: string | null;
    destination_airport?: string | null;
    flight_date?: string | null;
    scheduled_departure?: string | null;
    scheduled_arrival?: string | null;
    api_refresh_phase?: string | null;
    flight_status?: string | null;
  }) => ({
    id: f.id,
    id_short: shortId(f.id),
    flight_number: f.flight_number ?? null,
    origin_airport: f.origin_airport ?? null,
    destination_airport: f.destination_airport ?? null,
    flight_date: f.flight_date ?? null,
    scheduled_departure: f.scheduled_departure ?? null,
    scheduled_arrival: f.scheduled_arrival ?? null,
    api_refresh_phase: f.api_refresh_phase ?? null,
    flight_status: f.flight_status ?? null,
    crew_names: [] as string[],
    crew_ids: [] as string[],
  }));

  // Flight -> crew names
  const flightIds = flightRows.map((f) => f.id);
  if (flightIds.length > 0) {
    const { data: flightCrewRows } = await adminClient
      .from('flight_crew')
      .select('flight_id, crew_id')
      .in('flight_id', flightIds);
    const crewIds = Array.from(
      new Set((flightCrewRows ?? []).map((r: { crew_id: string }) => String(r.crew_id)).filter(Boolean)),
    );
    const { data: crewProfiles } = crewIds.length > 0
      ? await adminClient.from('crew_profiles').select('id, user_id').in('id', crewIds)
      : { data: [] as Array<{ id: string; user_id: string }> };
    const userIds = Array.from(new Set((crewProfiles ?? []).map((r) => String(r.user_id)).filter(Boolean)));
    const { data: crewUserProfiles } = userIds.length > 0
      ? await adminClient.from('profiles').select('id, full_name').in('id', userIds)
      : { data: [] as Array<{ id: string; full_name: string | null }> };

    const userNameById = new Map(
      (crewUserProfiles ?? []).map((r: { id: string; full_name: string | null }) => [
        r.id,
        r.full_name?.trim() || null,
      ]),
    );
    const crewUserByCrewId = new Map(
      (crewProfiles ?? []).map((r: { id: string; user_id: string }) => [r.id, r.user_id]),
    );
    const namesByFlightId = new Map<string, Set<string>>();
    const crewIdsByFlightId = new Map<string, Set<string>>();
    for (const fc of (flightCrewRows ?? []) as Array<{ flight_id: string; crew_id: string }>) {
      const uid = crewUserByCrewId.get(fc.crew_id);
      const name = uid ? userNameById.get(uid) : null;
      if (!name) continue;
      if (!namesByFlightId.has(fc.flight_id)) namesByFlightId.set(fc.flight_id, new Set());
      namesByFlightId.get(fc.flight_id)?.add(name);
      if (!crewIdsByFlightId.has(fc.flight_id)) crewIdsByFlightId.set(fc.flight_id, new Set());
      crewIdsByFlightId.get(fc.flight_id)?.add(fc.crew_id);
    }
    for (const f of flightRows) {
      f.crew_names = Array.from(namesByFlightId.get(f.id) ?? []);
      f.crew_ids = Array.from(crewIdsByFlightId.get(f.id) ?? []);
    }
  }

  // Order: active -> semi_active -> passive_future -> ... ; within phase by scheduled_departure then date.
  flightRows.sort((a, b) => {
    const pa = phaseSortPriority(a.api_refresh_phase);
    const pb = phaseSortPriority(b.api_refresh_phase);
    if (pa !== pb) return pa - pb;
    const ta = a.scheduled_departure ? new Date(a.scheduled_departure).getTime() : NaN;
    const tb = b.scheduled_departure ? new Date(b.scheduled_departure).getTime() : NaN;
    const va = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
    const vb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
    if (va !== vb) return va - vb;
    return String(a.flight_date ?? '').localeCompare(String(b.flight_date ?? ''));
  });

  const activeFlightRows = flightRows.filter((f) =>
    f.api_refresh_phase === 'semi_active' || f.api_refresh_phase === 'active'
  );

  const phaseSummary = computePhaseSummary(flightRows);

  const quotas = parseProviderQuotas(Deno.env.get('ADMIN_PROVIDER_QUOTAS_JSON'));
  const monthlyUsage = parseMonthlyUsage(Deno.env.get('ADMIN_PROVIDER_MONTHLY_USAGE_JSON'));
  const fr24Token = Deno.env.get('FR24API_TOKEN') ?? Deno.env.get('EXPO_PUBLIC_FR24API_TOKEN') ?? null;
  const fr24LiveUsage = await fetchFr24UsageLive(fr24Token);
  const providers = Array.from(
    new Set([
      ...Object.keys(quotas),
      ...Object.keys(monthlyUsage),
      ...(cooldownRows ?? []).map((r: { provider: string }) => String(r.provider ?? '').toLowerCase()).filter(Boolean),
      'fr24',
      'airlabs',
      'aerodatabox',
      'aeroapi',
    ]),
  );

  const apiUsage = providers.map((provider) => {
    const quota = quotas[provider] ?? null;
    const fallbackUsed = monthlyUsage[provider] ?? null;
    const liveUsed = provider === 'fr24' ? fr24LiveUsage?.usedCredits ?? null : null;
    const used = liveUsed ?? fallbackUsed;
    const remaining = quota != null && used != null ? Math.max(0, quota - used) : null;
    const cooldown = (cooldownRows ?? []).find(
      (r: { provider: string }) => normalizeEmail(r.provider) === provider,
    ) as { blocked_until?: string | null; updated_at?: string | null } | undefined;
    return {
      provider,
      month: monthKey,
      quota_monthly: quota,
      used_monthly: used,
      source: liveUsed != null ? 'live' : 'fallback',
      last_updated: provider === 'fr24' ? fr24LiveUsage?.fetchedAt ?? null : null,
      fr24_request_count: provider === 'fr24' ? fr24LiveUsage?.requestCount ?? null : null,
      fr24_endpoint_count: provider === 'fr24' ? fr24LiveUsage?.endpointCount ?? 0 : 0,
      remaining_monthly: remaining,
      blocked_until: cooldown?.blocked_until ?? null,
      cooldown_active: cooldown?.blocked_until ? new Date(cooldown.blocked_until).getTime() > Date.now() : false,
      updated_at: cooldown?.updated_at ?? null,
    };
  });
  const quotaConfiguredCount = apiUsage.filter((x) => x.quota_monthly != null).length;

  const fr24HistoryDailyMap = new Map<string, { calls: number; credits: number }>();
  const fr24HistoryByEndpointDateMap = new Map<string, { endpoint: string; date: string; calls: number; credits: number }>();
  for (const row of (fr24Points ?? []) as Array<{
    endpoint?: string | null;
    metric_date?: string | null;
    calls?: number | null;
    credits?: number | null;
  }>) {
    const endpoint = String(row.endpoint ?? '').trim();
    const date = String(row.metric_date ?? '').slice(0, 10);
    if (!endpoint || !date) continue;
    const calls = Number(row.calls ?? 0);
    const credits = Number(row.credits ?? 0);
    const daily = fr24HistoryDailyMap.get(date) ?? { calls: 0, credits: 0 };
    daily.calls += Number.isFinite(calls) ? calls : 0;
    daily.credits += Number.isFinite(credits) ? credits : 0;
    fr24HistoryDailyMap.set(date, daily);

    const k = `${endpoint}::${date}`;
    const ep = fr24HistoryByEndpointDateMap.get(k) ?? { endpoint, date, calls: 0, credits: 0 };
    ep.calls += Number.isFinite(calls) ? calls : 0;
    ep.credits += Number.isFinite(credits) ? credits : 0;
    fr24HistoryByEndpointDateMap.set(k, ep);
  }
  const fr24DailySeries = [...fr24HistoryDailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, calls: v.calls, credits: v.credits }));

  const fr24EndpointSeries = [...fr24HistoryByEndpointDateMap.values()]
    .sort((a, b) => (a.endpoint === b.endpoint ? a.date.localeCompare(b.date) : a.endpoint.localeCompare(b.endpoint)));

  const latestFr24Snapshot = ((fr24Snapshots ?? []) as Array<{
    fetched_at?: string | null;
    total_calls?: number | null;
    total_credits?: number | null;
    endpoint_count?: number | null;
  }>).at(-1) ?? null;

  const response: Json = {
    ok: true,
    generated_at: nowIso,
    users: {
      total: userRows.length,
      active_30d: activeUsers30d.length,
      rows: userRows,
      crew_directory: userRows
        .filter((u) => !!u.crew_id)
        .map((u) => ({
          crew_id: u.crew_id,
          user_id: u.id,
          full_name: u.full_name,
          email: u.email,
          role: u.role,
        })),
    },
    flights: {
      total: flightRows.length,
      active_now: activeFlightRows.length,
      phase_summary: phaseSummary,
      rows: flightRows,
      active_rows: activeFlightRows,
    },
    api_usage: {
      month: monthKey,
      providers: apiUsage,
      quota_configured_count: quotaConfiguredCount,
      has_live_fr24: !!fr24LiveUsage,
      fr24_history: {
        latest_snapshot: latestFr24Snapshot
          ? {
              fetched_at: latestFr24Snapshot.fetched_at ?? null,
              total_calls: latestFr24Snapshot.total_calls ?? null,
              total_credits: latestFr24Snapshot.total_credits ?? null,
              endpoint_count: latestFr24Snapshot.endpoint_count ?? null,
            }
          : null,
        daily_series_30d: fr24DailySeries,
        endpoint_series_30d: fr24EndpointSeries,
      },
      notes: [
        'FR24 live usage uses ADMIN_FR24_USAGE_URL and sums data[].credits (fallbacks to env JSON on error).',
        'FR24 history is read from fr24_usage_metric_snapshots/fr24_usage_metric_points (filled by sync-fr24-usage-metrics cron).',
        'Monthly usage values come from ADMIN_PROVIDER_MONTHLY_USAGE_JSON if set.',
        'Quotas come from ADMIN_PROVIDER_QUOTAS_JSON if set.',
      ],
    },
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

