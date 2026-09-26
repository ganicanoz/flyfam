#!/usr/bin/env node
/** Delete one explicitly named Supabase Auth test user and its direct FlyFam profile rows. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetEmail = (process.argv[2] ?? '').trim().toLowerCase();
const confirmed = process.argv.includes('--confirm');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(root, '.env'));
loadEnv(path.join(root, 'mobile', '.env'));

const baseUrl = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!targetEmail || !baseUrl || !serviceKey) {
  console.error('Usage: node scripts/delete-exact-test-user.mjs <exact-email> [--confirm]');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' };

async function request(pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(body?.message ?? body?.msg ?? `HTTP ${response.status}`);
  return body;
}

async function findExactUsers() {
  const matches = [];
  for (let page = 1; page <= 20; page += 1) {
    const body = await request(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const users = Array.isArray(body?.users) ? body.users : [];
    matches.push(...users.filter((user) => String(user.email ?? '').trim().toLowerCase() === targetEmail));
    if (users.length < 200) break;
  }
  return matches;
}

const matches = await findExactUsers();
if (matches.length !== 1) {
  console.error(`Aborted: exact match count is ${matches.length}; expected 1.`);
  process.exit(2);
}

const userId = matches[0].id;
if (!confirmed) {
  console.log(`Exact account found: ${targetEmail}. Re-run with --confirm to permanently delete it.`);
  process.exit(0);
}

const encodedId = encodeURIComponent(userId);
const crewRows = await request(`/rest/v1/crew_profiles?select=id&user_id=eq.${encodedId}`);
const crewIds = (Array.isArray(crewRows) ? crewRows : []).map((row) => row.id).filter(Boolean);
if (crewIds.length) {
  await request(`/rest/v1/flight_crew?crew_id=in.(${crewIds.map(encodeURIComponent).join(',')})`, { method: 'DELETE' });
}
await request(`/rest/v1/crew_profiles?user_id=eq.${encodedId}`, { method: 'DELETE' });
await request(`/rest/v1/profiles?id=eq.${encodedId}`, { method: 'DELETE' });
await request(`/auth/v1/admin/users/${encodedId}`, { method: 'DELETE' });

const remaining = await findExactUsers();
if (remaining.length !== 0) {
  console.error('Deletion could not be verified.');
  process.exit(3);
}
console.log(`Deleted and verified exact account: ${targetEmail}`);
