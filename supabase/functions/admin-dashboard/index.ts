import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendExpoPush } from '../_shared/expoPush.ts';

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

type CrewSubRow = {
  id: string;
  crew_id: string;
  plan_code: string;
  extra_family_slots: number;
  status: string;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  provider: string | null;
};

type PlanRow = {
  code: string;
  title: string;
  max_family_members: number;
  max_extra_family_members: number;
  active: boolean;
};

type AdminSubscriptionSnapshot = {
  crew_id: string;
  plan_code: string | null;
  plan_title: string | null;
  status: string | null;
  extra_family_slots: number;
  base_family_members: number;
  max_extra_family_members: number;
  total_family_slots: number;
  used_family_approved: number;
  used_family_pending: number;
  available_family_slots: number;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  premium_active: boolean | null;
  provider: string | null;
  read_only?: boolean;
  managed_crew_user_id?: string | null;
  managed_crew_name?: string | null;
};

const SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled']);

function parseOptionalIso(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const t = new Date(raw.trim()).getTime();
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

function buildSubscriptionSnapshot(
  crewId: string,
  sub: CrewSubRow | null | undefined,
  plan: PlanRow | null | undefined,
  approved: number,
  pending: number,
  premiumActive: boolean | null,
  extras?: { read_only?: boolean; managed_crew_user_id?: string | null; managed_crew_name?: string | null },
): AdminSubscriptionSnapshot {
  const base = plan?.max_family_members ?? 0;
  const extra = sub?.extra_family_slots ?? 0;
  const total = base + extra;
  return {
    crew_id: crewId,
    plan_code: sub?.plan_code ?? null,
    plan_title: plan?.title ?? null,
    status: sub?.status ?? null,
    extra_family_slots: extra,
    base_family_members: base,
    max_extra_family_members: plan?.max_extra_family_members ?? 0,
    total_family_slots: total,
    used_family_approved: approved,
    used_family_pending: pending,
    available_family_slots: Math.max(total - approved, 0),
    trial_ends_at: sub?.trial_ends_at ?? null,
    current_period_ends_at: sub?.current_period_ends_at ?? null,
    premium_active: premiumActive,
    provider: sub?.provider ?? null,
    read_only: extras?.read_only,
    managed_crew_user_id: extras?.managed_crew_user_id ?? null,
    managed_crew_name: extras?.managed_crew_name ?? null,
  };
}

async function resolveCrewForSubscriptionAdmin(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ crewId: string; crewUserId: string } | { error: string; status?: number }> {
  const { data: prof } = await adminClient.from('profiles').select('id, role').eq('id', userId).maybeSingle();
  if (!prof) return { error: 'User not found', status: 404 };
  if (String(prof.role ?? '') !== 'crew') {
    return { error: 'Subscription can only be changed on a crew account', status: 400 };
  }
  const { data: crew } = await adminClient.from('crew_profiles').select('id, user_id').eq('user_id', userId).maybeSingle();
  if (!crew?.id) return { error: 'User has no crew profile', status: 400 };
  return { crewId: String(crew.id), crewUserId: String(crew.user_id) };
}

async function countFamilyUsage(
  adminClient: ReturnType<typeof createClient>,
  crewId: string,
): Promise<{ approved: number; pending: number }> {
  const { count: approved } = await adminClient
    .from('family_connections')
    .select('id', { count: 'exact', head: true })
    .eq('crew_id', crewId)
    .eq('status', 'approved');
  const { count: pending } = await adminClient
    .from('family_connections')
    .select('id', { count: 'exact', head: true })
    .eq('crew_id', crewId)
    .eq('status', 'pending');
  return { approved: approved ?? 0, pending: pending ?? 0 };
}

async function syncCrewEntitlement(
  adminClient: ReturnType<typeof createClient>,
  crewUserId: string,
  status: string,
): Promise<void> {
  const premiumActive = status === 'trialing' || status === 'active';
  await adminClient.from('user_entitlements').upsert(
    {
      user_id: crewUserId,
      premium_active: premiumActive,
      source: 'manual_admin_grant',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
}

async function loadSubscriptionContext(
  adminClient: ReturnType<typeof createClient>,
  crewId: string,
  crewUserId: string,
): Promise<{ sub: CrewSubRow | null; plan: PlanRow | null; usage: { approved: number; pending: number }; premiumActive: boolean | null }> {
  const [{ data: subRows }, { data: ent }] = await Promise.all([
    adminClient
      .from('crew_subscriptions')
      .select('id, crew_id, plan_code, extra_family_slots, status, trial_ends_at, current_period_ends_at, provider')
      .eq('crew_id', crewId)
      .order('updated_at', { ascending: false })
      .limit(1),
    adminClient.from('user_entitlements').select('premium_active').eq('user_id', crewUserId).maybeSingle(),
  ]);
  const sub = (subRows?.[0] as CrewSubRow | undefined) ?? null;
  let plan: PlanRow | null = null;
  if (sub?.plan_code) {
    const { data: planRow } = await adminClient
      .from('app_subscription_plans')
      .select('code, title, max_family_members, max_extra_family_members, active')
      .eq('code', sub.plan_code)
      .maybeSingle();
    plan = (planRow as PlanRow | null) ?? null;
  }
  const usage = await countFamilyUsage(adminClient, crewId);
  return {
    sub,
    plan,
    usage,
    premiumActive: typeof ent?.premium_active === 'boolean' ? ent.premium_active : null,
  };
}

/** Dashboard refresh should not hammer /api/usage (same token as flight-summary → 429). */
function fr24LiveOnDashboardEnabled(): boolean {
  const v = (Deno.env.get('ADMIN_FR24_LIVE_ON_DASHBOARD') ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function fetchFr24UsageLive(fr24Token: string | null): Promise<Fr24UsageLive | null> {
  if (!fr24Token?.trim()) return null;
  const usageUrl =
    Deno.env.get('ADMIN_FR24_USAGE_URL')?.trim() ||
    'https://fr24api.flightradar24.com/api/usage';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Version': 'v1',
  };
  if (fr24Token) headers.Authorization = `Bearer ${fr24Token}`;
  try {
    const res = await fetch(usageUrl, { method: 'GET', headers });
    if (!res.ok) {
      if (res.status === 429) {
        console.warn('[admin-dashboard] FR24 /api/usage rate limited (429) — use DB snapshot');
      }
      return null;
    }
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
    if (action === 'list_ops_history') {
      const daysRaw = Number(body?.days ?? 7);
      const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.floor(daysRaw))) : 7;
      const flightNumber =
        typeof body?.flight_number === 'string' ? body.flight_number.trim().toUpperCase() : '';
      const q =
        typeof body?.q === 'string' ? body.q.trim().toLowerCase() : '';
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const sinceDate = sinceIso.slice(0, 10);

      let opsQ = adminClient
        .from('flight_ops_log')
        .select(
          'id, logged_at, event, flight_id, crew_id, flight_number, flight_date, origin_airport, destination_airport, flight_status, api_refresh_phase, scheduled_departure, scheduled_arrival, estimated_departure, estimated_arrival, actual_departure, actual_arrival, fr24_first_seen_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, delay_dep_min, delay_arr_min, aircraft_registration, note',
        )
        .gte('logged_at', sinceIso)
        .order('logged_at', { ascending: false })
        .limit(800);
      if (flightNumber) opsQ = opsQ.ilike('flight_number', `%${flightNumber}%`);

      let archQ = adminClient
        .from('flights_archive')
        .select(
          'original_flight_id, crew_id, flight_number, flight_date, scheduled_departure, scheduled_arrival, flight_status, api_refresh_phase, archived_at, archived_reason, flight_snapshot',
        )
        .or(`archived_at.gte.${sinceIso},flight_date.gte.${sinceDate}`)
        .order('archived_at', { ascending: false })
        .limit(500);
      if (flightNumber) archQ = archQ.ilike('flight_number', `%${flightNumber}%`);

      const [{ data: opsRows, error: opsErr }, { data: archRows, error: archErr }, { data: crewProfiles }] =
        await Promise.all([
          opsQ,
          archQ,
          adminClient.from('crew_profiles').select('id, user_id, company_name').limit(2000),
        ]);
      if (opsErr) {
        return new Response(JSON.stringify({ error: opsErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (archErr) {
        return new Response(JSON.stringify({ error: archErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userIds = Array.from(
        new Set((crewProfiles ?? []).map((c: { user_id?: string | null }) => c.user_id).filter(Boolean)),
      ) as string[];
      const { data: nameRows } = userIds.length
        ? await adminClient.from('profiles').select('id, full_name').in('id', userIds)
        : { data: [] as Array<{ id: string; full_name: string | null }> };
      const nameByUser = new Map((nameRows ?? []).map((p) => [p.id, p.full_name ?? null]));
      const crewLabel = new Map(
        (crewProfiles ?? []).map((c: { id: string; user_id?: string | null; company_name?: string | null }) => [
          c.id,
          {
            user_id: c.user_id ?? null,
            company_name: c.company_name ?? null,
            full_name: c.user_id ? nameByUser.get(c.user_id) ?? null : null,
          },
        ]),
      );

      const matchQ = (parts: Array<string | null | undefined>) => {
        if (!q) return true;
        return parts.some((p) => String(p ?? '').toLowerCase().includes(q));
      };

      const events = (opsRows ?? [])
        .map((r) => {
          const crew = r.crew_id ? crewLabel.get(String(r.crew_id)) : null;
          return {
            ...r,
            crew_name: crew?.full_name ?? null,
            crew_company: crew?.company_name ?? null,
          };
        })
        .filter((r) =>
          matchQ([
            r.flight_number,
            r.origin_airport,
            r.destination_airport,
            r.flight_status,
            r.event,
            r.note,
            r.crew_name,
            r.aircraft_registration,
          ]),
        );

      const archives = (archRows ?? [])
        .map((r) => {
          const snap = (r.flight_snapshot && typeof r.flight_snapshot === 'object'
            ? r.flight_snapshot
            : {}) as Record<string, unknown>;
          const crew = r.crew_id ? crewLabel.get(String(r.crew_id)) : null;
          return {
            original_flight_id: r.original_flight_id,
            crew_id: r.crew_id,
            flight_number: r.flight_number,
            flight_date: r.flight_date,
            scheduled_departure: r.scheduled_departure,
            scheduled_arrival: r.scheduled_arrival,
            flight_status: r.flight_status,
            api_refresh_phase: r.api_refresh_phase,
            archived_at: r.archived_at,
            archived_reason: r.archived_reason,
            origin_airport: (snap.origin_airport as string | null | undefined) ?? null,
            destination_airport: (snap.destination_airport as string | null | undefined) ?? null,
            fr24_first_seen_utc: (snap.fr24_first_seen_utc as string | null | undefined) ?? null,
            fr24_datetime_takeoff_utc: (snap.fr24_datetime_takeoff_utc as string | null | undefined) ?? null,
            fr24_datetime_landed_utc: (snap.fr24_datetime_landed_utc as string | null | undefined) ?? null,
            delay_dep_min: (snap.delay_dep_min as number | null | undefined) ?? null,
            delay_arr_min: (snap.delay_arr_min as number | null | undefined) ?? null,
            aircraft_registration: (snap.aircraft_registration as string | null | undefined) ?? null,
            estimated_arrival: (snap.estimated_arrival as string | null | undefined) ?? null,
            actual_arrival: (snap.actual_arrival as string | null | undefined) ?? null,
            crew_name: crew?.full_name ?? null,
            crew_company: crew?.company_name ?? null,
          };
        })
        .filter((r) =>
          matchQ([
            r.flight_number,
            r.origin_airport,
            r.destination_airport,
            r.flight_status,
            r.archived_reason,
            r.crew_name,
            r.aircraft_registration,
          ]),
        );

      return new Response(
        JSON.stringify({
          ok: true,
          action,
          days,
          since: sinceIso,
          events,
          archives,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
    if (action === 'list_user_flights') {
      const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: prof } = await adminClient.from('profiles').select('id, role').eq('id', userId).maybeSingle();
      if (!prof) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const crewIds = new Set<string>();
      const { data: ownCrew } = await adminClient.from('crew_profiles').select('id').eq('user_id', userId).maybeSingle();
      if (ownCrew?.id) crewIds.add(String(ownCrew.id));
      if (String(prof.role ?? '') === 'family') {
        const { data: links } = await adminClient
          .from('family_connections')
          .select('crew_id')
          .eq('family_id', userId)
          .neq('status', 'declined');
        for (const row of links ?? []) {
          if (row.crew_id) crewIds.add(String(row.crew_id));
        }
      }
      if (crewIds.size === 0) {
        return new Response(JSON.stringify({ ok: true, action, user_id: userId, flights: [] }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: fcRows } = await adminClient
        .from('flight_crew')
        .select('flight_id')
        .in('crew_id', [...crewIds]);
      const flightIds = Array.from(new Set((fcRows ?? []).map((r: { flight_id: string }) => String(r.flight_id)).filter(Boolean)));
      if (flightIds.length === 0) {
        return new Response(JSON.stringify({ ok: true, action, user_id: userId, flights: [] }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: flightRows, error: flErr } = await adminClient
        .from('flights')
        .select(
          'id, flight_number, origin_airport, destination_airport, flight_date, api_refresh_phase, flight_status, scheduled_departure, delay_dep_min, delay_arr_min',
        )
        .in('id', flightIds)
        .or('roster_entry_kind.eq.flight,roster_entry_kind.is.null')
        .order('flight_date', { ascending: false })
        .limit(200);
      if (flErr) {
        return new Response(JSON.stringify({ error: flErr.message || 'Flight list failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, action, user_id: userId, flights: flightRows ?? [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
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
    if (action === 'update_user_profile') {
      const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: prof, error: profErr } = await adminClient.from('profiles').select('id, role').eq('id', userId).maybeSingle();
      if (profErr || !prof) {
        return new Response(JSON.stringify({ error: profErr?.message || 'Profile not found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const currentRole = prof.role === 'crew' || prof.role === 'family' ? prof.role : null;
      if (!currentRole) {
        return new Response(JSON.stringify({ error: 'Profile has invalid role' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const nextRoleRaw = typeof body?.role === 'string' ? body.role.trim() : '';
      const nextRole = nextRoleRaw === 'crew' || nextRoleRaw === 'family' ? nextRoleRaw : null;

      const { data: crewRow } = await adminClient.from('crew_profiles').select('id').eq('user_id', userId).maybeSingle();
      const hasCrew = !!crewRow?.id;

      if (nextRole === 'family' && currentRole === 'crew' && hasCrew) {
        return new Response(
          JSON.stringify({
            error:
              'Cannot set app role to family while a crew profile exists (flights/crew data). Demotion is not supported from this panel.',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      if (nextRole === 'crew' && currentRole === 'family') {
        const { error: upErr } = await adminClient.from('profiles').update({ role: 'crew' }).eq('id', userId);
        if (upErr) {
          return new Response(JSON.stringify({ error: upErr.message || 'Role update failed' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!hasCrew) {
          const cn = typeof body?.company_name === 'string' ? body.company_name.trim() || null : null;
          const icaoRaw = typeof body?.airline_icao === 'string' ? body.airline_icao.trim().toUpperCase() : '';
          const icao = icaoRaw ? icaoRaw.slice(0, 12) : null;
          const { error: insErr } = await adminClient.from('crew_profiles').insert({
            user_id: userId,
            company_name: cn,
            airline_icao: icao,
            time_preference: 'local',
          });
          if (insErr) {
            await adminClient.from('profiles').update({ role: 'family' }).eq('id', userId);
            return new Response(JSON.stringify({ error: insErr.message || 'Failed to create crew profile' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      } else if (nextRole && nextRole !== currentRole) {
        const { error: upErr } = await adminClient.from('profiles').update({ role: nextRole }).eq('id', userId);
        if (upErr) {
          return new Response(JSON.stringify({ error: upErr.message || 'Role update failed' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const wantsCompany = Object.prototype.hasOwnProperty.call(body ?? {}, 'company_name');
      const wantsIcao = Object.prototype.hasOwnProperty.call(body ?? {}, 'airline_icao');
      if (wantsCompany || wantsIcao) {
        const { data: prof2 } = await adminClient.from('profiles').select('role').eq('id', userId).maybeSingle();
        const effRole = prof2?.role === 'crew' || prof2?.role === 'family' ? prof2.role : null;
        if (effRole !== 'crew') {
          return new Response(JSON.stringify({ error: 'Company / ICAO apply only to crew users' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data: cp } = await adminClient.from('crew_profiles').select('id').eq('user_id', userId).maybeSingle();
        const patch: Record<string, string | null> = {};
        if (wantsCompany) {
          patch.company_name = typeof body?.company_name === 'string' ? body.company_name.trim() || null : null;
        }
        if (wantsIcao) {
          const raw = typeof body?.airline_icao === 'string' ? body.airline_icao.trim().toUpperCase() : '';
          patch.airline_icao = raw ? raw.slice(0, 12) : null;
        }
        if (Object.keys(patch).length === 0) {
          return new Response(JSON.stringify({ ok: true, action, user_id: userId }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!cp?.id) {
          const { error: ins2 } = await adminClient.from('crew_profiles').insert({
            user_id: userId,
            company_name: patch.company_name ?? null,
            airline_icao: patch.airline_icao ?? null,
            time_preference: 'local',
          });
          if (ins2) {
            return new Response(JSON.stringify({ error: ins2.message || 'Failed to create crew profile' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          const { error: cuErr } = await adminClient.from('crew_profiles').update(patch).eq('user_id', userId);
          if (cuErr) {
            return new Response(JSON.stringify({ error: cuErr.message || 'Crew profile update failed' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
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
    if (action === 'send_push_notification') {
      let userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
      const emailRaw = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
      if (!userId && emailRaw) {
        let page = 1;
        while (page <= 20) {
          const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
          if (error || !data?.users?.length) break;
          const hit = data.users.find((u) => normalizeEmail(u.email) === emailRaw);
          if (hit?.id) {
            userId = hit.id;
            break;
          }
          if (data.users.length < 200) break;
          page += 1;
        }
      }
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id or email is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const titleRaw = typeof body?.title === 'string' ? body.title.trim() : '';
      const bodyRaw = typeof body?.body === 'string' ? body.body.trim() : '';
      const title = titleRaw || 'FlyFam';
      if (!bodyRaw) {
        return new Response(JSON.stringify({ error: 'body is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (title.length > 100) {
        return new Response(JSON.stringify({ error: 'title max 100 chars' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (bodyRaw.length > 500) {
        return new Response(JSON.stringify({ error: 'body max 500 chars' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: prof } = await adminClient.from('profiles').select('id, full_name').eq('id', userId).maybeSingle();
      if (!prof) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: tokenRows, error: tokErr } = await adminClient
        .from('device_tokens')
        .select('token')
        .eq('user_id', userId);
      if (tokErr) {
        return new Response(JSON.stringify({ error: tokErr.message || 'Token lookup failed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const tokens = Array.from(
        new Set((tokenRows ?? []).map((r: { token: string }) => String(r.token || '').trim()).filter(Boolean)),
      );
      if (tokens.length === 0) {
        return new Response(
          JSON.stringify({
            ok: true,
            action,
            user_id: userId,
            sent: 0,
            token_count: 0,
            no_tokens: true,
            message: 'User has no registered push tokens',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
      const pushResult = await sendExpoPush(tokens, title, bodyRaw);
      console.log('[admin-dashboard] send_push_notification', {
        user_id: userId,
        requester: requesterEmail,
        token_count: tokens.length,
        sent: pushResult.sent,
        errors: pushResult.errors,
      });
      return new Response(
        JSON.stringify({
          ok: true,
          action,
          user_id: userId,
          full_name: prof.full_name ?? null,
          sent: pushResult.sent,
          token_count: tokens.length,
          no_tokens: false,
          expo_errors: pushResult.errors,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
    if (action === 'get_user_subscription') {
      const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: prof } = await adminClient.from('profiles').select('id, role, full_name').eq('id', userId).maybeSingle();
      if (!prof) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (String(prof.role ?? '') === 'crew') {
        const resolved = await resolveCrewForSubscriptionAdmin(adminClient, userId);
        if ('error' in resolved) {
          return new Response(JSON.stringify({ error: resolved.error }), {
            status: resolved.status ?? 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const ctx = await loadSubscriptionContext(adminClient, resolved.crewId, resolved.crewUserId);
        const subscription = buildSubscriptionSnapshot(
          resolved.crewId,
          ctx.sub,
          ctx.plan,
          ctx.usage.approved,
          ctx.usage.pending,
          ctx.premiumActive,
        );
        return new Response(JSON.stringify({ ok: true, action, user_id: userId, subscription }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: link } = await adminClient
        .from('family_connections')
        .select('crew_id')
        .eq('family_id', userId)
        .eq('status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!link?.crew_id) {
        return new Response(JSON.stringify({ ok: true, action, user_id: userId, subscription: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: crewProf } = await adminClient
        .from('crew_profiles')
        .select('id, user_id')
        .eq('id', link.crew_id)
        .maybeSingle();
      if (!crewProf?.user_id) {
        return new Response(JSON.stringify({ ok: true, action, user_id: userId, subscription: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: crewUserProf } = await adminClient
        .from('profiles')
        .select('full_name')
        .eq('id', crewProf.user_id)
        .maybeSingle();
      const ctx = await loadSubscriptionContext(adminClient, String(link.crew_id), String(crewProf.user_id));
      const subscription = buildSubscriptionSnapshot(
        String(link.crew_id),
        ctx.sub,
        ctx.plan,
        ctx.usage.approved,
        ctx.usage.pending,
        ctx.premiumActive,
        {
          read_only: true,
          managed_crew_user_id: String(crewProf.user_id),
          managed_crew_name: crewUserProf?.full_name ?? null,
        },
      );
      return new Response(JSON.stringify({ ok: true, action, user_id: userId, subscription }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'update_user_subscription') {
      const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const resolved = await resolveCrewForSubscriptionAdmin(adminClient, userId);
      if ('error' in resolved) {
        return new Response(JSON.stringify({ error: resolved.error }), {
          status: resolved.status ?? 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const hasPlan = Object.prototype.hasOwnProperty.call(body ?? {}, 'plan_code');
      const hasStatus = Object.prototype.hasOwnProperty.call(body ?? {}, 'status');
      const hasExtra = Object.prototype.hasOwnProperty.call(body ?? {}, 'extra_family_slots');
      const hasExtraDelta = Object.prototype.hasOwnProperty.call(body ?? {}, 'extra_family_delta');
      const hasTrialEnd = Object.prototype.hasOwnProperty.call(body ?? {}, 'trial_ends_at');
      const hasPeriodEnd = Object.prototype.hasOwnProperty.call(body ?? {}, 'current_period_ends_at');
      if (!hasPlan && !hasStatus && !hasExtra && !hasExtraDelta && !hasTrialEnd && !hasPeriodEnd) {
        return new Response(JSON.stringify({ error: 'No subscription fields to update' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const ctx = await loadSubscriptionContext(adminClient, resolved.crewId, resolved.crewUserId);
      let sub = ctx.sub;
      let plan = ctx.plan;

      const requestedPlanCode = hasPlan && typeof body?.plan_code === 'string'
        ? body.plan_code.trim().toLowerCase()
        : undefined;
      if (requestedPlanCode !== undefined) {
        const { data: planRow, error: planErr } = await adminClient
          .from('app_subscription_plans')
          .select('code, title, max_family_members, max_extra_family_members, active')
          .eq('code', requestedPlanCode)
          .maybeSingle();
        if (planErr || !planRow || !planRow.active) {
          return new Response(JSON.stringify({ error: 'Invalid or inactive plan_code' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        plan = planRow as PlanRow;
      } else if (!plan) {
        const { data: defaultPlan } = await adminClient
          .from('app_subscription_plans')
          .select('code, title, max_family_members, max_extra_family_members, active')
          .eq('code', 'couple')
          .maybeSingle();
        plan = (defaultPlan as PlanRow | null) ?? null;
      }

      const requestedStatus = hasStatus && typeof body?.status === 'string' ? body.status.trim() : undefined;
      if (requestedStatus !== undefined && !SUBSCRIPTION_STATUSES.has(requestedStatus)) {
        return new Response(JSON.stringify({ error: 'Invalid status' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let nextExtra = sub?.extra_family_slots ?? 0;
      if (hasExtra && typeof body?.extra_family_slots === 'number' && Number.isFinite(body.extra_family_slots)) {
        nextExtra = Math.max(0, Math.trunc(body.extra_family_slots));
      } else if (hasExtraDelta && typeof body?.extra_family_delta === 'number' && Number.isFinite(body.extra_family_delta)) {
        nextExtra = Math.max(0, Math.trunc(nextExtra + body.extra_family_delta));
      }

      const maxExtra = plan?.max_extra_family_members ?? 10;
      if (nextExtra > maxExtra) {
        return new Response(JSON.stringify({ error: `extra_family_slots cannot exceed ${maxExtra}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const baseFamily = plan?.max_family_members ?? 1;
      const totalSlots = baseFamily + nextExtra;
      const usedTotal = ctx.usage.approved + ctx.usage.pending;
      if (totalSlots < usedTotal) {
        return new Response(
          JSON.stringify({
            error: `Cannot reduce capacity below current family usage (${ctx.usage.approved} approved + ${ctx.usage.pending} pending)`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      const trialEndsAt = parseOptionalIso(body?.trial_ends_at);
      const periodEndsAt = parseOptionalIso(body?.current_period_ends_at);
      if (hasTrialEnd && trialEndsAt === undefined) {
        return new Response(JSON.stringify({ error: 'Invalid trial_ends_at' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (hasPeriodEnd && periodEndsAt === undefined) {
        return new Response(JSON.stringify({ error: 'Invalid current_period_ends_at' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const nowIso = new Date().toISOString();
      const defaultPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const nextStatus = requestedStatus ?? sub?.status ?? 'active';
      const nextPlanCode = requestedPlanCode ?? sub?.plan_code ?? plan?.code ?? 'couple';

      if (!sub) {
        const insertRow = {
          crew_id: resolved.crewId,
          plan_code: nextPlanCode,
          extra_family_slots: nextExtra,
          status: nextStatus,
          trial_started_at: nowIso,
          trial_ends_at: hasTrialEnd ? trialEndsAt : defaultPeriodEnd,
          current_period_ends_at: hasPeriodEnd ? periodEndsAt : defaultPeriodEnd,
          provider: 'manual_admin_grant',
        };
        const { data: created, error: insErr } = await adminClient
          .from('crew_subscriptions')
          .insert(insertRow)
          .select('id, crew_id, plan_code, extra_family_slots, status, trial_ends_at, current_period_ends_at, provider')
          .single();
        if (insErr || !created) {
          return new Response(JSON.stringify({ error: insErr?.message || 'Failed to create subscription' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        sub = created as CrewSubRow;
      } else {
        const patch: Record<string, unknown> = { updated_at: nowIso };
        if (requestedPlanCode !== undefined) patch.plan_code = nextPlanCode;
        if (requestedStatus !== undefined) patch.status = nextStatus;
        if (hasExtra || hasExtraDelta) patch.extra_family_slots = nextExtra;
        if (hasTrialEnd) patch.trial_ends_at = trialEndsAt;
        if (hasPeriodEnd) patch.current_period_ends_at = periodEndsAt;
        if (sub.provider !== 'manual_admin_grant') patch.provider = 'manual_admin_grant';
        const { data: updated, error: upErr } = await adminClient
          .from('crew_subscriptions')
          .update(patch)
          .eq('id', sub.id)
          .select('id, crew_id, plan_code, extra_family_slots, status, trial_ends_at, current_period_ends_at, provider')
          .single();
        if (upErr || !updated) {
          return new Response(JSON.stringify({ error: upErr?.message || 'Subscription update failed' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        sub = updated as CrewSubRow;
      }

      if (!plan || plan.code !== sub.plan_code) {
        const { data: planRow2 } = await adminClient
          .from('app_subscription_plans')
          .select('code, title, max_family_members, max_extra_family_members, active')
          .eq('code', sub.plan_code)
          .maybeSingle();
        plan = (planRow2 as PlanRow | null) ?? plan;
      }

      await syncCrewEntitlement(adminClient, resolved.crewUserId, sub.status);
      const usage = await countFamilyUsage(adminClient, resolved.crewId);
      const { data: ent } = await adminClient
        .from('user_entitlements')
        .select('premium_active')
        .eq('user_id', resolved.crewUserId)
        .maybeSingle();
      const subscription = buildSubscriptionSnapshot(
        resolved.crewId,
        sub,
        plan,
        usage.approved,
        usage.pending,
        typeof ent?.premium_active === 'boolean' ? ent.premium_active : null,
      );
      console.log('[admin-dashboard] update_user_subscription', {
        user_id: userId,
        crew_id: resolved.crewId,
        requester: requesterEmail,
        subscription,
      });
      return new Response(JSON.stringify({ ok: true, action, user_id: userId, subscription }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Unsupported action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
  const now = new Date();
  const nowIso = now.toISOString();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const FLIGHTS_SELECT_FULL =
    'id, flight_number, origin_airport, destination_airport, aircraft_registration, flight_date, scheduled_departure, scheduled_arrival, estimated_departure, estimated_arrival, actual_departure, actual_arrival, delay_dep_min, delay_arr_min, is_delayed, internal_status, diverted_to, api_refresh_phase, phase_active_locked, flight_status, fr24_progress_dep_utc, fr24_progress_eta_utc, fr24_datetime_takeoff_utc, fr24_datetime_landed_utc, fr24_first_seen_utc, airlabs_progress_percent, roster_entry_kind, duty_rest_end, created_at, updated_at';
  const FLIGHTS_SELECT_NO_REG = FLIGHTS_SELECT_FULL.replace(', aircraft_registration', '');

  async function fetchDashboardFlights() {
    let q = adminClient
      .from('flights')
      .select(FLIGHTS_SELECT_FULL)
      .or('roster_entry_kind.eq.flight,roster_entry_kind.is.null')
      .order('flight_date', { ascending: false })
      .limit(1500);
    let res = await q;
    if (res.error && /aircraft_registration/i.test(String(res.error.message ?? ''))) {
      res = await adminClient
        .from('flights')
        .select(FLIGHTS_SELECT_NO_REG)
        .or('roster_entry_kind.eq.flight,roster_entry_kind.is.null')
        .order('flight_date', { ascending: false })
        .limit(1500);
    }
    if (res.error) {
      console.error('[admin-dashboard] flights select failed:', res.error.message);
    }
    return res.data;
  }

  const [
    { data: profiles },
    flights,
    { data: deviceTokens },
    { data: cooldownRows },
    { data: fr24Snapshots },
    { data: fr24Points },
    { data: healthPings },
    { data: crewSubscriptions },
    { data: userEntitlements },
    { data: subscriptionPlans },
  ] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, role, full_name, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000),
    fetchDashboardFlights(),
    adminClient
      .from('device_tokens')
      .select('user_id, platform, app_version, app_build, os_version, last_used_at'),
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
    adminClient
      .from('system_health_pings')
      .select('name,last_run_at,last_success_at,last_error,last_rows_updated,updated_at')
      .eq('name', 'phase_refresh')
      .limit(1),
    adminClient
      .from('crew_subscriptions')
      .select('id, crew_id, plan_code, extra_family_slots, status, trial_ends_at, current_period_ends_at, provider, updated_at')
      .order('updated_at', { ascending: false }),
    adminClient.from('user_entitlements').select('user_id, premium_active'),
    adminClient
      .from('app_subscription_plans')
      .select('code, title, max_family_members, max_extra_family_members, active')
      .order('code', { ascending: true }),
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

  const { data: crewProfilesRows } = await adminClient
    .from('crew_profiles')
    .select('id, user_id, company_name, airline_icao');
  type DeviceTokenRow = {
    user_id: string;
    platform: string | null;
    app_version?: string | null;
    app_build?: string | null;
    os_version?: string | null;
    last_used_at?: string | null;
  };
  const deviceByUserId = new Map<string, DeviceTokenRow[]>();
  for (const row of (deviceTokens ?? []) as DeviceTokenRow[]) {
    const uid = String(row.user_id || '');
    if (!uid) continue;
    const arr = deviceByUserId.get(uid) ?? [];
    arr.push(row);
    deviceByUserId.set(uid, arr);
  }
  const newestDevice = (list: DeviceTokenRow[]): DeviceTokenRow | null =>
    list
      .slice()
      .sort((a, b) => {
        const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return tb - ta;
      })[0] ?? null;
  type CrewRow = { id: string; user_id: string; company_name: string | null; airline_icao: string | null };
  const crewByUserId = new Map(
    (crewProfilesRows ?? []).map((r: CrewRow) => [
      r.user_id,
      { id: r.id, company_name: r.company_name ?? null, airline_icao: r.airline_icao ?? null },
    ]),
  );
  type AdminUserConnection = {
    connection_id: string;
    status: string;
    side: 'crew' | 'family';
    other_user_id: string;
    other_full_name: string | null;
    other_email: string | null;
    /** Set when this user is the family side (linked crew profile company). */
    linked_crew_company: string | null;
  };

  const userRows = (profiles ?? []).map((p: { id: string; full_name?: string | null; role?: string | null }) => {
    const authU = authById.get(p.id);
    const crew = crewByUserId.get(p.id);
    const devices = deviceByUserId.get(p.id) ?? [];
    const platforms = [...new Set(devices.map((d) => String(d.platform ?? '').trim()).filter(Boolean))];
    const latestDevice = newestDevice(devices);
    return {
      id: p.id,
      id_short: shortId(p.id),
      full_name: p.full_name ?? null,
      role: p.role ?? null,
      created_at: (p as { created_at?: string | null }).created_at ?? null,
      updated_at: (p as { updated_at?: string | null }).updated_at ?? null,
      crew_id: crew?.id ?? null,
      company_name: crew?.company_name ?? null,
      airline_icao: crew?.airline_icao ?? null,
      email: authU?.email ?? null,
      last_sign_in_at: authU?.last_sign_in_at ?? null,
      device_platforms: platforms,
      device_platforms_text: platforms.join(', ') || null,
      app_version: latestDevice?.app_version ?? null,
      app_build: latestDevice?.app_build ?? null,
      os_version: latestDevice?.os_version ?? null,
      device_last_used_at: latestDevice?.last_used_at ?? null,
      device_count: devices.length,
      connections: [] as AdminUserConnection[],
      family_linked_crew_company: null as string | null,
      subscription: null as AdminSubscriptionSnapshot | null,
    };
  });

  const planByCode = new Map(
    ((subscriptionPlans ?? []) as PlanRow[]).map((p) => [String(p.code), p]),
  );
  const entitlementByUserId = new Map(
    ((userEntitlements ?? []) as Array<{ user_id: string; premium_active: boolean }>).map((e) => [
      String(e.user_id),
      !!e.premium_active,
    ]),
  );
  const subByCrewId = new Map<string, CrewSubRow>();
  for (const row of (crewSubscriptions ?? []) as Array<CrewSubRow & { updated_at?: string }>) {
    const crewId = String(row.crew_id || '');
    if (!crewId || subByCrewId.has(crewId)) continue;
    subByCrewId.set(crewId, row);
  }

  const profileById = new Map(userRows.map((u) => [u.id, u]));
  type CrewMeta = { user_id: string; company_name: string | null; airline_icao: string | null };
  const crewProfileAirlineDisplay = (meta: CrewMeta): string | null => {
    const n = String(meta.company_name ?? '').trim();
    if (n) return n;
    const ic = String(meta.airline_icao ?? '').trim();
    return ic || null;
  };
  const crewMetaByCrewId = new Map(
    (crewProfilesRows ?? []).map((r: CrewRow) => [
      r.id,
      { user_id: r.user_id, company_name: r.company_name ?? null, airline_icao: r.airline_icao ?? null } as CrewMeta,
    ]),
  );

  const { data: familyConnectionRows } = await adminClient
    .from('family_connections')
    .select('id, crew_id, family_id, status');

  const connectionsByUserId = new Map<string, AdminUserConnection[]>();
  const pushConn = (userId: string, c: AdminUserConnection) => {
    const arr = connectionsByUserId.get(userId) ?? [];
    arr.push(c);
    connectionsByUserId.set(userId, arr);
  };

  for (const fc of (familyConnectionRows ?? []) as Array<{
    id: string;
    crew_id: string;
    family_id: string;
    status: string;
  }>) {
    const meta = crewMetaByCrewId.get(fc.crew_id);
    if (!meta) continue;
    const crewUid = meta.user_id;
    const famUid = fc.family_id;
    const crewUser = profileById.get(crewUid);
    const famUser = profileById.get(famUid);
    const linkedAirline = crewProfileAirlineDisplay(meta);

    pushConn(crewUid, {
      connection_id: fc.id,
      status: fc.status,
      side: 'crew',
      other_user_id: famUid,
      other_full_name: famUser?.full_name ?? null,
      other_email: famUser?.email ?? null,
      linked_crew_company: null,
    });
    pushConn(famUid, {
      connection_id: fc.id,
      status: fc.status,
      side: 'family',
      other_user_id: crewUid,
      other_full_name: crewUser?.full_name ?? null,
      other_email: crewUser?.email ?? null,
      linked_crew_company: linkedAirline,
    });
  }

  const uniqNonEmpty = (values: (string | null | undefined)[]): string[] =>
    [...new Set(values.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0))];

  const connStatusRank = (s: string) => (s === 'approved' ? 0 : s === 'pending' ? 1 : 2);
  const familyApprovedByCrew = new Map<string, number>();
  const familyPendingByCrew = new Map<string, number>();

  for (const u of userRows) {
    const list = connectionsByUserId.get(u.id) ?? [];
    list.sort((a, b) =>
      connStatusRank(a.status) - connStatusRank(b.status) ||
      String(a.other_full_name || a.other_email || '').localeCompare(String(b.other_full_name || b.other_email || '')),
    );
    u.connections = list;
    if (String(u.role ?? '') === 'family') {
      const famSide = list.filter((c) => c.side === 'family' && c.status !== 'declined');
      const companies = uniqNonEmpty(famSide.map((c) => c.linked_crew_company));
      u.family_linked_crew_company = companies.length ? companies.join(' · ') : null;
    }
  }

  for (const fc of (familyConnectionRows ?? []) as Array<{ crew_id: string; status: string }>) {
    const crewId = String(fc.crew_id || '');
    if (!crewId) continue;
    if (fc.status === 'approved') {
      familyApprovedByCrew.set(crewId, (familyApprovedByCrew.get(crewId) ?? 0) + 1);
    } else if (fc.status === 'pending') {
      familyPendingByCrew.set(crewId, (familyPendingByCrew.get(crewId) ?? 0) + 1);
    }
  }

  const attachSubscriptionForCrew = (
    crewId: string,
    crewUserId: string | null,
    extras?: { read_only?: boolean; managed_crew_user_id?: string | null; managed_crew_name?: string | null },
  ): AdminSubscriptionSnapshot => {
    const sub = subByCrewId.get(crewId) ?? null;
    const plan = sub?.plan_code ? planByCode.get(sub.plan_code) ?? null : null;
    return buildSubscriptionSnapshot(
      crewId,
      sub,
      plan,
      familyApprovedByCrew.get(crewId) ?? 0,
      familyPendingByCrew.get(crewId) ?? 0,
      crewUserId ? entitlementByUserId.get(crewUserId) ?? null : null,
      extras,
    );
  };

  for (const u of userRows) {
    if (u.crew_id) {
      u.subscription = attachSubscriptionForCrew(String(u.crew_id), u.id);
      continue;
    }
    if (String(u.role ?? '') !== 'family') continue;
    const approvedConn = u.connections.find((c) => c.side === 'family' && c.status === 'approved');
    if (!approvedConn) continue;
    const crewUser = profileById.get(approvedConn.other_user_id);
    if (!crewUser?.crew_id) continue;
    u.subscription = attachSubscriptionForCrew(String(crewUser.crew_id), crewUser.id, {
      read_only: true,
      managed_crew_user_id: crewUser.id,
      managed_crew_name: crewUser.full_name ?? null,
    });
  }

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
    aircraft_registration?: string | null;
    flight_date?: string | null;
    scheduled_departure?: string | null;
    scheduled_arrival?: string | null;
    estimated_departure?: string | null;
    estimated_arrival?: string | null;
    actual_departure?: string | null;
    actual_arrival?: string | null;
    delay_dep_min?: number | null;
    delay_arr_min?: number | null;
    is_delayed?: boolean | null;
    internal_status?: string | null;
    diverted_to?: string | null;
    api_refresh_phase?: string | null;
    phase_active_locked?: boolean | null;
    flight_status?: string | null;
    fr24_progress_dep_utc?: string | null;
    fr24_progress_eta_utc?: string | null;
    fr24_datetime_takeoff_utc?: string | null;
    fr24_datetime_landed_utc?: string | null;
    fr24_first_seen_utc?: string | null;
    airlabs_progress_percent?: number | null;
    roster_entry_kind?: string | null;
    duty_rest_end?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }) => ({
    id: f.id,
    id_short: shortId(f.id),
    flight_number: f.flight_number ?? null,
    origin_airport: f.origin_airport ?? null,
    destination_airport: f.destination_airport ?? null,
    aircraft_registration: f.aircraft_registration ?? null,
    flight_date: f.flight_date ?? null,
    scheduled_departure: f.scheduled_departure ?? null,
    scheduled_arrival: f.scheduled_arrival ?? null,
    estimated_departure: f.estimated_departure ?? null,
    estimated_arrival: f.estimated_arrival ?? null,
    actual_departure: f.actual_departure ?? null,
    actual_arrival: f.actual_arrival ?? null,
    delay_dep_min: f.delay_dep_min ?? null,
    delay_arr_min: f.delay_arr_min ?? null,
    is_delayed: f.is_delayed ?? null,
    internal_status: f.internal_status ?? null,
    diverted_to: f.diverted_to ?? null,
    api_refresh_phase: f.api_refresh_phase ?? null,
    phase_active_locked: f.phase_active_locked ?? null,
    flight_status: f.flight_status ?? null,
    fr24_progress_dep_utc: f.fr24_progress_dep_utc ?? null,
    fr24_progress_eta_utc: f.fr24_progress_eta_utc ?? null,
    fr24_datetime_takeoff_utc: f.fr24_datetime_takeoff_utc ?? null,
    fr24_datetime_landed_utc: f.fr24_datetime_landed_utc ?? null,
    fr24_first_seen_utc: f.fr24_first_seen_utc ?? null,
    airlabs_progress_percent: f.airlabs_progress_percent ?? null,
    roster_entry_kind: f.roster_entry_kind ?? null,
    duty_rest_end: f.duty_rest_end ?? null,
    created_at: f.created_at ?? null,
    updated_at: f.updated_at ?? null,
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
  const fr24Token =
    Deno.env.get('FR24_API_TOKEN')?.trim() ||
    Deno.env.get('FR24API_TOKEN')?.trim() ||
    Deno.env.get('EXPO_PUBLIC_FR24API_TOKEN')?.trim() ||
    null;
  const fr24CooldownRow = (cooldownRows ?? []).find(
    (r: { provider: string }) => String(r.provider ?? '').toLowerCase() === 'fr24',
  ) as { blocked_until?: string | null } | undefined;
  const fr24InCooldown = !!(
    fr24CooldownRow?.blocked_until &&
    new Date(fr24CooldownRow.blocked_until).getTime() > Date.now()
  );
  const fr24LiveUsage =
    fr24LiveOnDashboardEnabled() && !fr24InCooldown
      ? await fetchFr24UsageLive(fr24Token)
      : null;
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

  const latestFr24Snapshot = ((fr24Snapshots ?? []) as Array<{
    fetched_at?: string | null;
    total_calls?: number | null;
    total_credits?: number | null;
    endpoint_count?: number | null;
  }>).at(-1) ?? null;
  const fr24SnapshotCredits = latestFr24Snapshot?.total_credits ?? null;
  const fr24SnapshotCalls = latestFr24Snapshot?.total_calls ?? null;

  const apiUsage = providers.map((provider) => {
    const quota = quotas[provider] ?? null;
    const fallbackUsed = monthlyUsage[provider] ?? null;
    const liveUsed = provider === 'fr24' ? fr24LiveUsage?.usedCredits ?? null : null;
    const snapshotUsed = provider === 'fr24' ? fr24SnapshotCredits : null;
    const used = liveUsed ?? snapshotUsed ?? fallbackUsed;
    const remaining = quota != null && used != null ? Math.max(0, quota - used) : null;
    const cooldown = (cooldownRows ?? []).find(
      (r: { provider: string }) => normalizeEmail(r.provider) === provider,
    ) as { blocked_until?: string | null; updated_at?: string | null } | undefined;
    const fr24Source =
      liveUsed != null ? 'live' : snapshotUsed != null ? 'snapshot' : 'fallback';
    return {
      provider,
      month: monthKey,
      quota_monthly: quota,
      used_monthly: used,
      source: provider === 'fr24' ? fr24Source : liveUsed != null ? 'live' : 'fallback',
      last_updated:
        provider === 'fr24'
          ? fr24LiveUsage?.fetchedAt ?? latestFr24Snapshot?.fetched_at ?? null
          : null,
      fr24_request_count:
        provider === 'fr24'
          ? fr24LiveUsage?.requestCount ?? fr24SnapshotCalls ?? null
          : null,
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

  const phaseRefreshPing = ((healthPings ?? []) as Array<{
    name?: string | null;
    last_run_at?: string | null;
    last_success_at?: string | null;
    last_error?: string | null;
    last_rows_updated?: number | null;
    updated_at?: string | null;
  }>)[0] ?? null;
  const phaseSuccessMs = phaseRefreshPing?.last_success_at
    ? new Date(phaseRefreshPing.last_success_at).getTime()
    : NaN;
  const phaseHealthy = Number.isFinite(phaseSuccessMs) && Date.now() - phaseSuccessMs <= 6 * 60 * 1000;

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
    subscriptions: {
      plans: (subscriptionPlans ?? []) as PlanRow[],
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
      fr24_live_skipped: !fr24LiveOnDashboardEnabled()
        ? 'ADMIN_FR24_LIVE_ON_DASHBOARD not enabled (default off — avoids /api/usage 429)'
        : fr24InCooldown
          ? 'FR24 provider cooldown active'
          : null,
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
        'FR24 live on dashboard refresh is OFF by default (set ADMIN_FR24_LIVE_ON_DASHBOARD=true to enable). Used column prefers live → last DB snapshot → ADMIN_PROVIDER_MONTHLY_USAGE_JSON.',
        'FR24 history is read from fr24_usage_metric_snapshots/fr24_usage_metric_points (filled by sync-fr24-usage-metrics or admin “Fetch FR24 usage”).',
        'If sync returns 429, wait before retrying — flight-status cron and manual sync share the same FR24 token quota.',
        'Monthly usage values come from ADMIN_PROVIDER_MONTHLY_USAGE_JSON if set.',
        'Quotas come from ADMIN_PROVIDER_QUOTAS_JSON if set.',
      ],
    },
    health: {
      phase_refresh: phaseRefreshPing
        ? {
            status: phaseHealthy ? 'ok' : 'stale',
            healthy: phaseHealthy,
            last_run_at: phaseRefreshPing.last_run_at ?? null,
            last_success_at: phaseRefreshPing.last_success_at ?? null,
            last_error: phaseRefreshPing.last_error ?? null,
            last_rows_updated: phaseRefreshPing.last_rows_updated ?? null,
            updated_at: phaseRefreshPing.updated_at ?? null,
          }
        : {
            status: 'missing',
            healthy: false,
            last_run_at: null,
            last_success_at: null,
            last_error: 'phase_refresh ping not found',
            last_rows_updated: null,
            updated_at: null,
          },
    },
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[admin-dashboard] GET error:', msg);
    return new Response(JSON.stringify({ error: msg || 'Dashboard load failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

