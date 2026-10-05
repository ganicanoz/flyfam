#!/usr/bin/env node
/**
 * Canlı admin_planner_state.config.partnerFixed: 2026-10-06 Salı tam günü atla + 16:00 imza.
 *
 * Gerekli: SUPABASE_ACCESS_TOKEN (veya `npx supabase login`) + linked proje
 *   veya SUPABASE_DB_URL / DATABASE_URL
 *
 * Kullanım:
 *   node scripts/aile-apply-oct6-imza.mjs
 *   node scripts/aile-apply-oct6-imza.mjs --dry-run
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sqlPath = path.join(root, 'docs/sql/aile_partner_fixed_2026_10_06_imza.sql');
const dry = process.argv.includes('--dry-run');

if (!fs.existsSync(sqlPath)) {
  console.error('SQL yok:', sqlPath);
  process.exit(1);
}

if (dry) {
  console.log('dry-run: çalıştırılacak dosya', sqlPath);
  process.exit(0);
}

const env = { ...process.env };
const hasToken = !!(env.SUPABASE_ACCESS_TOKEN || '').trim();
const dbUrl = (env.SUPABASE_DB_URL || env.DATABASE_URL || '').trim();

let r;
if (dbUrl) {
  r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], { encoding: 'utf8', env });
} else {
  if (!hasToken) {
    console.error('SUPABASE_ACCESS_TOKEN veya SUPABASE_DB_URL gerekli.');
    process.exit(2);
  }
  r = spawnSync(
    'npx',
    ['supabase', 'db', 'query', '--linked', '--agent=no', '-f', sqlPath],
    { encoding: 'utf8', env, cwd: root },
  );
}

if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status ?? 1);
