/**
 * Export Android Play closed-testing emails from users whose *current* device
 * platform is Android (device_tokens.last_used_at wins).
 *
 * Usage:
 *   node scripts/export-play-closed-testers.js
 *   node scripts/export-play-closed-testers.js --any-android   # ever had an Android token
 *   node scripts/export-play-closed-testers.js --open
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const docs = path.join(root, '../docs');
const envPath = path.join(root, '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const LIST_NAME = 'FlyFam Android users 2026-08';
const PACKAGE = 'com.flyfam.app';
const ANY_ANDROID = process.argv.includes('--any-android');

function isExcludedEmail(email) {
  const local = email.split('@')[0];
  if (/@(example\.com)$/i.test(email)) return true;
  if (/@flyfam\.com$/i.test(email)) return true;
  if (/^(testuser|john\.doe|familytest|famtest)$/i.test(local)) return true;
  return false;
}

async function fetchAllUsers(url, key) {
  const rows = [];
  let page = 1;
  while (page <= 30) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`auth users ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const users = j.users || [];
    for (const u of users) {
      const email = String(u.email || '')
        .trim()
        .toLowerCase();
      if (!email) continue;
      rows.push({
        email,
        id: u.id,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
      });
    }
    if (users.length < 200) break;
    page += 1;
  }
  return rows;
}

/** @returns {Map<string, { currentPlatform: string|null, platforms: string[], lastUsedAt: string|null, osVersion: string|null }>} */
async function fetchDevicePlatformByUser(url, key) {
  const r = await fetch(
    `${url}/rest/v1/device_tokens?select=user_id,platform,last_used_at,os_version&order=last_used_at.desc.nullslast&limit=10000`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) throw new Error(`device_tokens ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  const map = new Map();
  for (const row of rows) {
    const uid = String(row.user_id || '');
    const platform = String(row.platform || '')
      .trim()
      .toLowerCase();
    if (!uid || (platform !== 'ios' && platform !== 'android')) continue;
    let entry = map.get(uid);
    if (!entry) {
      entry = {
        currentPlatform: platform,
        platforms: new Set([platform]),
        lastUsedAt: row.last_used_at || null,
        osVersion: row.os_version || null,
      };
      map.set(uid, entry);
      continue;
    }
    entry.platforms.add(platform);
    const rowTs = row.last_used_at || '';
    const curTs = entry.lastUsedAt || '';
    if (rowTs && (!curTs || rowTs > curTs)) {
      entry.currentPlatform = platform;
      entry.lastUsedAt = row.last_used_at;
      entry.osVersion = row.os_version || entry.osVersion;
    }
  }
  const out = new Map();
  for (const [uid, e] of map) {
    out.set(uid, {
      currentPlatform: e.currentPlatform,
      platforms: [...e.platforms].sort(),
      lastUsedAt: e.lastUsedAt,
      osVersion: e.osVersion,
    });
  }
  return out;
}

async function main() {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const rows = await fetchAllUsers(url, key);
  const deviceByUser = await fetchDevicePlatformByUser(url, key);
  const pr = await fetch(`${url}/rest/v1/profiles?select=id,full_name,role`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const profiles = pr.ok ? await pr.json() : [];
  const byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

  const seen = new Set();
  const unique = [];
  for (const r of rows.sort((a, b) => a.email.localeCompare(b.email))) {
    if (seen.has(r.email)) continue;
    seen.add(r.email);
    const device = deviceByUser.get(r.id) || null;
    const emailOk = !isExcludedEmail(r.email);
    const isAndroidCurrent = device?.currentPlatform === 'android';
    const hasAndroidEver = Boolean(device?.platforms?.includes('android'));
    const androidMatch = ANY_ANDROID ? hasAndroidEver : isAndroidCurrent;
    unique.push({
      email: r.email,
      full_name: byId[r.id]?.full_name || null,
      role: byId[r.id]?.role || null,
      created_at: r.created_at,
      last_sign_in_at: r.last_sign_in_at,
      current_platform: device?.currentPlatform || null,
      platforms: device?.platforms || [],
      device_last_used_at: device?.lastUsedAt || null,
      os_version: device?.osVersion || null,
      include_in_play_closed: emailOk && androidMatch,
      skip_reason: !emailOk
        ? 'excluded_email'
        : !device
          ? 'no_device_token'
          : !androidMatch
            ? ANY_ANDROID
              ? 'no_android_token'
              : `current_platform_${device.currentPlatform || 'unknown'}`
            : null,
    });
  }

  const playUsers = unique.filter((e) => e.include_in_play_closed);
  const play = playUsers.map((e) => e.email);
  const skipped = unique.filter((e) => !e.include_in_play_closed);

  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'android-users-emails.txt'), `${play.join('\n')}${play.length ? '\n' : ''}`);
  fs.writeFileSync(path.join(docs, 'android-closed-testers.csv'), `${play.join('\n')}${play.length ? '\n' : ''}`);
  fs.writeFileSync(
    path.join(docs, 'android-closed-testers-comma.txt'),
    `${play.join(', ')}${play.length ? '\n' : ''}`,
  );
  fs.writeFileSync(
    path.join(docs, 'android-users-email-list.json'),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        list_name: LIST_NAME,
        package: PACKAGE,
        track: 'closed / alpha',
        filter: ANY_ANDROID
          ? 'users with any android device_tokens.platform'
          : 'users whose latest device_tokens.last_used_at platform is android',
        play_closed_count: play.length,
        skipped_count: skipped.length,
        emails: play,
        android_users: playUsers,
        skipped: skipped.map((s) => ({
          email: s.email,
          current_platform: s.current_platform,
          platforms: s.platforms,
          skip_reason: s.skip_reason,
        })),
        note:
          'Play Android Publisher API cannot manage email lists (only Google Groups). Upload android-closed-testers.csv in Play Console → Closed testing → Testers.',
      },
      null,
      2,
    )}\n`,
  );

  if (process.platform === 'darwin') {
    spawnSync('pbcopy', { input: play.join('\n'), encoding: 'utf8' });
  }

  const byReason = {};
  for (const s of skipped) {
    byReason[s.skip_reason || 'other'] = (byReason[s.skip_reason || 'other'] || 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        list_name: LIST_NAME,
        filter: ANY_ANDROID ? 'any-android' : 'current-android',
        play_closed_count: play.length,
        emails: play,
        skipped_by_reason: byReason,
        clipboard: process.platform === 'darwin' ? 'emails copied (newline)' : 'n/a',
      },
      null,
      2,
    ),
  );

  if (process.argv.includes('--open')) {
    spawnSync('open', [
      'https://play.google.com/console/u/0/developers/app/com.flyfam.app/tracks/closed-testing',
    ]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
