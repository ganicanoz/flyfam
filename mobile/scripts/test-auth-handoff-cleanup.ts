/**
 * auth_link_handoffs expired cleanup wiring.
 * Çalıştır: npx tsx mobile/scripts/test-auth-handoff-cleanup.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run() {
  const fn = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/functions/auth-link-handoff/index.ts'),
    'utf8',
  );
  assert.ok(fn.includes('async function cleanupExpiredHandoffs'));
  assert.ok(fn.includes('await cleanupExpiredHandoffs(admin)'));
  assert.ok(!fn.includes('void admin.from(\'auth_link_handoffs\').delete()'));
  assert.ok(fn.includes("rpc('cleanup_expired_auth_link_handoffs')"));

  // TokenHash-only handoff: no access/refresh acceptance or payload fields.
  assert.ok(fn.includes('Explicitly ignore legacy access_token'));
  assert.ok(!/access_token\?:/.test(fn));
  assert.ok(!/refresh_token\?:/.test(fn));
  assert.ok(!/out\.access_token\s*=/.test(fn));
  assert.ok(!/out\.refresh_token\s*=/.test(fn));

  const mig = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../supabase/migrations/20261103121000_auth_link_handoffs_expired_cleanup.sql',
    ),
    'utf8',
  );
  assert.ok(mig.includes('create or replace function public.cleanup_expired_auth_link_handoffs'));
  assert.ok(mig.includes('where expires_at < now()'));
  assert.ok(mig.includes("extname = 'pg_cron'"));
  assert.ok(mig.includes('cleanup-expired-auth-link-handoffs'));
  assert.ok(mig.includes('*/15 * * * *'));
  assert.ok(
    mig.includes('pg_cron extension not installed'),
    'must tolerate missing pg_cron',
  );

  console.log('auth handoff cleanup tests: PASS');
}

run();
