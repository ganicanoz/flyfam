/**
 * Upload FlyFam email logo to Supabase Storage (public HTTPS URL for mail clients).
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
const objectPath = 'brand/flyfam-email-logo.png';

const logoPath = path.join(root, 'supabase', 'email-assets', 'flyfam-email-logo.png');

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (!fs.existsSync(logoPath)) {
  console.error('Missing asset. Run: python3 scripts/build-auth-email-templates.py --write-logo-asset');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const buf = fs.readFileSync(logoPath);
const { error } = await supabase.storage.from(bucket).upload(objectPath, buf, {
  contentType: 'image/png',
  upsert: true,
  cacheControl: '604800',
});

if (error) {
  console.error('Upload failed:', error.message);
  process.exit(1);
}

const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
console.log('Uploaded:', objectPath);
console.log('Public URL:', publicUrl);
console.log('\nRegenerate templates:');
console.log(`  SUPABASE_EMAIL_LOGO_URL="${publicUrl}" python3 scripts/build-auth-email-templates.py`);
