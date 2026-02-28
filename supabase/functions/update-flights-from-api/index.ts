// Edge Function: apply flight updates from API (e.g. when family taps Update).
// Body: { updates: Array<{ flightId, scheduled_departure?, scheduled_arrival?, actual_departure?, actual_arrival?, flight_status?, origin_city?, destination_city?, is_delayed? }> }
// Caller must be family with approved connection to the flight's crew.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

function extractMissingColumn(msg: string): string | null {
  const s = String(msg ?? '');
  // e.g. "column flights.schedule_unconfirmed does not exist"
  const m1 = s.match(/column\s+\w+\.(\w+)\s+does not exist/i);
  if (m1?.[1]) return m1[1];
  // e.g. "Could not find the 'schedule_unconfirmed' column"
  const m2 = s.match(/Could not find the '([^']+)' column/i);
  if (m2?.[1]) return m2[1];
  return null;
}

async function updateWithMissingColumnRetry(
  supabase: any,
  flightId: string,
  payload: Record<string, unknown>,
  maxStrips = 5
): Promise<{ ok: boolean; stripped: string[]; lastError?: string }> {
  const stripped: string[] = [];
  let current = { ...payload };
  for (let i = 0; i <= maxStrips; i++) {
    if (Object.keys(current).length === 0) return { ok: false, stripped };
    const { error } = await supabase.from('flights').update(current).eq('id', flightId);
    if (!error) return { ok: true, stripped };
    const msg = String((error as any)?.message ?? '');
    const missing = extractMissingColumn(msg);
    if (!missing) return { ok: false, stripped, lastError: msg };
    if (missing in current) {
      stripped.push(missing);
      delete (current as any)[missing];
      continue;
    }
    // Missing column not in our payload; don't loop forever.
    return { ok: false, stripped, lastError: msg };
  }
  return { ok: false, stripped, lastError: 'too many retries' };
}

interface FlightUpdate {
  flightId: string;
  scheduled_departure?: string | null;
  scheduled_arrival?: string | null;
  actual_departure?: string | null;
  actual_arrival?: string | null;
  flight_status?: string | null;
  origin_city?: string | null;
  destination_city?: string | null;
  is_delayed?: boolean | null;
  schedule_unconfirmed?: boolean | null;
  schedule_source_hint?: string | null;
  diverted_to?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authorization required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let body: { updates?: FlightUpdate[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const updates = body?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return new Response(JSON.stringify({ error: 'updates array required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const flightIds = updates.map((u) => u.flightId).filter(Boolean);
  const { data: flights } = await supabase.from('flights').select('id, crew_id').in('id', flightIds);
  const crewIds = new Set((flights ?? []).map((f) => f.crew_id));
  const { data: conns } = await supabase
    .from('family_connections')
    .select('crew_id')
    .eq('family_id', user.id)
    .eq('status', 'approved');
  const allowedCrewIds = new Set((conns ?? []).map((c) => c.crew_id));
  const allowedFlightIds = new Set((flights ?? []).filter((f) => allowedCrewIds.has(f.crew_id)).map((f) => f.id));

  let applied = 0;
  for (const u of updates) {
    if (!u.flightId || !allowedFlightIds.has(u.flightId)) continue;
    // Update in two phases so missing actual_* columns don't block scheduled_* updates.
    const payloadScheduled: Record<string, unknown> = {};
    if (u.scheduled_departure !== undefined) payloadScheduled.scheduled_departure = u.scheduled_departure;
    if (u.scheduled_arrival !== undefined) payloadScheduled.scheduled_arrival = u.scheduled_arrival;
    if (u.flight_status !== undefined) payloadScheduled.flight_status = u.flight_status;
    if (u.origin_city !== undefined) payloadScheduled.origin_city = u.origin_city;
    if (u.destination_city !== undefined) payloadScheduled.destination_city = u.destination_city;
    if (u.is_delayed !== undefined) payloadScheduled.is_delayed = u.is_delayed;
    if (u.schedule_unconfirmed !== undefined) payloadScheduled.schedule_unconfirmed = u.schedule_unconfirmed;
    if (u.schedule_source_hint !== undefined) payloadScheduled.schedule_source_hint = u.schedule_source_hint;
    if (u.diverted_to !== undefined) payloadScheduled.diverted_to = u.diverted_to;

    const payloadActual: Record<string, unknown> = {};
    if (u.actual_departure !== undefined) payloadActual.actual_departure = u.actual_departure;
    if (u.actual_arrival !== undefined) payloadActual.actual_arrival = u.actual_arrival;

    let ok = false;
    if (Object.keys(payloadScheduled).length > 0) {
      const res = await updateWithMissingColumnRetry(supabase, u.flightId, payloadScheduled);
      if (res.ok) ok = true;
      else if (res.lastError) console.error('update-flights-from-api scheduled update failed:', u.flightId, res.lastError, { stripped: res.stripped });
    }
    if (Object.keys(payloadActual).length > 0) {
      const res = await updateWithMissingColumnRetry(supabase, u.flightId, payloadActual);
      if (res.ok) ok = true;
      else if (res.lastError) console.error('update-flights-from-api actual update failed:', u.flightId, res.lastError, { stripped: res.stripped });
    }
    if (ok) applied++;
  }

  return new Response(JSON.stringify({ ok: true, applied }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
