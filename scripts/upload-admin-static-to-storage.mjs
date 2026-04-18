/**
 * Upload admin panel assets to Supabase Storage (PNG, etc.).
 *
 * Note: Supabase Storage often serves **public HTML** GET responses as `text/plain`
 * (platform behaviour), so do not rely on Storage to host `*.html` for browser rendering.
 * Use GitHub Pages / Netlify / Cloudflare Pages for the HTML files (see docs/BASE44_DEPLOY.md).
 *
 * Env:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=...   (or SERVICE_ROLE_KEY)
 *
 * Optional:
 *   ADMIN_STATIC_BUCKET=admin-static   (default: admin-static)
 *
 * Usage (from repo root):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-admin-static-to-storage.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY)?.trim();
const bucket = (process.env.ADMIN_STATIC_BUCKET ?? 'admin-static').trim();

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY).');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const logoPath = path.join(root, 'docs', 'Görseller', 'image.png');
if (fs.existsSync(logoPath)) {
  const buf = fs.readFileSync(logoPath);
  const { error } = await supabase.storage.from(bucket).upload('Görseller/image.png', buf, {
    contentType: 'image/png',
    upsert: true,
    cacheControl: '86400',
  });
  if (error) {
    console.error('Logo upload failed:', error.message);
    process.exitCode = 1;
  } else {
    console.log('OK', 'Görseller/image.png');
  }
} else {
  console.warn('Skip logo: docs/Görseller/image.png not found');
}

console.log('\nPublic URL (logo, if uploaded):');
const base = `${supabaseUrl}/storage/v1/object/public/${bucket}`;
console.log(base + '/Görseller/image.png');
