// Periyodik: hub ADB tahtalarını çekip hub_airport_board_cache tablosuna yazar (kimse online olmasa da).
// GET veya POST + header x-cron-secret: CRON_SECRET (tarayıcı / bazı cron’lar GET atar → 405 önlemek için).
// Secrets: AERODATABOX_RAPIDAPI_KEY veya RAPIDAPI_KEY (+ SUPABASE_*).
// Force: POST gövde { "force": true } veya GET ?force=1 — tazelik kontrolünü atla.
// Zamanlayıcı: cron-job.org (timeout genelde max ~30 sn).
// Varsayılan: bugün + 3 hub (12 URL), sıralı istek, HUB_BOARD_MAX_WALL_MS≈22s sonra ADB durur (timeout önleme); kalan URL’ler sonraki cron’da. DB birleştirme ile kısmi tur güvenli.
// Secrets: HUB_BOARD_MAX_WALL_MS=0 sınırsız; HUB_BOARD_429_SECOND_WAIT_MS>0 üçüncü deneme (uzun sürer). Tablo yoksa PGRST205 → migration + API şema yenileme.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  fetchMergedHubAirportBoardRows,
  getHubBoardHubsForRun,
  HUB_AIRPORT_BOARD_HUBS_IATA,
  hubBoardRowCacheKey,
} from '../_shared/hubAirportBoardAdbSync.ts';
import { istanbulCalendarDate, istanbulSlotKey } from '../_shared/hubAirportBoardIstanbul.ts';

const AERODATABOX_RAPIDAPI_FALLBACK = '15e502192bmsh69e44f588a1f748p1f3145jsnb8957fc1856c';
const CACHE_ID = 'singleton';
/** Tam hub turunda: sık cron ADB yakmasın. */
const SKIP_IF_NEWER_THAN_MS = 11 * 60 * 60 * 1000;
/**
 * Dönüşümlü hub (HUB_BOARD_MAX_HUBS < 6): slot_key yarım günlük olduğu için 11 saatlik skip
 * saatlik hub dilimini güncellemeyi engeller; daha kısa pencere kullan.
 */
const SKIP_IF_PARTIAL_HUB_MS = 45 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
};

