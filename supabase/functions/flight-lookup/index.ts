// Public lookup endpoint (auth optional). Anahtarlar yalnız Edge secret.
// mode: roster | by_number | fr24_summary

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchFlightByNumberEdge, fetchFromFlightradar24Edge } from '../_shared/flightByNumberEdge.ts';
import { getCachedPayload, setCachedPayload } from '../_shared/providerResponseCache.ts';
import { loadCooldownUntilByProvider } from '../_shared/providerCooldown.ts';
import { rosterPollCacheKey } from '../_shared/rosterPollCacheKey.ts';
import { pollRosterFlightEdge, type RosterPollPhase } from '../_shared/rosterPollEdge.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const inFlight = new Map<string, Promise<Record<string, unknown> | null>>();

function cacheKeyByNumber(
  flightNumber: string,
  flightDate: string,
  localToday: string,
  localTomorrow: string,
): string {
  const n = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  return `flight_by_number:v1:${n}:${flightDate}:${localToday}:${localTomorrow}`;
}

function ttlMsRoster(phase: RosterPollPhase): number {
  return phase === 'active' ? 45_000 : 90_000;
}

const TTL_BY_NUMBER_MS = 120_000;
/** fr24_summary: kısa önbellek — aynı linke tekrar tıklanınca FR24’e gitme (TTL = ne kadar süre “taze” sayılacağı, ms). */
const TTL_FR24_SUMMARY_MS = 60_000;

function cacheKeyFr24Summary(flightNumber: string, flightDate: string): string {
  const n = flightNumber.replace(/\s/g, '').trim().toUpperCase();
  return `fr24_summary:v1:${n}:${flightDate}`;
}

type JsonBody = {
  mode?: string;
  flight_number?: string;
  flight_date?: string;
  phase?: string;
  local_today?: string;
  local_tomorrow?: string;
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: JsonBody;
  try {
    body = await req.json() as JsonBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const flight_number = String(body.flight_number ?? '').trim();
  const flight_date = String(body.flight_date ?? '').trim();
  if (!flight_number || flight_date.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(flight_date)) {
    return new Response(JSON.stringify({ error: 'flight_number and flight_date (YYYY-MM-DD) required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const modeRaw = String(body.mode ?? '').trim().toLowerCase();
  const mode = modeRaw === 'by_number'
    ? 'by_number'
    : modeRaw === 'fr24_summary'
    ? 'fr24_summary'
    : 'roster';

  if (mode === 'fr24_summary') {
    const key = cacheKeyFr24Summary(flight_number, flight_date);
    const cached = await getCachedPayload(supabase, key);
    if (cached) {
      return new Response(JSON.stringify({ info: cached, cached: true, mode: 'fr24_summary' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let promise = inFlight.get(key);
    if (!promise) {
      promise = (async () => {
        try {
          const cooldownMap = await loadCooldownUntilByProvider(supabase);
          const airlabsKey = Deno.env.get('AIRLABS_API_KEY') ?? Deno.env.get('EXPO_PUBLIC_AIRLABS_API_KEY') ?? null;
          const fr24Token = Deno.env.get('FR24_API_TOKEN') ?? null;
          const info = await fetchFromFlightradar24Edge(
            { supabase, cooldownMap, airlabsKey, fr24Token },
            flight_number,
            flight_date,
          );
          if (info) {
            await setCachedPayload(supabase, key, info, Date.now() + TTL_FR24_SUMMARY_MS);
          }
          return info;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
    }
    const info = await promise;
    return new Response(JSON.stringify({ info, cached: false, mode: 'fr24_summary' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (mode === 'by_number') {
    const local_today = String(body.local_today ?? '').trim();
    const local_tomorrow = String(body.local_tomorrow ?? '').trim();
    if (!local_today || !local_tomorrow || !/^\d{4}-\d{2}-\d{2}$/.test(local_today) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(local_tomorrow)
    ) {
      return new Response(
        JSON.stringify({ error: 'by_number requires local_today and local_tomorrow (YYYY-MM-DD)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const key = cacheKeyByNumber(flight_number, flight_date, local_today, local_tomorrow);
    const cached = await getCachedPayload(supabase, key);
    if (cached) {
      return new Response(JSON.stringify({ info: cached, cached: true, mode: 'by_number' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let promise = inFlight.get(key);
    if (!promise) {
      promise = (async () => {
        try {
          const cooldownMap = await loadCooldownUntilByProvider(supabase);
          const airlabsKey = Deno.env.get('AIRLABS_API_KEY') ?? Deno.env.get('EXPO_PUBLIC_AIRLABS_API_KEY') ?? null;
          const fr24Token = Deno.env.get('FR24_API_TOKEN') ?? null;
          const info = await fetchFlightByNumberEdge(flight_number, flight_date, local_today, local_tomorrow, {
            supabase,
            cooldownMap,
            airlabsKey,
            fr24Token,
          });
          if (info) {
            await setCachedPayload(supabase, key, info, Date.now() + TTL_BY_NUMBER_MS);
          }
          return info;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
    }
    const info = await promise;
    return new Response(JSON.stringify({ info, cached: false, mode: 'by_number' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const phase: RosterPollPhase = body.phase === 'active' ? 'active' : 'semi_active';
  const key = rosterPollCacheKey(phase, flight_number, flight_date);

  const cached = await getCachedPayload(supabase, key);
  if (cached) {
    return new Response(JSON.stringify({ info: cached, cached: true, mode: 'roster' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let promise = inFlight.get(key);
  if (!promise) {
    promise = (async () => {
      try {
        const cooldownMap = await loadCooldownUntilByProvider(supabase);
        const airlabsKey = Deno.env.get('AIRLABS_API_KEY') ?? Deno.env.get('EXPO_PUBLIC_AIRLABS_API_KEY') ?? null;
        const fr24Token = Deno.env.get('FR24_API_TOKEN') ?? null;
        const info = await pollRosterFlightEdge(flight_number, flight_date, phase, {
          supabase,
          cooldownMap,
          airlabsKey,
          fr24Token,
        });
        if (info) {
          await setCachedPayload(supabase, key, info, Date.now() + ttlMsRoster(phase));
        }
        return info;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);
  }

  const info = await promise;
  return new Response(JSON.stringify({ info, cached: false, mode: 'roster' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
