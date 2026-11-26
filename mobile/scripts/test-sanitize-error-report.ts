/**
 * sanitizeErrorReport birim testleri.
 * Çalıştır: npx tsx mobile/scripts/test-sanitize-error-report.ts
 */
import assert from 'node:assert/strict';
import { sanitizeErrorReport } from '../lib/sanitizeErrorReport';

function run() {
  const email = sanitizeErrorReport({
    message: 'Failed for crew@flyfamapp.com and jane.doe+test@gmail.com',
  });
  assert.ok(!email.message.includes('@'), email.message);
  assert.match(email.message, /\[email\]/);

  const jwt = sanitizeErrorReport({
    message:
      'token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_part_here_xx', // gitleaks:allow — synthetic sanitizer fixture
  });
  assert.ok(!jwt.message.includes('eyJ'), jwt.message);
  assert.match(jwt.message, /\[jwt\]/);

  const bearer = sanitizeErrorReport({
    message: 'Authorization Bearer abcdefghijklmnop.qrstuv',
  });
  assert.match(bearer.message, /Bearer \[token\]/i);

  const urlQuery = sanitizeErrorReport({
    message:
      'bad link https://app.flyfamapp.com/auth-callback.html?access_token=SECRET123&refresh_token=REFRESH456#token_hash=HASH789',
  });
  assert.ok(!urlQuery.message.includes('SECRET123'), urlQuery.message);
  assert.ok(!urlQuery.message.includes('REFRESH456'), urlQuery.message);
  assert.ok(!urlQuery.message.includes('HASH789'), urlQuery.message);
  assert.match(urlQuery.message, /\[redacted\]/);

  const push = sanitizeErrorReport({
    message: 'push ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] failed',
  });
  assert.ok(!push.message.includes('ExponentPushToken['), push.message);
  assert.match(push.message, /\[push_token\]/);

  const roster = sanitizeErrorReport({
    message: `PDF dump\n${'IST-FRA TK1234 06:00 '.repeat(40)}`,
  });
  assert.ok(roster.message.length < 12_500);
  assert.ok(
    roster.message.split('\n').every((line) => line.length <= 241),
    'long roster lines should be clipped',
  );

  const stack = sanitizeErrorReport({
    message: 'x',
    stack: `${'at foo (/Users/mineoz/secret/path/App.tsx:1:1)\n'.repeat(200)}apikey=supersecret`,
  });
  assert.ok((stack.stack?.length ?? 0) <= 4001);
  assert.ok(!stack.stack?.includes('/Users/mineoz'), stack.stack ?? '');
  assert.ok(!stack.stack?.includes('supersecret'), stack.stack ?? '');

  console.log('sanitizeErrorReport tests: PASS');
}

run();