function supabaseErrFields(e: { message: string; code?: string; details?: string; hint?: string }) {
  return {
    message: e.message,
    code: e.code ?? null,
    details: e.details ?? null,
    hint: e.hint ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed', allowed: ['GET', 'POST', 'OPTIONS'] }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const rapidKey =
    (Deno.env.get('AERODATABOX_RAPIDAPI_KEY') ?? Deno.env.get('RAPIDAPI_KEY') ??
      Deno.env.get('EXPO_PUBLIC_AERODATABOX_RAPIDAPI_KEY') ?? '').trim() || AERODATABOX_RAPIDAPI_FALLBACK;

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

  let force = false;
  let calendarDays: 1 | 2 = Deno.env.get('HUB_BOARD_SYNC_DAYS') === '2' ? 2 : 1;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const f = url.searchParams.get('force');
    force = f === '1' || f === 'true';
    const d = url.searchParams.get('days');
    if (d === '2') calendarDays = 2;
    if (d === '1') calendarDays = 1;
  } else {
    try {
      const body = await req.json().catch(() => null) as {
        force?: boolean;
        calendarDays?: number;
      } | null;
      if (body?.force === true) force = true;
      if (body?.calendarDays === 2) calendarDays = 2;
      if (body?.calendarDays === 1) calendarDays = 1;
    } catch {
      /* ignore */
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const now = new Date();
  const anchorWant = istanbulCalendarDate(now);
  const slotWant = istanbulSlotKey(now);
  const hubsThisRun = getHubBoardHubsForRun(now);
  const partialHubRun = hubsThisRun.length < HUB_AIRPORT_BOARD_HUBS_IATA.length;
  const skipIfNewerMs = partialHubRun ? SKIP_IF_PARTIAL_HUB_MS : SKIP_IF_NEWER_THAN_MS;

  if (!force) {
    const { data: existing, error: existingErr } = await supabase
      .from('hub_airport_board_cache')
      .select('anchor_day, slot_key, fetched_at, row_count')
      .eq('id', CACHE_ID)
      .maybeSingle();

    if (existingErr) {
      console.error('[sync-hub-airport-boards] read cache', existingErr.message, existingErr.code);
      if (existingErr.code === 'PGRST205') {
        return new Response(
          JSON.stringify({
            ok: false,
            supabase: supabaseErrFields(existingErr),
            fix: 'Table missing or not in API schema: run migration 20260412130000_hub_airport_board_cache then `supabase db push`.',
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    if (existing?.fetched_at && Number(existing.row_count) > 0) {
      const fetchedMs = new Date(String(existing.fetched_at)).getTime();
      const fresh = Number.isFinite(fetchedMs) && now.getTime() - fetchedMs < skipIfNewerMs;
      const sameSlot = String(existing.slot_key) === slotWant;
      const sameDay = String(existing.anchor_day) === anchorWant;
      if (fresh && sameSlot && sameDay) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            reason: 'fresh_cache',
            rowCount: existing.row_count,
            fetchedAt: existing.fetched_at,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }
  }

  const t0 = Date.now();
  let sync: Awaited<ReturnType<typeof fetchMergedHubAirportBoardRows>>;
  try {
    sync = await fetchMergedHubAirportBoardRows(rapidKey, now, { calendarDays });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[sync-hub-airport-boards] fetch failed', msg);
    await supabase.from('hub_airport_board_cache').upsert(
      {
        id: CACHE_ID,
        version: 2,
        anchor_day: anchorWant,
        slot_key: slotWant,
        time_zone: 'Europe/Istanbul',
        rows: [],
        row_count: 0,
        fetched_at: now.toISOString(),
        updated_at: now.toISOString(),
        fetch_duration_ms: Date.now() - t0,
        last_error: msg.slice(0, 2000),
      },
      { onConflict: 'id' },
    );
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let mergedRows: Record<string, unknown>[] = sync.rows;
  const allHubCount = HUB_AIRPORT_BOARD_HUBS_IATA.length;
  if (sync.hubsInRun.length < allHubCount) {
    const { data: prevPack, error: prevReadErr } = await supabase
      .from('hub_airport_board_cache')
      .select('rows, anchor_day')
      .eq('id', CACHE_ID)
      .maybeSingle();
    if (
      !prevReadErr &&
      prevPack?.anchor_day &&
      String(prevPack.anchor_day) === sync.anchorDay &&
      Array.isArray(prevPack.rows)
    ) {
      const map = new Map<string, Record<string, unknown>>();
      for (const r of prevPack.rows) {
        if (r && typeof r === 'object' && !Array.isArray(r)) {
          const row = r as Record<string, unknown>;
          map.set(hubBoardRowCacheKey(row), row);
        }
      }
      for (const r of sync.rows) {
        map.set(hubBoardRowCacheKey(r), r);
      }
      mergedRows = [...map.values()];
    }
  }

  let rowsForDb: unknown[];
  try {
    rowsForDb = JSON.parse(JSON.stringify(mergedRows)) as unknown[];
  } catch (serErr) {
    const msg = serErr instanceof Error ? serErr.message : String(serErr);
    return new Response(JSON.stringify({ ok: false, error: 'rows_json_failed', detail: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const duration = Date.now() - t0;
  const { error: upErr } = await supabase.from('hub_airport_board_cache').upsert(
    {
      id: CACHE_ID,
      version: sync.version,
      anchor_day: sync.anchorDay,
      slot_key: sync.slotKey,
      time_zone: 'Europe/Istanbul',
      rows: rowsForDb,
      row_count: rowsForDb.length,
      fetched_at: now.toISOString(),
      updated_at: now.toISOString(),
      fetch_duration_ms: duration,
      last_error: null,
    },
    { onConflict: 'id' },
  );

  if (upErr) {
    console.error('[sync-hub-airport-boards] upsert', upErr.message, upErr.code, upErr.details);
    return new Response(
      JSON.stringify({
        ok: false,
        supabase: supabaseErrFields(upErr),
        rowCount: rowsForDb.length,
        hint: upErr.code === 'PGRST205'
          ? 'Run migration 20260412130000 then Supabase Dashboard → Settings → API → Reload schema (veya birkaç dk bekle).'
          : 'Check response `supabase.details` (e.g. payload size, column type).',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  console.log('[sync-hub-airport-boards] ok', {
    rowCount: rowsForDb.length,
    urlJobsPlanned: sync.urlsFetched,
    urlsCompleted: sync.urlsCompleted,
    stoppedEarly: sync.stoppedEarly,
    hubsInRun: sync.hubsInRun,
    calendarDays: sync.calendarDays,
    durationMs: duration,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      rowCount: rowsForDb.length,
      urlsFetched: sync.urlsFetched,
      urlsCompleted: sync.urlsCompleted,
      stoppedEarly: sync.stoppedEarly,
      hubsInRun: sync.hubsInRun,
      calendarDays: sync.calendarDays,
      anchorDay: sync.anchorDay,
      slotKey: sync.slotKey,
      fetchDurationMs: duration,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
