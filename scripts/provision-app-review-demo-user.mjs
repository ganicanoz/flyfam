#!/usr/bin/env node
/**
 * App Store / TestFlight demo accounts (production Supabase).
 *
 * Crew:  crewtestuser@flyfam.com / crewtest
 * Family: familytestuser@flyfam.com / familytest (reuses existing user if present)
 *
 * Requires in .env or mobile/.env:
 *   EXPO_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY (roster seed RPC)
 *
 * Usage:
 *   node scripts/provision-app-review-demo-user.mjs
 *   node scripts/provision-app-review-demo-user.mjs --dry-run
 *   node scripts/provision-app-review-demo-user.mjs --crew-only
 *   node scripts/provision-app-review-demo-user.mjs --family-only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const CREW_EMAIL = (process.env.DEMO_CREW_EMAIL ?? 'crewtestuser@flyfam.com').trim().toLowerCase();
const CREW_PASSWORD = process.env.DEMO_CREW_PASSWORD ?? 'crewtest';
const CREW_FULL_NAME = process.env.DEMO_CREW_FULL_NAME ?? 'App Review Demo';
const FAMILY_EMAIL = (process.env.DEMO_FAMILY_EMAIL ?? 'familytestuser@flyfam.com').trim().toLowerCase();
const FAMILY_PASSWORD = process.env.DEMO_FAMILY_PASSWORD ?? 'familytest';
const FAMILY_FULL_NAME = process.env.DEMO_FAMILY_FULL_NAME ?? 'App Review Family';
const AIRLINE_ICAO = 'PGT';
const AIRLINE_NAME = 'Pegasus Airlines';
const CONSENT_VERSION = '2026-05-v5';
const dryRun = process.argv.includes('--dry-run');
const crewOnly = process.argv.includes('--crew-only');
const familyOnly = process.argv.includes('--family-only');

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

const baseUrl = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(
  /\/$/,
  ''
);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!baseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env / mobile/.env');
  process.exit(1);
}

const adminHeaders = {
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
  'Content-Type': 'application/json',
};

const restHeaders = {
  ...adminHeaders,
  Prefer: 'return=representation',
};

async function adminFetch(pathname, init = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...adminHeaders, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { res, json };
}

async function restFetch(pathname, init = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...restHeaders, ...(init.headers ?? {}) },
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
    const { res, json } = await adminFetch(`/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!res.ok) throw new Error(json.msg ?? json.message ?? `admin users ${res.status}`);
    const users = json.users ?? [];
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

async function createOrUpdateAuthUser({ email, password, fullName, role }) {
  const existing = await findUserByEmail(email);
  if (dryRun) {
    console.log(existing ? `Would update user ${existing.id}` : 'Would create auth user');
    return existing?.id ?? '00000000-0000-4000-8000-000000000000';
  }

  if (existing) {
    const { res, json } = await adminFetch(`/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role,
          locale: 'en',
        },
      }),
    });
    if (!res.ok) throw new Error(json.msg ?? json.message ?? `update user ${res.status}`);
    console.log('Updated existing auth user:', existing.id);
    return existing.id;
  }

  const { res, json } = await adminFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
        locale: 'en',
      },
    }),
  });
  if (!res.ok) throw new Error(json.msg ?? json.message ?? json.error_description ?? `create user ${res.status}`);
  console.log('Created auth user:', json.id);
  return json.id;
}

async function upsertProfile(userId, { role, fullName }) {
  if (dryRun) {
    console.log(`Would upsert profiles row (${role})`);
    return;
  }
  const { res, json } = await restFetch('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      id: userId,
      role,
      full_name: fullName,
      phone: null,
      locale: 'en',
    }),
  });
  if (!res.ok) throw new Error(json.message ?? `profiles ${res.status}`);
  console.log('Profile OK');
}

async function upsertConsents(userId) {
  if (dryRun) {
    console.log('Would upsert user_consents');
    return;
  }
  for (const consent_type of ['privacy_notice', 'terms_disclaimer']) {
    const { res: patchRes } = await restFetch(
      `/rest/v1/user_consents?user_id=eq.${userId}&consent_type=eq.${consent_type}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          accepted: true,
          policy_version: CONSENT_VERSION,
          locale: 'en',
          source: 'app_review_demo',
        }),
      }
    );
    if (patchRes.ok) continue;

    const { res, json } = await restFetch('/rest/v1/user_consents', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: userId,
        consent_type,
        accepted: true,
        policy_version: CONSENT_VERSION,
        locale: 'en',
        source: 'app_review_demo',
      }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(json.message ?? `consents ${consent_type} ${res.status}`);
    }
  }
  console.log('Consents OK');
}

async function upsertCrewProfile(userId) {
  if (dryRun) {
    console.log('Would upsert crew_profiles (PGT)');
    return 'dry-run-crew-id';
  }
  const { res: existingRes, json: existing } = await restFetch(
    `/rest/v1/crew_profiles?user_id=eq.${userId}&select=id`
  );
  if (!existingRes.ok) throw new Error(existing?.message ?? `crew lookup ${existingRes.status}`);

  const payload = {
    user_id: userId,
    company_name: AIRLINE_NAME,
    airline_icao: AIRLINE_ICAO,
    time_preference: 'local',
    roster_list_show: {
      off_days: true,
      training: true,
      simulator: true,
      other: true,
    },
  };

  if (existing?.[0]?.id) {
    const crewId = existing[0].id;
    const { res, json } = await restFetch(`/rest/v1/crew_profiles?id=eq.${crewId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(json.message ?? `crew patch ${res.status}`);
    console.log('Crew profile updated:', crewId);
    return crewId;
  }

  const { res, json } = await restFetch('/rest/v1/crew_profiles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(json.message ?? `crew insert ${res.status}`);
  const crewId = Array.isArray(json) ? json[0]?.id : json?.id;
  console.log('Crew profile created:', crewId);
  return crewId;
}

async function upsertSubscription(crewId) {
  if (dryRun) {
    console.log('Would upsert crew_subscriptions (trialing couple)');
    return;
  }
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString();

  const { res: existingRes, json: existing } = await restFetch(
    `/rest/v1/crew_subscriptions?crew_id=eq.${crewId}&select=id`
  );
  if (!existingRes.ok) throw new Error(existing?.message ?? `sub lookup ${existingRes.status}`);

  const body = {
    crew_id: crewId,
    plan_code: 'couple',
    status: 'active',
    extra_family_slots: 0,
    trial_started_at: iso(now),
    trial_ends_at: iso(trialEnd),
    current_period_ends_at: iso(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)),
    provider: 'app_review_demo',
  };

  if (existing?.[0]?.id) {
    const { res, json } = await restFetch(`/rest/v1/crew_subscriptions?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(json.message ?? `sub patch ${res.status}`);
  } else {
    const { res, json } = await restFetch('/rest/v1/crew_subscriptions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(json.message ?? `sub insert ${res.status}`);
  }
  console.log('Subscription OK (active)');
}

async function signInAs(email, password) {
  if (!anonKey) {
    throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY required for roster seed RPC');
  }
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error_description ?? json.msg ?? 'sign-in failed');
  }
  return json.access_token;
}

async function seedDemoFlights(accessToken) {
  if (dryRun) {
    console.log('Would seed demo roster via add_me_to_flight RPC');
    return;
  }
  const d = new Date();
  const flightDate = d.toISOString().slice(0, 10);
  const userHeaders = {
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
    'Content-Type': 'application/json',
  };

  const demos = [
    {
      p_flight_number: 'PC9001',
      p_flight_date: flightDate,
      p_origin_airport: 'SAW',
      p_destination_airport: 'AYT',
      p_scheduled_departure: `${flightDate}T06:00:00.000Z`,
      p_scheduled_arrival: `${flightDate}T07:15:00.000Z`,
      p_roster_entry_kind: 'flight',
    },
    {
      p_flight_number: 'RSV',
      p_flight_date: flightDate,
      p_scheduled_departure: `${flightDate}T08:00:00.000Z`,
      p_scheduled_arrival: `${flightDate}T16:00:00.000Z`,
      p_roster_entry_kind: 'duty_off',
    },
  ];

  for (const body of demos) {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/add_me_to_flight`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      console.warn('add_me_to_flight skipped:', body.p_flight_number, json.message ?? res.status);
    } else {
      console.log('Roster row:', body.p_flight_number, flightDate, json);
    }
  }
}

async function verifySignIn(email, password, label) {
  if (dryRun) return null;
  const token = await signInAs(email, password);
  console.log(`Sign-in test (${label}): OK`);
  return token;
}

async function lookupCrewProfileIdByUserEmail(email) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const { res, json } = await restFetch(`/rest/v1/crew_profiles?user_id=eq.${user.id}&select=id`);
  if (!res.ok) throw new Error(json?.message ?? `crew lookup ${res.status}`);
  return json?.[0]?.id ?? null;
}

async function upsertFamilyConnection(crewProfileId, familyUserId, invitedByUserId) {
  if (dryRun) {
    console.log('Would upsert approved family_connections');
    return;
  }
  const { res: existingRes, json: existing } = await restFetch(
    `/rest/v1/family_connections?crew_id=eq.${crewProfileId}&family_id=eq.${familyUserId}&select=id,status`
  );
  if (!existingRes.ok) throw new Error(existing?.message ?? `connection lookup ${existingRes.status}`);

  const body = {
    crew_id: crewProfileId,
    family_id: familyUserId,
    status: 'approved',
    invited_by: invitedByUserId,
  };

  if (existing?.[0]?.id) {
    const { res, json } = await restFetch(`/rest/v1/family_connections?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved', invited_by: invitedByUserId }),
    });
    if (!res.ok) throw new Error(json.message ?? `connection patch ${res.status}`);
    console.log('Family connection updated (approved):', existing[0].id);
    return existing[0].id;
  }

  const { res, json } = await restFetch('/rest/v1/family_connections', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(json.message ?? `connection insert ${res.status}`);
  const connId = Array.isArray(json) ? json[0]?.id : json?.id;
  console.log('Family connection created (approved):', connId);
  return connId;
}

async function provisionCrew() {
  console.log('\n--- Crew demo ---');
  console.log('Email:', CREW_EMAIL);
  const userId = await createOrUpdateAuthUser({
    email: CREW_EMAIL,
    password: CREW_PASSWORD,
    fullName: CREW_FULL_NAME,
    role: 'crew',
  });
  await upsertProfile(userId, { role: 'crew', fullName: CREW_FULL_NAME });
  await upsertConsents(userId);
  const crewId = await upsertCrewProfile(userId);
  await upsertSubscription(crewId);
  const accessToken = await verifySignIn(CREW_EMAIL, CREW_PASSWORD, 'crew');
  if (accessToken) await seedDemoFlights(accessToken);
  return { userId, crewId };
}

async function provisionFamily(crewProfileId, crewUserId) {
  console.log('\n--- Family demo ---');
  console.log('Email:', FAMILY_EMAIL);
  const familyUserId = await createOrUpdateAuthUser({
    email: FAMILY_EMAIL,
    password: FAMILY_PASSWORD,
    fullName: FAMILY_FULL_NAME,
    role: 'family',
  });
  await upsertProfile(familyUserId, { role: 'family', fullName: FAMILY_FULL_NAME });
  await upsertConsents(familyUserId);
  if (!crewProfileId) {
    crewProfileId = await lookupCrewProfileIdByUserEmail(CREW_EMAIL);
  }
  if (!crewProfileId) {
    throw new Error(`No crew_profiles row for ${CREW_EMAIL}; run crew provisioning first`);
  }
  await upsertFamilyConnection(crewProfileId, familyUserId, crewUserId ?? familyUserId);
  await verifySignIn(FAMILY_EMAIL, FAMILY_PASSWORD, 'family');
}

async function main() {
  console.log('App Review demo accounts');
  console.log('Project:', baseUrl);
  if (dryRun) console.log('--dry-run');

  let crewUserId;
  let crewProfileId;

  if (!familyOnly) {
    const crew = await provisionCrew();
    crewUserId = crew.userId;
    crewProfileId = crew.crewId;
  }

  if (!crewOnly) {
    await provisionFamily(crewProfileId, crewUserId);
  }

  console.log('\nDone. App Store Connect credentials:');
  if (!familyOnly) {
    console.log('  Crew username:', CREW_EMAIL);
    console.log('  Crew password:', CREW_PASSWORD);
  }
  if (!crewOnly) {
    console.log('  Family username:', FAMILY_EMAIL);
    console.log('  Family password:', FAMILY_PASSWORD);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
