/**
 * Edge log PII maskeleme testleri.
 * Çalıştır: npx tsx mobile/scripts/test-safe-log-pii.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function maskEmail(email: string | null | undefined): string | null {
  const raw = String(email ?? '').trim().toLowerCase();
  if (!raw || !raw.includes('@')) return raw ? '[email]' : null;
  const [local, domain] = raw.split('@');
  if (!domain) return '[email]';
  const localMask = local.length <= 2 ? `${local[0] ?? '*'}*` : `${local.slice(0, 2)}***`;
  return `${localMask}@${domain}`;
}

function anonUserRef(userId: string | null | undefined): string | null {
  const id = String(userId ?? '').trim();
  if (!id) return null;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `u_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function run() {
  assert.equal(maskEmail('crew@flyfamapp.com'), 'cr***@flyfamapp.com');
  assert.ok(!(maskEmail('admin@example.com') ?? '').startsWith('admin@'));
  assert.ok((anonUserRef('11111111-2222-4333-8444-555555555555') ?? '').startsWith('u_'));
  assert.notEqual(
    anonUserRef('11111111-2222-4333-8444-555555555555'),
    '11111111-2222-4333-8444-555555555555',
  );

  const admin = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/functions/admin-dashboard/index.ts'),
    'utf8',
  );
  assert.ok(admin.includes("from '../_shared/safeLog.ts'"));
  assert.ok(admin.includes('maskEmail(requesterEmail)'));
  // Raw email must not be logged in confirm_user_email block.
  assert.ok(!/confirm_user_email[\s\S]{0,200}email:\s*updated/.test(admin));

  const notify = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/functions/notify-family/index.ts'),
    'utf8',
  );
  assert.ok(notify.includes("from '../_shared/safeLog.ts'"));
  assert.ok(!/token:\s*tokens\[/.test(notify));
  assert.ok(!/family_user_ids:\s*recipients/.test(notify));
  assert.ok(!/user_ids:\s*usersWithNoTokens/.test(notify));

  console.log('safe log PII tests: PASS');
}

run();
