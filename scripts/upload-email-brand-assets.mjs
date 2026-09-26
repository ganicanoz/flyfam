/**
 * Upload FlyFam email artwork to Supabase Storage (public HTTPS URLs for mail clients).
 *
 * Env (repo root .env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
 *
 * Optional:
 *   EMAIL_ASSETS_BUCKET=admin-static
 *
 * Usage:
 *   node scripts/upload-email-brand-assets.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)?.trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY)?.trim();
const bucket = (process.env.EMAIL_ASSETS_BUCKET ?? 'admin-static').trim();
const assets = [
  { file: 'flyfam-email-logo.png', contentType: 'image/png' },
  { file: 'flyfam-email-confirmation-hero.jpg', contentType: 'image/jpeg' },
  { file: 'flyfam-email-recovery-hero.jpg', contentType: 'image/jpeg' },
];

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const asset of assets) {
  const localPath = path.join(root, 'supabase', 'email-assets', asset.file);
  const objectPath = `brand/${asset.file}`;
  if (!fs.existsSync(localPath)) {
    console.error('Missing asset:', localPath);
    process.exit(1);
  }
  const buf = fs.readFileSync(localPath);
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buf, {
    contentType: asset.contentType,
    upsert: true,
    cacheControl: '604800',
  });
  if (error) {
    console.error('Upload failed:', objectPath, error.message);
    process.exit(1);
  }
  console.log('Uploaded:', objectPath);
  console.log('Public URL:', `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`);
}

console.log('\nRegenerate templates:');
console.log('  python3 scripts/build-auth-email-templates.py');
