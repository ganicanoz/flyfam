/**
 * OurAirports CSV → public.airports upsert (tablo silinmez).
 * cron-job.org: POST + x-cron-secret. Hemen 200 döner; iş EdgeRuntime.waitUntil ile arka planda biter
 * (cron “timeout” olmasın diye). Tam süre Supabase Edge limitinde (ücretsiz ~150s).
 *
 * TZ: tz-lookup. TR isimleri: airports-tr-names.json
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import tzlookup from 'npm:tz-lookup@6.1.25';
import trNamesJson from './airports-tr-names.json' with { type: 'json' };

const OURAIRPORTS_CSV = 'https://ourairports.com/data/airports.csv';
const BATCH = 600;
/** Aynı anda kaç upsert isteği (toplam süreyi kısaltır; Supabase limitine takılırsa 2’ye indir). */
const UPSERT_CONCURRENCY = 3;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
};

type TrEntry = { name_tr: string; city_tr: string };
const trNames = trNamesJson as Record<string, TrEntry>;
const lookupTz = tzlookup as (lat: number, lon: number) => string;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let end = i + 1;
      while (end < line.length) {
        const next = line.indexOf('"', end);
        if (next === -1) break;
        if (line[next + 1] === '"') {
          end = next + 2;
          continue;
        }
        end = next;
        break;
      }
      out.push(line.slice(i + 1, end).replace(/""/g, '"'));
      i = end + 1;
      if (line[i] === ',') i++;
      continue;
    }
    const comma = line.indexOf(',', i);
    if (comma === -1) {
      out.push(line.slice(i).trim());
      break;
    }
    out.push(line.slice(i, comma).trim());
    i = comma + 1;
  }
  return out;
}

function normalizeTz(raw: string): string | null {
  const t = raw.trim();
  if (!t || t === '\\N') return null;
  return t;
}

type Row = {
  icao: string;
  iata: string | null;
  name: string | null;
  city: string | null;
  country_iso: string | null;
  timezone_iana: string | null;
  raw_light: Record<string, unknown>;
  fetched_at: string;
  name_tr?: string | null;
  city_tr?: string | null;
};

