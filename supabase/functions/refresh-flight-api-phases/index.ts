// Harici API yok — yalnızca DB’de api_refresh_phase günceller (scheduled dep/arr + now()).
// POST + header x-cron-secret: <CRON_SECRET> (check-flight-status ile aynı).
// Dış zamanlayıcı: örn. her 2 dk (GitHub Actions, cron-job.org) veya pg_cron migration (*/2).
// check-flight-status-and-notify bundan ÖNCE veya daha sık çalışmalı ki fazlar güncel olsun.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid or missing x-cron-secret' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.rpc('refresh_flights_api_refresh_phase');

  if (error) {
    console.error('[refresh-flight-api-phases]', error.message);
    await supabase
      .from('system_health_pings')
      .upsert(
        {
          name: 'phase_refresh',
          last_run_at: new Date().toISOString(),
          last_error: error.message,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'name' },
      );
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const rows = typeof data === 'number' ? data : 0;
  await supabase
    .from('system_health_pings')
    .upsert(
      {
        name: 'phase_refresh',
        last_run_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error: null,
        last_rows_updated: rows,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'name' },
    );
  console.log('[refresh-flight-api-phases] rows updated', rows);
  return new Response(JSON.stringify({ ok: true, rowsUpdated: rows }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
