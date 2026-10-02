/**
 * Roster PDF içe aktarma — sunucu tarafı (mobil yalnız PDF'i gönderir).
 * Parse: `parse-roster-pdf` (kullanıcı JWT'si iletilir) → mobil ile aynı birleştirme → paylaşılan plan + RPC.
 * RPC'ler kullanıcının kendi oturumuyla çalışır (`add_me_to_flight` / `remove_me_from_flight` / RLS aynı).
 * `dry_run`: yazmadan parse + birleştirme + plan özeti döner.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mergePdfRowsFromTextParse } from '../_shared/roster-import/merge.ts';
import { buildRosterImportPlan } from '../_shared/roster-import/plan.ts';
import { runRosterImport } from '../_shared/roster-import/run.ts';
import type { PdfFlightRow } from '../_shared/roster-pdf/types.ts';
import { isRosterPdfImportSupportedForCrewAirline } from '../_shared/roster-pdf/crewAirlineFilter.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_PDF_B64 = 14_000_000;
const MAX_DEVICE_TEXT = 400_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function shortText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!jwt) return json({ error: 'Authorization required' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: authData, error: authErr } = await admin.auth.getUser(jwt);
  const uid = authData?.user?.id;
  if (authErr || !uid) return json({ error: 'Unauthorized' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const body = (await req.json().catch(() => null)) as {
    pdf_base64?: string;
    device_text?: string;
    dry_run?: boolean;
    app_version?: string;
    app_build?: string;
    platform?: string;
  } | null;
  const b64 = typeof body?.pdf_base64 === 'string' ? body.pdf_base64 : '';
  if (b64.length < 20) return json({ error: 'pdf_base64 required' }, 400);
  if (b64.length > MAX_PDF_B64) return json({ error: 'PDF too large' }, 413);
  const deviceText = typeof body?.device_text === 'string' ? body.device_text.slice(0, MAX_DEVICE_TEXT) : '';
  const dryRun = body?.dry_run === true;

  const { data: crew } = await userClient
    .from('crew_profiles')
    .select('id, airline_icao, home_base_iata')
    .eq('user_id', uid)
    .maybeSingle();
  if (!crew?.id) return json({ error: 'Crew profile not found', code: 'no_crew' }, 400);
  const icao = String(crew.airline_icao ?? '').trim().toUpperCase();
  if (!icao) return json({ error: 'Airline required', code: 'airline_required' }, 400);
  if (!isRosterPdfImportSupportedForCrewAirline(icao)) {
    return json({ error: 'Airline not supported', code: 'airline_unsupported' }, 400);
  }

  const parseRes = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/parse-roster-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: anonKey },
    body: JSON.stringify({ pdf_base64: b64, crew_airline_icao: icao }),
  });
  const parsed = (await parseRes.json().catch(() => null)) as {
    error?: string;
    text?: string;
    flights?: PdfFlightRow[];
    parser_debug_source?: string;
  } | null;
  if (!parseRes.ok || !parsed || parsed.error) {
    return json({ error: `parse failed: ${parsed?.error ?? parseRes.status}`, code: 'parse_failed' }, 502);
  }

  const edgeText = String(parsed.text ?? '').trim();
  const edgeFlights = Array.isArray(parsed.flights) ? parsed.flights : [];
  // Mobil `parseRosterPdfFromDevice` + ekran birleştirmesi ile aynı sıra: Edge metni, sonra cihaz metni (SXS hariç).
  let rows = icao === 'SXS' || !edgeText ? edgeFlights : mergePdfRowsFromTextParse(edgeFlights, edgeText);
  let rawText: string | null = edgeText || null;
  if (icao !== 'SXS' && deviceText.trim()) {
    rows = mergePdfRowsFromTextParse(rows, deviceText);
    if (!rawText) rawText = deviceText;
  }
  const parseSource = 'edge_server_flights';
  const importOptions = {
    rawText,
    crewAirlineIcao: icao,
    crewAirlineIata: null,
    crewHomeBaseIata: crew.home_base_iata ?? null,
    parseSource,
  };

  if (dryRun) {
    const plan = await buildRosterImportPlan(userClient, rows, importOptions);
    return json({
      ok: true,
      dry_run: true,
      parse_source: parseSource,
      parser_debug_source: parsed.parser_debug_source ?? null,
      rows,
      plan: {
        ready: plan.items.filter((i) => i.kind === 'ready').map((i) => (i.kind === 'ready' ? i.args : null)),
        incomplete: plan.items.filter((i) => i.kind === 'incomplete').map((i) => (i.kind === 'incomplete' ? i.entry : null)),
        skipped_invalid: plan.skippedInvalid,
        skipped_wrong_airline: plan.skippedWrongAirline,
      },
    });
  }

  if (!rows.length) {
    return json({ ok: true, parse_source: parseSource, parser_debug_source: parsed.parser_debug_source ?? null, rows, result: null });
  }

  const appMeta = {
    platform: shortText(body?.platform, 20),
    app_version: shortText(body?.app_version, 40),
    app_build: shortText(body?.app_build, 20),
    server_import: true,
  };
  const result = await runRosterImport(userClient, rows, importOptions, {
    trackImport: async (meta) => {
      await admin.from('user_activity_events').insert({ user_id: uid, event_type: 'roster_import', meta: { ...appMeta, ...meta } });
    },
  });
  return json({ ok: true, parse_source: parseSource, parser_debug_source: parsed.parser_debug_source ?? null, rows, result });
});
