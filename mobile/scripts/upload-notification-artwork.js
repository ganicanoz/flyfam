#!/usr/bin/env node
/**
 * Upload optimized push artwork JPGs to Supabase Storage bucket `notification-artwork`.
 *
 * Requires:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage (from repo root or mobile/):
 *   node mobile/scripts/upload-notification-artwork.js
 */
const fs = require('fs');
const path = require('path');

const PUSH_DIR = path.join(__dirname, '../assets/notification-artwork/push');
const FILES = [
  'flyfam-takeoff-v3-push.jpg',
  'flyfam-landing-v3-push.jpg',
  'flyfam-roster-v3-push.jpg',
];
const BUCKET = 'notification-artwork';

async function main() {
  const url = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  for (const file of FILES) {
    const local = path.join(PUSH_DIR, file);
    if (!fs.existsSync(local)) {
      console.error('Missing file:', local);
      process.exit(1);
    }
    const body = fs.readFileSync(local);
    const endpoint = `${url}/storage/v1/object/${BUCKET}/${file}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('Upload failed', file, res.status, text.slice(0, 300));
      process.exit(1);
    }
    const publicUrl = `${url}/storage/v1/object/public/${BUCKET}/${file}`;
    console.log('OK', file, `(${body.length} bytes) →`, publicUrl);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