async function runFullSync(supabaseUrl: string, serviceKey: string): Promise<void> {
  const t0 = Date.now();
  const res = await fetch(OURAIRPORTS_CSV);
  if (!res.ok) {
    console.error('[sync-airports-ourairports] OurAirports fetch', res.status);
    return;
  }
  const csvText = await res.text();
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    console.error('[sync-airports-ourairports] Empty CSV');
    return;
  }

  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  const identIdx = idx('ident');
  const typeIdx = idx('type');
  const nameIdx = idx('name');
  const isoCountryIdx = idx('iso_country');
  const municipalityIdx = idx('municipality');
  const icaoCodeIdx = idx('icao_code');
  const iataCodeIdx = idx('iata_code');
  const latIdx = idx('latitude_deg');
  const lonIdx = idx('longitude_deg');
  const timezoneIdx = idx('timezone');

  if (identIdx < 0) {
    console.error('[sync-airports-ourairports] CSV missing ident');
    return;
  }

  const rows: Row[] = [];
  let fromCsvTz = 0;
  let fromLookup = 0;
  let missingTz = 0;

  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    if (cols.length <= identIdx) continue;
    const ident = (cols[identIdx] || '').trim().toUpperCase();
    if (!ident || ident === '\\N') continue;

    const icaoCode = icaoCodeIdx >= 0 ? (cols[icaoCodeIdx] || '').trim().toUpperCase() : '';
    const icao = icaoCode || ident;
    const iataRaw = iataCodeIdx >= 0 ? (cols[iataCodeIdx] || '').trim().toUpperCase() : '';
    const iata = iataRaw || null;
    const name = nameIdx >= 0 ? (cols[nameIdx] || '').trim() || null : null;
    const city = municipalityIdx >= 0 ? (cols[municipalityIdx] || '').trim() || null : null;
    const country_iso = isoCountryIdx >= 0 ? (cols[isoCountryIdx] || '').trim().toUpperCase() || null : null;
    const type = typeIdx >= 0 ? (cols[typeIdx] || '').trim() || null : null;
    if (type && type.toLowerCase() === 'closed') continue;

    let lat: number | null = null;
    let lon: number | null = null;
    if (latIdx >= 0 && lonIdx >= 0) {
      const la = parseFloat(cols[latIdx] || '');
      const lo = parseFloat(cols[lonIdx] || '');
      if (Number.isFinite(la) && Number.isFinite(lo)) {
        lat = la;
        lon = lo;
      }
    }

    const tzCol = timezoneIdx >= 0 ? normalizeTz(cols[timezoneIdx] || '') : null;
    let timezone_source: string | null = null;
    let timezone_iana: string | null = null;

    if (tzCol) {
      timezone_iana = tzCol;
      timezone_source = 'csv';
      fromCsvTz++;
    } else if (lat != null && lon != null) {
      try {
        timezone_iana = lookupTz(lat, lon);
        timezone_source = 'tz_lookup';
        fromLookup++;
      } catch {
        missingTz++;
      }
    } else {
      missingTz++;
    }

    const tr = country_iso === 'TR' && trNames[icao] ? trNames[icao] : null;

    rows.push({
      icao,
      iata,
      name,
      city,
      country_iso,
      timezone_iana,
      raw_light: {
        type,
        latitude_deg: lat,
        longitude_deg: lon,
        timezone_source,
      },
      fetched_at: new Date().toISOString(),
      ...(tr ? { name_tr: tr.name_tr, city_tr: tr.city_tr } : {}),
    });
  }

  const byIcao = new Map<string, Row>();
  for (const r of rows) byIcao.set(r.icao, r);
  const unique = [...byIcao.values()];

  const supabase = createClient(supabaseUrl, serviceKey);
  let batches = 0;
  let i = 0;
  while (i < unique.length) {
    const wave: Row[][] = [];
    for (let c = 0; c < UPSERT_CONCURRENCY && i < unique.length; c++) {
      wave.push(unique.slice(i, i + BATCH));
      i += BATCH;
    }
    const results = await Promise.all(
      wave.map((batch) => supabase.from('airports').upsert(batch, { onConflict: 'icao' }))
    );
    for (const { error } of results) {
      if (error) {
        console.error('[sync-airports-ourairports] upsert error', error.message);
        return;
      }
    }
    batches += wave.length;
  }

  const ms = Date.now() - t0;
  console.log('[sync-airports-ourairports] done', {
    airports: unique.length,
    batches,
    ms,
    timezoneStats: { fromCsvTz, fromLookup, missingTz },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('CRON_SECRET');

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'Missing CRON_SECRET' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const headerSecret = req.headers.get('x-cron-secret');
  if (headerSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized: invalid or missing x-cron-secret' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const awaitFull = url.searchParams.get('await') === '1';

  const task = runFullSync(supabaseUrl, serviceKey).catch((e) => {
    console.error('[sync-airports-ourairports] fatal', e);
  });

  if (awaitFull) {
    await task;
    return new Response(JSON.stringify({ ok: true, mode: 'await', note: 'Tamamlandı (loglara bakın).' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const edgeRt = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof edgeRt?.waitUntil === 'function') {
    edgeRt.waitUntil(task);
    return new Response(
      JSON.stringify({
        ok: true,
        accepted: true,
        message:
          'Senk arka planda çalışıyor. Sonuç: Supabase → Edge Functions → sync-airports-ourairports → Logs. Uzun test: URL sonuna ?await=1',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  await task;
  return new Response(JSON.stringify({ ok: true, mode: 'sync_fallback', note: 'EdgeRuntime.waitUntil yok; senk bu yanıttan önce bitti.' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
