#!/usr/bin/env node
/**
 * Replace target crew roster with another user's next N days.
 *
 * Also copies the source crew's home base (and city) onto the target so layover
 * detection matches the copied schedule.
 *
 * Usage:
 *   node scripts/clone-demo-roster-from-user.mjs --dry-run
 *   CLONE_SOURCE_EMAIL=source@example.com DEMO_CREW_EMAIL=demo@example.com \
 *     DEMO_CREW_PASSWORD='...' node scripts/clone-demo-roster-from-user.mjs
 *
 * Env:
 *   CLONE_SOURCE_EMAIL / DEMO_CREW_EMAIL (or CLONE_TARGET_EMAIL) / DEMO_CREW_PASSWORD
 *   CLONE_ROSTER_DAYS (default 5)
 *   CLONE_COPY_HOME_BASE=0  → skip copying home_base_iata / home_base_city
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadOneDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadOneDotEnv(path.join(root, '.env'));
loadOneDotEnv(path.join(root, 'mobile', '.env'));

const SOURCE_EMAIL = (process.env.CLONE_SOURCE_EMAIL ?? '').trim().toLowerCase();
const DEMO_EMAIL = (process.env.CLONE_TARGET_EMAIL ?? process.env.DEMO_CREW_EMAIL ?? '')
  .trim()
  .toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_CREW_PASSWORD ?? '';
const DAYS = Number(process.env.CLONE_ROSTER_DAYS ?? '5');
const COPY_HOME_BASE = process.env.CLONE_COPY_HOME_BASE !== '0';
const dryRun = process.argv.includes('--dry-run');

if (!SOURCE_EMAIL || !DEMO_EMAIL || !DEMO_PASSWORD) {
  throw new Error(
    'CLONE_SOURCE_EMAIL, DEMO_CREW_EMAIL (or CLONE_TARGET_EMAIL), and DEMO_CREW_PASSWORD are required.',
  );
}

const baseUrl = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(
  /\/$/,
  ''
);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!baseUrl || !serviceKey || !anonKey) {
  console.error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const adminHeaders = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
  'Content-Type': 'application/json',
};

async function rest(pathname, init = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...adminHeaders, Prefer: 'return=representation', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { res, json };
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: adminHeaders,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.msg ?? 'admin users failed');
    const hit = (json.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit;
    if ((json.users ?? []).length < 200) break;
  }
  return null;
}

async function crewProfileForUser(userId) {
  const { res, json } = await rest(
    `/rest/v1/crew_profiles?user_id=eq.${userId}&select=id,home_base_iata,home_base_city,airline_icao`
  );
  if (!res.ok) throw new Error(json?.message ?? 'crew_profiles lookup failed');
  return json?.[0] ?? null;
}

async function copyHomeBaseToTarget(sourceCrew, targetCrewId) {
  if (!COPY_HOME_BASE) {
    console.log('Skip home base copy (CLONE_COPY_HOME_BASE=0)');
    return;
  }
  const base = (sourceCrew.home_base_iata ?? '').trim().toUpperCase() || null;
  const city = (sourceCrew.home_base_city ?? '').trim() || null;
  if (!base) {
    console.log('Source has no home_base_iata — leave target base unchanged');
    return;
  }
  const patch = {
    home_base_iata: base,
    home_base_city: city,
  };
  if (dryRun) {
    console.log(`Would set target home base → ${base}${city ? ` (${city})` : ''}`);
    return;
  }
  const { res, json } = await rest(`/rest/v1/crew_profiles?id=eq.${targetCrewId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(json?.message ?? 'crew_profiles home base patch failed');
  console.log(`Target home base → ${base}${city ? ` (${city})` : ''}`);
}

function dateRangeUtc(days) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days - 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

async function listCrewFlightsInRange(crewId, from, to) {
  const cols =
    'id,crew_id,flight_number,flight_date,origin_airport,destination_airport,scheduled_departure,scheduled_arrival,roster_entry_kind,duty_rest_end,roster_detail';
  const { res: fcRes, json: fcRows } = await rest(
    `/rest/v1/flight_crew?crew_id=eq.${crewId}&select=flight_id`
  );
  if (!fcRes.ok) throw new Error(fcRows?.message ?? 'flight_crew lookup failed');

  const ids = [...new Set((fcRows ?? []).map((r) => r.flight_id))];
  const byId = new Map();

  if (ids.length) {
    const chunk = 80;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk).join(',');
      const { res, json } = await rest(
        `/rest/v1/flights?id=in.(${slice})&flight_date=gte.${from}&flight_date=lte.${to}&select=${cols}&order=flight_date.asc,scheduled_departure.asc`
      );
      if (!res.ok) throw new Error(json?.message ?? 'flights by junction failed');
      for (const f of json ?? []) byId.set(f.id, f);
    }
  }

  const { res: legacyRes, json: legacy } = await rest(
    `/rest/v1/flights?crew_id=eq.${crewId}&flight_date=gte.${from}&flight_date=lte.${to}&select=${cols}&order=flight_date.asc,scheduled_departure.asc`
  );
  if (!legacyRes.ok) throw new Error(legacy?.message ?? 'flights by crew_id failed');
  for (const f of legacy ?? []) byId.set(f.id, f);

  return [...byId.values()].sort((a, b) => {
    const d = a.flight_date.localeCompare(b.flight_date);
    if (d !== 0) return d;
    const ta = a.scheduled_departure ?? '';
    const tb = b.scheduled_departure ?? '';
    return ta.localeCompare(tb);
  });
}

async function clearDemoCrewRoster(demoCrewId, from, to) {
  const flights = await listCrewFlightsInRange(demoCrewId, from, to);
  if (dryRun) {
    console.log(`Would clear ${flights.length} demo roster row(s) in range`);
    return;
  }

  for (const f of flights) {
    await rest(`/rest/v1/flight_crew?flight_id=eq.${f.id}&crew_id=eq.${demoCrewId}`, {
      method: 'DELETE',
    });
    const { json: remaining } = await rest(`/rest/v1/flight_crew?flight_id=eq.${f.id}&select=crew_id`);
    const others = (remaining ?? []).length;
    if (others === 0 && f.crew_id === demoCrewId) {
      await rest(`/rest/v1/flights?id=eq.${f.id}`, { method: 'DELETE' });
    }
  }

  const { json: stray } = await rest(
    `/rest/v1/flights?crew_id=eq.${demoCrewId}&flight_date=gte.${from}&flight_date=lte.${to}&select=id`
  );
  for (const row of stray ?? []) {
    await rest(`/rest/v1/flight_crew?flight_id=eq.${row.id}`, { method: 'DELETE' });
    await rest(`/rest/v1/flights?id=eq.${row.id}`, { method: 'DELETE' });
  }

  console.log(`Cleared demo roster in ${from}..${to}`);
}

async function signInDemo() {
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description ?? json.msg ?? 'demo sign-in failed');
  return json.access_token;
}

async function addFlightAsDemo(token, f) {
  const body = {
    p_flight_number: f.flight_number,
    p_flight_date: f.flight_date,
    p_origin_airport: f.origin_airport,
    p_destination_airport: f.destination_airport,
    p_scheduled_departure: f.scheduled_departure,
    p_scheduled_arrival: f.scheduled_arrival,
    p_roster_entry_kind: f.roster_entry_kind ?? 'flight',
    p_duty_rest_end: f.duty_rest_end,
    p_roster_detail: f.roster_detail,
  };
  if (dryRun) {
    console.log('Would add:', f.flight_date, f.flight_number);
    return;
  }
  const res = await fetch(`${baseUrl}/rest/v1/rpc/add_me_to_flight`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${f.flight_number} ${f.flight_date}: ${json.message ?? res.status}`);
  }
  console.log('Added:', f.flight_date, f.flight_number, json);
}

async function main() {
  const { from, to } = dateRangeUtc(DAYS);
  console.log('Clone roster');
  console.log('  Source:', SOURCE_EMAIL);
  console.log('  Target:', DEMO_EMAIL);
  console.log('  Range:', from, '→', to, `(${DAYS} days)`);
  console.log('  Copy home base:', COPY_HOME_BASE ? 'yes' : 'no');
  if (dryRun) console.log('  --dry-run');

  const sourceUser = await findUserByEmail(SOURCE_EMAIL);
  if (!sourceUser) throw new Error(`Source user not found: ${SOURCE_EMAIL}`);
  const demoUser = await findUserByEmail(DEMO_EMAIL);
  if (!demoUser) throw new Error(`Target user not found: ${DEMO_EMAIL}`);

  const sourceCrew = await crewProfileForUser(sourceUser.id);
  const demoCrew = await crewProfileForUser(demoUser.id);
  if (!sourceCrew?.id || !demoCrew?.id) throw new Error('Missing crew_profiles');

  console.log(
    `  Source base: ${sourceCrew.home_base_iata ?? '—'} | Target base (before): ${demoCrew.home_base_iata ?? '—'}`
  );

  await copyHomeBaseToTarget(sourceCrew, demoCrew.id);

  const sourceFlights = await listCrewFlightsInRange(sourceCrew.id, from, to);
  console.log(`Source has ${sourceFlights.length} roster row(s)`);

  await clearDemoCrewRoster(demoCrew.id, from, to);

  const token = dryRun ? null : await signInDemo();
  for (const f of sourceFlights) {
    await addFlightAsDemo(token, f);
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
