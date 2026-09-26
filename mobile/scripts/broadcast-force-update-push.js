/**
 * One-shot: broadcast force-update push to all device_tokens via Expo.
 * Usage: node scripts/broadcast-force-update-push.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TITLE = 'FlyFam — Yeni sürüm';
const BODY =
  'Yeni özellikler için güncel sürümü kullanın; eski sürüm yakında kapanacak. iOS: TestFlight/App Store. Android: Play closed testing — listede değilseniz support@flyfamapp.com adresine yazın.';

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE URL or SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  const tokRes = await fetch(
    `${SUPABASE_URL}/rest/v1/device_tokens?select=user_id,token&limit=10000`,
    { headers },
  );
  if (!tokRes.ok) {
    console.error('Token fetch failed', tokRes.status, await tokRes.text());
    process.exit(1);
  }
  const rows = await tokRes.json();
  const tokensByUser = new Map();
  for (const row of rows) {
    const uid = String(row.user_id || '').trim();
    const tok = String(row.token || '').trim();
    if (!uid || !tok) continue;
    if (!tokensByUser.has(uid)) tokensByUser.set(uid, []);
    tokensByUser.get(uid).push(tok);
  }
  const tokens = [...new Set([...tokensByUser.values()].flat())];
  console.log(`users_with_tokens=${tokensByUser.size} token_count=${tokens.length}`);
  if (tokens.length === 0) {
    console.log('No tokens; nothing to send');
    return;
  }

  let sent = 0;
  const errors = [];
  const chunk = 100;
  for (let i = 0; i < tokens.length; i += chunk) {
    const slice = tokens.slice(i, i + chunk);
    const messages = slice.map((to) => ({
      to,
      title: TITLE,
      body: BODY,
      sound: 'default',
      channelId: 'default',
    }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    const text = await res.text();
    if (!res.ok) {
      errors.push(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      continue;
    }
    try {
      const data = JSON.parse(text);
      for (const ticket of data.data || []) {
        if (ticket.status === 'ok') sent += 1;
        else errors.push(ticket.details?.error || ticket.message || 'unknown');
      }
    } catch {
      sent += slice.length;
    }
  }

  const activityRows = [...tokensByUser.keys()].map((user_id) => ({
    user_id,
    event_type: 'admin_push',
    meta: { title: TITLE, body: BODY, source: 'broadcast_script_v39', sent },
  }));
  for (let i = 0; i < activityRows.length; i += 200) {
    const batch = activityRows.slice(i, i + 200);
    await fetch(`${SUPABASE_URL}/rest/v1/user_activity_events`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    });
  }

  console.log(JSON.stringify({ ok: true, sent, token_count: tokens.length, error_count: errors.length, sample_errors: errors.slice(0, 5) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
