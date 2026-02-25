// Supabase Edge Function: send push notifications to family users via Expo Push API.
// Body: { type: 'today_flights', crewId, date } | { type: 'took_off'|'landed', flightId }
// For daily digest, caller can use header x-cron-secret to bypass auth (set CRON_SECRET in Supabase secrets).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface TodayFlightsPayload {
  type: 'today_flights';
  crewId: string;
  date: string; // YYYY-MM-DD
}

interface FlightEventPayload {
  type: 'took_off' | 'landed';
  flightId: string;
}

interface TestPayload {
  type: 'test';
}

type Payload = TodayFlightsPayload | FlightEventPayload | TestPayload;

function formatTimeLocal(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function sendExpoPush(tokens: string[], title: string, body: string): Promise<void> {
  if (tokens.length === 0) return;
  const messages = tokens.map((token) => ({
    to: token,
    title,
    body,
    sound: 'default' as const,
  }));
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Expo push failed:', res.status, t);
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!supabaseUrl || !anonKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_ANON_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  const cronHeader = req.headers.get('x-cron-secret');
  const isCron = !!cronSecret && cronHeader === cronSecret;

  if (!payload || typeof payload.type !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing type in body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Simple self-test: sends a push to the authenticated user's own devices.
  if (payload.type === 'test') {
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const jwt = authHeader.slice(7);
    // Use anon client + user JWT so this works even if service role secret isn't set yet.
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token', details: authError?.message ?? null }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: tokens } = await supabaseUser.from('device_tokens').select('token').eq('user_id', user.id);
    const pushTokens = (tokens ?? []).map((t) => t.token).filter(Boolean);
    const title = 'FlyFam';
    const body = `Test notification (${new Date().toISOString().slice(11, 19)}Z)`;
    await sendExpoPush(pushTokens, title, body);
    return new Response(JSON.stringify({ ok: true, sent: pushTokens.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Everything below needs service role (read other users' tokens/preferences).
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  if (payload.type === 'today_flights') {
    const body = payload as TodayFlightsPayload & { cron?: boolean };
    const today = new Date().toISOString().slice(0, 10);
    let crewIdsToProcess: { crewId: string; date: string }[] = [];

    // Crew-initiated: Bearer JWT + crewId + date (button "Send flights to my family")
    if (body.crewId && body.date && authHeader?.startsWith('Bearer ')) {
      const jwt = authHeader.slice(7);
      const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: crewRow } = await supabase
        .from('crew_profiles')
        .select('id')
        .eq('id', body.crewId)
        .eq('user_id', user.id)
        .single();
      if (!crewRow) {
        return new Response(JSON.stringify({ error: 'Not your crew profile' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      crewIdsToProcess = [{ crewId: body.crewId, date: body.date }];
    } else if (isCron && body.cron) {
      // Scheduled cron: x-cron-secret + cron: true (optional; can be disabled)
      const { data: flightsToday } = await supabase
        .from('flights')
        .select('crew_id, flight_date')
        .eq('flight_date', today);
      const seen = new Set<string>();
      for (const f of flightsToday ?? []) {
        const key = `${f.crew_id}:${f.flight_date}`;
        if (!seen.has(key)) {
          seen.add(key);
          crewIdsToProcess.push({ crewId: f.crew_id, date: f.flight_date });
        }
      }
    } else {
      return new Response(JSON.stringify({ error: 'today_flights requires Authorization + crewId + date, or x-cron-secret + cron: true' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (crewIdsToProcess.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalSent = 0;
    for (const { crewId, date } of crewIdsToProcess) {
      const { data: crew } = await supabase
        .from('crew_profiles')
        .select('id, user_id')
        .eq('id', crewId)
        .single();
      if (!crew) continue;
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', crew.user_id).single();
      const crewName = (profile?.full_name || 'Crew').trim() || 'Crew';

      const { data: flights } = await supabase
        .from('flights')
        .select('id, scheduled_departure')
        .eq('crew_id', crewId)
        .eq('flight_date', date)
        .order('scheduled_departure', { ascending: true });
      const legs = flights?.length ?? 0;
      const firstDep = flights?.[0]?.scheduled_departure ?? null;
      const startTime = formatTimeLocal(firstDep);

      const { data: conns } = await supabase
        .from('family_connections')
        .select('id, family_id')
        .eq('crew_id', crewId)
        .eq('status', 'approved');
      if (!conns?.length) continue;

      const familyIds = conns.map((c) => c.family_id);
      const connectionIds = conns.map((c) => c.id);
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('user_id, connection_id, today_flights')
        .in('connection_id', connectionIds);
      const disabledForConnection = new Set<string>();
      for (const p of prefs ?? []) {
        if (p.today_flights === false) disabledForConnection.add(`${p.user_id}:${p.connection_id}`);
      }
      const allowed = familyIds.filter((familyId) => {
        const conn = conns.find((c) => c.family_id === familyId);
        if (!conn) return false;
        return !disabledForConnection.has(`${familyId}:${conn.id}`);
      });
      if (allowed.length === 0) continue;

      const { data: tokens } = await supabase.from('device_tokens').select('token').in('user_id', allowed);
      const pushTokens = (tokens ?? []).map((t) => t.token).filter(Boolean);
      const legWord = legs === 1 ? 'leg' : 'legs';
      const title = 'FlyFam';
      const body = `${crewName} has ${legs} ${legWord} today. His duty will start at ${startTime}.`;
      await sendExpoPush(pushTokens, title, body);
      totalSent += pushTokens.length;
    }
    return new Response(JSON.stringify({ ok: true, sent: totalSent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (payload.type === 'took_off' || payload.type === 'landed') {
    const { flightId } = payload as FlightEventPayload;
    if (!flightId) {
      return new Response(JSON.stringify({ error: 'took_off/landed requires flightId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const jwt = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: flight, error: flightError } = await supabase
      .from('flights')
      .select('id, crew_id, origin_city, origin_airport, destination_city, destination_airport')
      .eq('id', flightId)
      .single();
    if (flightError || !flight) {
      return new Response(JSON.stringify({ error: 'Flight not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: crewRow } = await supabase
      .from('crew_profiles')
      .select('user_id')
      .eq('id', flight.crew_id)
      .single();
    if (!crewRow || crewRow.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Not your flight' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profileRow } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
    const crewName = (profileRow?.full_name || 'Crew').trim() || 'Crew';

    const { data: conns2 } = await supabase
      .from('family_connections')
      .select('id, family_id')
      .eq('crew_id', flight.crew_id)
      .eq('status', 'approved');
    if (!conns2?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const notifType = payload.type === 'took_off' ? 'took_off' : 'landed';
    const prefKey = payload.type === 'took_off' ? 'took_off' : 'landed';
    const connectionIds2 = conns2.map((c) => c.id);
    const { data: prefs2 } = await supabase
      .from('notification_preferences')
      .select('user_id, connection_id, ' + prefKey)
      .in('connection_id', connectionIds2);
    const disabled2 = new Set<string>();
    for (const p of prefs2 ?? []) {
      if ((p as Record<string, boolean>)[prefKey] === false) disabled2.add(`${p.user_id}:${p.connection_id}`);
    }
    const allowed2 = conns2
      .filter((c) => !disabled2.has(`${c.family_id}:${c.id}`))
      .map((c) => c.family_id);

    const { data: existingLog } = await supabase
      .from('notification_log')
      .select('id')
      .eq('flight_id', flightId)
      .eq('type', notifType)
      .in('user_id', allowed2)
      .limit(1);
    if (existingLog?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: tokens2 } = await supabase.from('device_tokens').select('token').in('user_id', allowed2);
    const pushTokens2 = (tokens2 ?? []).map((t) => t.token).filter(Boolean);

    let title: string;
    let body: string;
    const cityFrom = (flight.origin_city || flight.origin_airport || 'unknown').trim();
    const cityTo = (flight.destination_city || flight.destination_airport || 'unknown').trim();
    if (payload.type === 'took_off') {
      title = 'FlyFam';
      body = `${crewName} has departed from ${cityFrom}.`;
    } else {
      title = 'FlyFam';
      body = `${crewName} has landed to ${cityTo}.`;
    }
    await sendExpoPush(pushTokens2, title, body);

    for (const uid of allowed2) {
      await supabase.from('notification_log').insert({
        user_id: uid,
        flight_id: flightId,
        type: notifType,
      });
    }

    return new Response(JSON.stringify({ ok: true, sent: pushTokens2.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown type' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
